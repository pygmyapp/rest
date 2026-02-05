import { Hono } from 'hono';
import { describeRoute, resolver } from 'hono-openapi';
import { RateLimiterRes } from 'rate-limiter-flexible';
import type { IPCMessage } from 'ipc-client';
import { Errors } from '../constants';
import prisma from '../handlers/db';
import { ipc } from '../handlers/ipc';
import { authMiddleware } from '../handlers/session';
import { generateSnowflake } from '../handlers/snowflake';
import { createAndHashToken, hashToken, sendEmailVerificationMail } from '../handlers/mail';
import { validate } from '../handlers/validator';
import { errorResponse } from '../schemas/shared';
import {
  userCreateBlockedBody,
  userCreateBody,
  userCreateRequestBody,
  userCreateResponse,
  userDeleteBlockedParam,
  userDeleteFriendParam,
  userDeleteRequestParam,
  userGetBlockedResponse,
  userGetFriendsResponse,
  userGetParam,
  userGetRequestsResponse,
  userGetResponse,
  userGetSelfResponse,
  userGetUsernameAvailabilityParam,
  userGetUsernameAvailabilityResponse,
  userUpdateBody,
  userUpdateProfileBody,
  userUpdateRequestBody,
  userUpdateRequestParam,
  userVerifyEmailAddressBody,
  userVerifyEmailAddressResponse
} from '../schemas/user';
import { pointsChangeUsername, rateLimiterChangeUsername, setRateLimitHeaders } from '../handlers/ratelimit';

const app = new Hono();

// Create a new user
// POST /users
app.post(
  '/',
  describeRoute({
    description: 'Create a new user',
    tags: ['Users'],
    responses: {
      201: {
        description: 'User created',
        content: {
          'application/json': {
            schema: resolver(userCreateResponse)
          }
        }
      },
      400: {
        description: 'Request failed',
        content: {
          'application/json': {
            schema: resolver(errorResponse)
          }
        }
      }
    }
  }),
  validate('json', userCreateBody),
  async (c) => {
    const { email, username, password } = c.req.valid('json');

    // Check if email is already in use
    const existingEmail = await prisma.user.findUnique({
      where: { email }
    });

    if (existingEmail) return c.json({ error: Errors.EmailAlreadyInUse }, 400);

    // Check if username is already in use
    const existingUsername = await prisma.user.findUnique({
      where: { username }
    });

    if (existingUsername)
      return c.json({ error: Errors.UsernameAlreadyInUse }, 400);

    // Add user to database
    const id = generateSnowflake();
    const hash = await Bun.password.hash(password);

    await prisma.user.create({
      data: {
        id,
        email,
        username,
        hash,
        profile: {
          create: {
            displayName: null,
            bio: null,
            pronouns: null
          }
        }
      }
    });

    // Create and send email verification
    const emailVerification = createAndHashToken();

    await prisma.emailVerificationToken.create({
      data: {
        userId: id,
        hash: emailVerification.hash,
        createdAt: new Date()
      }
    });

    await sendEmailVerificationMail(email, username, emailVerification.token);

    return c.json({ id }, 201);
  }
);

// Fetch the authorized user
// GET /users/@me
app.get(
  '/@me',
  describeRoute({
    description:
      'Fetch the authorized user\n\nThis route will return additional details that can only be accessed by the authorized user',
    tags: ['Users'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'User object',
        content: {
          'application/json': {
            schema: resolver(userGetSelfResponse)
          }
        }
      },
      401: {
        description: 'Authorization required',
        content: {
          'application/json': {
            schema: resolver(errorResponse)
          }
        }
      }
    }
  }),
  authMiddleware,
  async (c) => {
    const user = await prisma.user.findUnique({
      where: { id: c.var.userId },
      omit: { hash: true },
      include: {
        profile: true
      }
    });

    if (!user) return c.json({ error: Errors.ServerError }, 500);

    return c.json(user);
  }
);

// Update the authorized user's details
// PATCH /users/@me
app.patch(
  '/@me',
  describeRoute({
    description:
      "Update the authorized user's details\n\nTo change the user's email address or password, the user's current password is required in the `currentPassword` field for security purposes.\n\nNote that changing your password will invalidate **all existing sessions**.\n\n**🔒 Requires Authorization**",
    tags: ['Users'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'User updated successfully'
      },
      304: {
        description: 'No changes saved'
      },
      400: {
        description: 'Request failed',
        content: {
          'application/json': {
            schema: resolver(errorResponse)
          }
        }
      },
      401: {
        description: 'Authorization required',
        content: {
          'application/json': {
            schema: resolver(errorResponse)
          }
        }
      }
    }
  }),
  authMiddleware,
  validate('json', userUpdateBody),
  async (c) => {
    const data = c.req.valid('json');

    const user = await prisma.user.findUnique({
      where: { id: c.var.userId }
    });

    if (!user) return c.json({ error: Errors.ServerError }, 500);

    if (
      data.email === undefined &&
      data.username === undefined &&
      data.newPassword === undefined
    )
      return c.status(304);

    const changes: { [x: string]: string | boolean; } = {};

    // Email
    if (data.email !== undefined && data.email !== user.email) {
      // Check that current password is correct
      if (!data.currentPassword)
        return c.json({ error: Errors.CurrentPasswordRequired }, 400);

      const currentPasswordValid = await Bun.password.verify(
        data.currentPassword,
        user.hash
      );

      if (!currentPasswordValid)
        return c.json({ error: Errors.InvalidPassword }, 401);

      // Check that new email address isn't in use
      const existingEmail = await prisma.user.findUnique({
        where: { email: data.email }
      });

      if (existingEmail)
        return c.json({ error: Errors.EmailAlreadyInUse }, 400);

      changes.email = data.email;
    }

    // Username
    if (data.username !== undefined && data.username !== user.username) {
      // Check that new username isn't in use
      const existingUsername = await prisma.user.findUnique({
        where: { username: data.username }
      });

      if (existingUsername)
        return c.json({ error: Errors.UsernameAlreadyInUse }, 400);

      changes.username = data.username.toLowerCase();
    }

    // Password
    if (data.newPassword !== undefined) {
      // Check that current password is correct
      if (!data.currentPassword)
        return c.json({ error: Errors.CurrentPasswordRequired }, 400);

      const currentPasswordValid = await Bun.password.verify(
        data.currentPassword,
        user.hash
      );

      if (!currentPasswordValid)
        return c.json({ error: Errors.InvalidPassword }, 401);

      // Check that new password isn't the same as the current password
      const passwordMatch = await Bun.password.verify(
        data.newPassword,
        user.hash
      );

      if (passwordMatch)
        return c.json({ error: Errors.PasswordNotChanged }, 401);

      // Hash new password
      const hash = await Bun.password.hash(data.newPassword);

      changes.hash = hash;
    }

    // If username change included, this request uses the change username rate limiter
    if ('username' in changes) {
      rateLimiterChangeUsername.consume(`session:${c.var.sessionId}`, 1)
        .then(async (res) => {
          setRateLimitHeaders(c, res.msBeforeNext, pointsChangeUsername, res.remainingPoints);
          
          await prisma.user.update({
            where: { id: user.id },
            data: changes
          });

          if ('email' in changes) {
            changes.verified = false;

            const emailVerification = createAndHashToken();

            await prisma.$transaction([
              prisma.emailVerificationToken.deleteMany({
                where: { userId: c.var.userId }
              }),
              prisma.emailVerificationToken.create({
                data: {
                  userId: c.var.userId,
                  hash: emailVerification.hash,
                  createdAt: new Date()
                }
              })
            ]);

            await sendEmailVerificationMail(changes.email as string, user.username, emailVerification.token);
          }

          if ('hash' in changes)
            await prisma.session.deleteMany({
              where: { userId: user.id }
            });

          return c.json({});
        })
        .catch((res) => {
          if (res instanceof RateLimiterRes) {
            setRateLimitHeaders(c, res.msBeforeNext, pointsChangeUsername, res.remainingPoints);
            return c.json({ error: Errors.RateLimited }, 429);
          } else {
            return c.json({ error: Errors.ServerError }, 500);
          }
        });
    } else {
      if ('email' in changes) {
        changes.verified = false;

        const emailVerification = createAndHashToken();

        await prisma.$transaction([
          prisma.emailVerificationToken.deleteMany({
            where: { userId: c.var.userId }
          }),
          prisma.emailVerificationToken.create({
            data: {
              userId: c.var.userId,
              hash: emailVerification.hash,
              createdAt: new Date()
            }
          })
        ]);

        await sendEmailVerificationMail(changes.email as string, user.username, emailVerification.token);
      }

      await prisma.user.update({
        where: { id: user.id },
        data: changes
      });

      if ('hash' in changes)
        await prisma.session.deleteMany({
          where: { userId: user.id }
        });

      return c.json({});
    }
  }
);

// Delete the authorized user
// DELETE /@me
app.delete(
  '/@me',
  describeRoute({
    description:
      'Delete the authorized user\n\n**⚠️ This process is irreversible!**',
    tags: ['Users'],
    security: [{ bearerAuth: [] }],
    responses: {
      204: {
        description: 'User deleted successfully'
      },
      401: {
        description: 'Authorization required',
        content: {
          'application/json': {
            schema: resolver(errorResponse)
          }
        }
      }
    }
  }),
  authMiddleware,
  async (c) => {
    // Delete user
    await prisma.user.delete({
      where: { id: c.var.userId }
    });

    // Delete all sessions
    await prisma.session.deleteMany({
      where: { userId: c.var.userId }
    });

    return c.status(204);
  }
);

// Update the authorized user's profile
// PATCH /users/@me/profile
app.patch(
  '/@me/profile',
  describeRoute({
    description:
      "Update the authorized user's profile\n\n**🔒 Requires Authorization**",
    tags: ['Users'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Profile updated successfully'
      },
      304: {
        description: 'No changes saved'
      },
      400: {
        description: 'Request failed',
        content: {
          'application/json': {
            schema: resolver(errorResponse)
          }
        }
      },
      401: {
        description: 'Authorization required',
        content: {
          'application/json': {
            schema: resolver(errorResponse)
          }
        }
      }
    }
  }),
  authMiddleware,
  validate('json', userUpdateProfileBody),
  async (c) => {
    const data = c.req.valid('json');

    const user = await prisma.user.findUnique({
      where: { id: c.var.userId },
      include: {
        profile: true
      }
    });

    if (!user ||!user?.profile) return c.json({ error: Errors.ServerError }, 500);

    if (
      data.displayName === undefined &&
      data.bio === undefined &&
      data.pronouns === undefined &&
      data.avatar === undefined
    )
      return c.status(304);

    const changes: { [x: string]: string | boolean | null } = {};

    // Avatar
    if (data.avatar !== undefined && data.avatar !== user.profile.avatar) {
      // Check the avatar exists in the CDN
      const checkForAvatar = new Promise<void>(async (resolve, reject) => {
        const listen = () => {
          ipc.once('message', (message: IPCMessage) => {
            if (typeof message.payload !== 'object' || message.payload === null) return;
            if ('type' in message.payload === false || 'action' in message.payload === false) return;

            if (message.payload.type !== 'response') return listen();
            if (message.from !== 'cdn') return listen();
            if (message.payload.action !== 'CHECK_IF_AVATAR_EXISTS') return listen();

            if ('userId' in message.payload && 'exists' in message.payload) {
              const userId = message.payload.userId as string;
              const exists = message.payload.exists as boolean;

              if (userId !== user.id) return reject();
              if (exists === false) return reject();

              return resolve();
            }

            else reject();
          });
        }

        listen();

        await ipc.send('cdn', {
          type: 'request',
          action: 'CHECK_IF_AVATAR_EXISTS',
          userId: c.var.userId
        });
      });

      try {
        await checkForAvatar;

        changes.avatar = data.avatar
      } catch (err) {
        return c.json({ error: Errors.AvatarNotInCDN }, 400);
      }
    }

    // Display Name
    if (data.displayName !== undefined && data.displayName !== user.profile.displayName) {
      changes.displayName = data.displayName;
    }

    // Bio
    if (data.bio !== undefined && data.bio !== user.profile.bio) {
      changes.bio = data.bio;
    }

    // Pronouns
    if (data.pronouns !== undefined && data.pronouns !== user.profile.pronouns) {
      changes.pronouns = data.pronouns;
    }

    await prisma.profile.update({
      where: { userId: user.id },
      data: changes
    });

    // Delete avatar from CDN if setting to false
    if ('avatar' in changes && changes.avatar === false) {
      if (changes.avatar === user.profile.avatar) return;

      await ipc.send('cdn', {
        type: 'request',
        action: 'DELETE_AVATAR_IF_EXISTS',
        userId: c.var.userId
      });
    }

    return c.json({});
  }
);

// Fetch the authorized user\'s friends
// GET /@me/friends
app.get(
  '/@me/friends',
  describeRoute({
    description: "Fetch the authorized user's friends\n\n**🔒 Requires Authorization**",
    tags: ['Users'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'List of friends',
        content: {
          'application/json': {
            schema: resolver(userGetFriendsResponse)
          }
        }
      },
      401: {
        description: 'Authorization required',
        content: {
          'application/json': {
            schema: resolver(errorResponse)
          }
        }
      }
    }
  }),
  authMiddleware,
  async (c) => {
    const user = await prisma.user.findUnique({
      where: { id: c.var.userId },
      include: {
        friends: {
          select: { id: true }
        }
      }
    });

    if (!user) return c.json({ error: Errors.ServerError }, 500);

    return c.json(user.friends.map(({ id }) => id));
  }
);

// Remove a friend
// DELETE /@me/friends/:userId
app.delete(
  '/@me/friends/:userId',
  describeRoute({
    description: 'Remove a friend\n\n**🔒 Requires Authorization**',
    tags: ['Users'],
    security: [{ bearerAuth: [] }],
    responses: {
      204: {
        description: 'Friend removed successfully'
      },
      400: {
        description: 'Request failed',
        content: {
          'application/json': {
            schema: resolver(errorResponse)
          }
        }
      },
      401: {
        description: 'Authorization required',
        content: {
          'application/json': {
            schema: resolver(errorResponse)
          }
        }
      }
    }
  }),
  authMiddleware,
  validate('param', userDeleteFriendParam),
  async (c) => {
    const { userId } = c.req.valid('param');

    // Check the users exist
    const user = await prisma.user.findUnique({
      where: { id: c.var.userId },
      include: { friends: { select: { id: true } } }
    });

    const friend = await prisma.user.findUnique({
      where: { id: userId },
      include: { friends: { select: { id: true } } }
    });

    if (!user || !friend) return c.json({ error: Errors.FriendNotFound }, 400);

    // Check the friendship exists
    const friendshipExists =
      user.friends.some(({ id }) => id === userId) &&
      friend.friends.some(({ id }) => id === c.var.userId);

    if (!friendshipExists) return c.json({ error: Errors.FriendNotFound }, 400);

    // Disconnect users/delete friendship
    await prisma.user.update({
      where: { id: c.var.userId },
      data: { friends: { disconnect: { id: userId } } }
    });

    await prisma.user.update({
      where: { id: userId },
      data: { friends: { disconnect: { id: c.var.userId } } }
    });

    // Send Gateway events
    await ipc.send('gateway', {
      type: 'event',
      event: 'FRIEND_DELETE',
      client: c.var.userId,
      userId
    });

    await ipc.send('gateway', {
      type: 'event',
      event: 'FRIEND_DELETE',
      client: userId,
      userId: c.var.userId
    });

    return c.body(null, 204);
  }
);

// Fetch the authorized user\'s friend requests (incoming, outgoing)
// GET /@me/requests
app.get(
  '/@me/requests',
  describeRoute({
    description:
      "Fetch the authorized user's friend requests (incoming, outgoing)\n\n**🔒 Requires Authorization**",
    tags: ['Users'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'List of friend requests',
        content: {
          'application/json': {
            schema: resolver(userGetRequestsResponse)
          }
        }
      },
      401: {
        description: 'Authorization required',
        content: {
          'application/json': {
            schema: resolver(errorResponse)
          }
        }
      }
    }
  }),
  authMiddleware,
  async (c) => {
    const requests = await prisma.request.findMany({
      where: {
        OR: [{ fromUserId: c.var.userId }, { toUserId: c.var.userId }]
      }
    });

    return c.json(
      requests.map((request) => ({
        direction:
          request.fromUserId === c.var.userId ? 'OUTGOING' : 'INCOMING',
        from: request.fromUserId,
        to: request.toUserId
      }))
    );
  }
);

// Send a friend request
// POST /@me/requests
app.post(
  '/@me/requests',
  describeRoute({
    description: 'Send a friend request\n\n**🔒 Requires Authorization**',
    tags: ['Users'],
    security: [{ bearerAuth: [] }],
    responses: {
      201: {
        description: 'Request sent successfully'
      },
      400: {
        description: 'Request failed',
        content: {
          'application/json': {
            schema: resolver(errorResponse)
          }
        }
      },
      401: {
        description: 'Authorization required',
        content: {
          'application/json': {
            schema: resolver(errorResponse)
          }
        }
      }
    }
  }),
  authMiddleware,
  validate('json', userCreateRequestBody),
  async (c) => {
    // From: c.var.userId
    // To: receiver.id

    const { username } = c.req.valid('json');

    // Validate the receiver exists
    const receiver = await prisma.user.findUnique({
      where: { username }
    });

    if (!receiver) return c.json({ error: Errors.UserNotFound }, 400);

    // Make sure sender isn't the same user
    if (receiver.id === c.var.userId)
      return c.json({ error: Errors.CannotSendRequestToSelf }, 400);

    // Validate request hasn't been sent already
    const request = await prisma.request.findFirst({
      where: {
        OR: [
          { fromUserId: c.var.userId, toUserId: receiver.id },

          // Prevent reverse duplication (ie. if sender sent a request, then receiver tried to send a request too)
          { fromUserId: receiver.id, toUserId: c.var.userId }
        ]
      }
    });

    if (request) return c.json({ error: Errors.RequestAlreadySent }, 400);

    // Create friend request
    await prisma.request.create({
      data: {
        type: 'FRIEND_REQUEST',
        fromUser: {
          connect: {
            id: c.var.userId
          }
        },
        toUser: {
          connect: {
            id: receiver.id
          }
        }
      }
    });

    // Send Gateway events
    await ipc.send('gateway', {
      type: 'event',
      event: 'REQUEST_CREATE',
      client: c.var.userId,
      from: c.var.userId,
      to: receiver.id,
      direction: 'OUTGOING'
    });

    await ipc.send('gateway', {
      type: 'event',
      event: 'REQUEST_CREATE',
      client: receiver.id,
      from: c.var.userId,
      to: receiver.id,
      direction: 'INCOMING'
    });

    return c.body(null, 201);
  }
);

// Accept/ignore an incoming friend request
// PATCH /@me/requests/:userId
app.patch(
  '/@me/requests/:userId',
  describeRoute({
    description: 'Accept/ignore a friend request\n\n**🔒 Requires Authorization**',
    tags: ['Users'],
    security: [{ bearerAuth: [] }],
    responses: {
      201: {
        description: 'Friend request accepted/ignored successfully'
      },
      400: {
        description: 'Request failed',
        content: {
          'application/json': {
            schema: resolver(errorResponse)
          }
        }
      },
      401: {
        description: 'Authorization required',
        content: {
          'application/json': {
            schema: resolver(errorResponse)
          }
        }
      }
    }
  }),
  authMiddleware,
  validate('param', userUpdateRequestParam),
  validate('json', userUpdateRequestBody),
  async (c) => {
    // As this is an incoming friend request, look up the request by "from"
    // (it's coming *from* another user, aka. incoming)

    // From: userId
    // To: c.var.userId

    const { userId } = c.req.valid('param');
    const { accept } = c.req.valid('json');

    // Find request
    const request = await prisma.request.findFirst({
      where: { fromUserId: userId }
    });

    if (!request) return c.json({ error: Errors.RequestNotFound }, 400);

    // If accepting, add friend to both users
    if (accept) {
      await prisma.user.update({
        where: { id: userId },
        data: {
          friends: { connect: { id: c.var.userId } }
        }
      });

      await prisma.user.update({
        where: { id: c.var.userId },
        data: {
          friends: { connect: { id: userId } }
        }
      });
    }

    // Delete request
    await prisma.request.delete({
      where: { id: request.id }
    });

    // Send Gateway events
    await ipc.send('gateway', {
      type: 'event',
      event: 'REQUEST_DELETE',
      client: c.var.userId,
      from: userId,
      to: c.var.userId,
      direction: 'INCOMING'
    });

    await ipc.send('gateway', {
      type: 'event',
      event: 'REQUEST_DELETE',
      client: userId,
      from: userId,
      to: c.var.userId,
      direction: 'OUTGOING'
    });

    if (accept) {
      await ipc.send('gateway', {
        type: 'event',
        event: 'FRIEND_CREATE',
        client: c.var.userId,
        userId
      });

      await ipc.send('gateway', {
        type: 'event',
        event: 'FRIEND_CREATE',
        client: userId,
        userId: c.var.userId
      });
    }

    return c.body(null, 201);
  }
);

// Cancel an outgoing friend request
// DELETE /@me/requests/:userId
app.delete(
  '/@me/requests/:userId',
  describeRoute({
    description: 'Cancel an outgoing friend request\n\n**🔒 Requires Authorization**',
    tags: ['Users'],
    security: [{ bearerAuth: [] }],
    responses: {
      204: {
        description: 'Friend request cancelled successfully'
      },
      400: {
        description: 'Request failed',
        content: {
          'application/json': {
            schema: resolver(errorResponse)
          }
        }
      },
      401: {
        description: 'Authorization required',
        content: {
          'application/json': {
            schema: resolver(errorResponse)
          }
        }
      }
    }
  }),
  authMiddleware,
  validate('param', userDeleteRequestParam),
  async (c) => {
    // As this is an outgoing friend request, look up the request by "to"
    // (it's going *to* another user, aka. outgoing)

    // From: c.var.userId
    // To: userId

    const { userId } = c.req.valid('param');

    // Find request
    const request = await prisma.request.findFirst({
      where: { toUserId: userId }
    });

    if (!request) return c.json({ error: Errors.RequestNotFound }, 400);

    // Delete request
    await prisma.request.delete({
      where: { id: request.id }
    });

    // Send Gateway events
    await ipc.send('gateway', {
      type: 'event',
      event: 'REQUEST_DELETE',
      client: c.var.userId,
      from: c.var.userId,
      to: userId,
      direction: 'OUTGOING'
    });

    await ipc.send('gateway', {
      type: 'event',
      event: 'REQUEST_DELETE',
      client: userId,
      from: c.var.userId,
      to: userId,
      direction: 'INCOMING'
    });

    return c.body(null, 204);
  }
);

// Fetch the authorized user's blocked users
// GET /@me/blocked
app.get('/@me/blocked',   describeRoute({
    description:
      "Fetch the authorized user's blocked users\n\n**🔒 Requires Authorization**",
    tags: ['Users'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'List of blocked users',
        content: {
          'application/json': {
            schema: resolver(userGetBlockedResponse)
          }
        }
      },
      401: {
        description: 'Authorization required',
        content: {
          'application/json': {
            schema: resolver(errorResponse)
          }
        }
      }
    }
  }), authMiddleware, async (c) => {
  const blocked = await prisma.userBlock.findMany({
    where: { userId: c.var.userId },
    select: {
      blockedUserId: true,
      createdAt: true
    }
  });

  return c.json(blocked.map((block) => ({
    id: block.blockedUserId,
    createdAt: block.createdAt
  })));
});

// Block a user
// POST /@me/blocked
app.post(
  '/@me/blocked',
  describeRoute({
    description: 'Block a user\n\n**🔒 Requires Authorization**',
    tags: ['Users'],
    security: [{ bearerAuth: [] }],
    responses: {
      201: {
        description: 'User blocked successfully'
      },
      400: {
        description: 'Request failed',
        content: {
          'application/json': {
            schema: resolver(errorResponse)
          }
        }
      },
      401: {
        description: 'Authorization required',
        content: {
          'application/json': {
            schema: resolver(errorResponse)
          }
        }
      }
    }
  }),
  authMiddleware,
  validate('json', userCreateBlockedBody),
  async (c) => {
    const { userId } = c.req.valid('json');

    // Validate the user exists
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) return c.json({ error: Errors.UserNotFound }, 400);
    if (user.id === c.var.userId) return c.json({ error: Errors.CannotBlockSelf }, 400);

    // Validate block doesn't already exist
    const existingBlock = await prisma.userBlock.findUnique({
      where: {
        userId_blockedUserId: {
          userId: c.var.userId,
          blockedUserId: userId
        }
      }
    });

    if (existingBlock) return c.json({ error: Errors.AlreadyBlocked }, 400);

    // If the users are friends, delete the friendship
    const friendship = await prisma.user.findFirst({
      where: {
        id: c.var.userId,
        OR: [
          { friends: { some: { id: userId } } },
          { friendOf: { some: { id: userId } } }
        ]
      }
    });

    if (friendship) {
      await prisma.user.update({
        where: { id: c.var.userId },
        data: {
          friends: {
            disconnect: { id: userId },
          },
          friendOf: {
            disconnect: { id: userId },
          },
        },
      });
      
      await ipc.send('gateway', {
        type: 'event',
        event: 'FRIEND_DELETE',
        client: c.var.userId,
        userId
      });

      await ipc.send('gateway', {
        type: 'event',
        event: 'FRIEND_DELETE',
        client: userId,
        userId: c.var.userId
      });
    }

    // Create block
    await prisma.userBlock.create({
      data: {
        userId: c.var.userId,
        blockedUserId: userId
      }
    });

    // Send gateway event
    await ipc.send('gateway', {
      type: 'event',
      event: 'BLOCK_CREATE',
      client: c.var.userId,
      userId
    });

    return c.json(null, 201);
  }
);

// Unblock a user
// DELETE /@me/blocked/:userId
app.delete(
  '/@me/blocked/:userId',
  describeRoute({
    description: 'Unblock a user\n\n**🔒 Requires Authorization**',
    tags: ['Users'],
    security: [{ bearerAuth: [] }],
    responses: {
      204: {
        description: 'User unblocked successfully'
      },
      400: {
        description: 'Request failed',
        content: {
          'application/json': {
            schema: resolver(errorResponse)
          }
        }
      },
      401: {
        description: 'Authorization required',
        content: {
          'application/json': {
            schema: resolver(errorResponse)
          }
        }
      }
    }
  }),
  authMiddleware,
  validate('param', userDeleteBlockedParam),
  async (c) => {
    const { userId } = c.req.valid('param');

    // Validate that block exists
    const existingBlock = await prisma.userBlock.findUnique({
      where: {
        userId_blockedUserId: {
          userId: c.var.userId,
          blockedUserId: userId
        }
      }
    });

    if (!existingBlock) return c.json({ error: Errors.NotBlocked }, 400);

    await prisma.userBlock.delete({
      where: {
        userId_blockedUserId: {
          userId: c.var.userId,
          blockedUserId: userId
        }
      }
    });

    // Send gateway event
    await ipc.send('gateway', {
      type: 'event',
      event: 'BLOCK_DELETE',
      client: c.var.userId,
      userId
    });

    return c.body(null, 204);
  }
);

// Get open direct messages and group channels
// TODO: GET /@me/channels

// Create or open a direct message/create a group channel
// TODO: POST /@me/channels

// Get direct message/group channel
// TODO: GET /@me/channels/:channelId

// Update direct message/group channel
// TODO: PATCH /@me/channels/:channelId

// Close a direct message/delete a group channel
// TODO: DELETE /@me/channels/:channelId

// TODO: ✨ messages ✨

// Fetch a user by ID
// GET /users/:userId
app.get(
  '/:userId',
  describeRoute({
    description:
      'Fetch a user by ID\n\nFor privacy, this route will only return basic information, unless you share a relation with the user (ie. you share a server, are friends, etc.)\n\n**🔒 Requires Authorization**',
    tags: ['Users'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Partial/full User object',
        content: {
          'application/json': {
            schema: resolver(userGetResponse)
          }
        }
      },
      401: {
        description: 'Authorization required',
        content: {
          'application/json': {
            schema: resolver(errorResponse)
          }
        }
      },
      404: {
        description: 'User not found',
        content: {
          'application/json': {
            schema: resolver(errorResponse)
          }
        }
      }
    }
  }),
  authMiddleware,
  validate('param', userGetParam),
  async (c) => {
    const { userId: id } = c.req.valid('param');

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        username: true,
        profile: true
      }
    });

    if (!user) return c.json({ error: Errors.UserNotFound }, 404);

    // TODO: check relation :)

    return c.json(user);
  }
);

// Check username availability
// GET /availability
app.get(
  '/availability/:username',
  describeRoute({
    description: 'Check username availability',
    tags: ['Users'],
    responses: {
      200: {
        description: 'Availability result',
        content: {
          'application/json': {
            schema: resolver(userGetUsernameAvailabilityResponse)
          }
        }
      }
    }
  }),
  validate('param', userGetUsernameAvailabilityParam),
  async (c) => {
    const { username } = c.req.valid('param');

    const user = await prisma.user.findUnique({
      where: { username }
    });

    if (!user) return c.json(true);

    return c.json(false);
  }
);

// Verify an email address
// POST /verify
app.post(
  '/verify',
  describeRoute({
    description: 'Verify an email address',
    tags: ['Users'],
    responses: {
      200: {
        description: 'Email address verified',
        content: {
          'application/json': {
            schema: resolver(userVerifyEmailAddressResponse)
          }
        }
      },
      400: {
        description: 'Request failed',
        content: {
          'application/json': {
            schema: resolver(errorResponse)
          }
        }
      }
    }
  }),
  validate('json', userVerifyEmailAddressBody),
  async (c) => {
    const { token } = c.req.valid('json');

    const hash = hashToken(token);

    const record = await prisma.emailVerificationToken.findFirst({
      where: { hash }
    });

    if (!record) return c.json({ error: Errors.InvalidToken }, 400);

    const createdAt = new Date(record.createdAt).getTime();
    const now = Date.now();

    // 24 hours
    if (now - createdAt > 86400000) return c.json({ error: Errors.ExpiredToken }, 400);

    // Verify user, delete verification token record
    await prisma.$transaction([
      prisma.user.update({
        where: { id: record.userId },
        data: { verified: true }
      }),
      prisma.emailVerificationToken.delete({
        where: { id: record.id }
      })
    ]);

    // todo: tell gateway, if they are logged in then the state should update in client
    await ipc.send('gateway', {
      type: 'event',
      event: 'EMAIL_VERIFIED',
      client: record.userId,
      verified: true
    });

    return c.json({ verified: true });
  }
);

// Resend email verification
// POST /verify/resend
app.post(
  '/verify/resend',
  describeRoute({
    description: 'Resend email verification\n\n**🔒 Requires Authorization**',
    tags: ['Users'],
    security: [{ bearerAuth: [] }],
    responses: {
      201: {
        description: 'Email sent successfully'
      },
      400: {
        description: 'Request failed',
        content: {
          'application/json': {
            schema: resolver(errorResponse)
          }
        }
      },
      401: {
        description: 'Authorization required',
        content: {
          'application/json': {
            schema: resolver(errorResponse)
          }
        }
      },
    }
  }),
  authMiddleware,
  async (c) => {
    // Get user
    const user = await prisma.user.findUnique({
      where: {
        id: c.var.userId
      },
      select: {
        email: true,
        username: true,
        verified: true
      }
    });

    if (!user) return c.json({ error: Errors.ServerError }, 500);
    if (user.verified) return c.json({ error: Errors.AlreadyVerified }, 400);

    // Create new verification token
    const emailVerification = createAndHashToken();

    await prisma.$transaction([
      prisma.emailVerificationToken.delete({
        where: { userId: c.var.userId }
      }),
      prisma.emailVerificationToken.create({
        data: {
          userId: c.var.userId,
          hash: emailVerification.hash,
          createdAt: new Date()
        }
      })
    ]);

    await sendEmailVerificationMail(user.email, user.username, emailVerification.token);

    return c.body(null, 201);
  }
);

export default app;
