import { Hono } from 'hono';
import { describeRoute, resolver } from 'hono-openapi';
import { Errors } from '../constants';
import prisma from '../handlers/db';
// import { sendMail } from '../handlers/mail';
import { authMiddleware } from '../handlers/session';
import { generateSnowflake } from '../handlers/snowflake';
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
  userGetFriendsResponse,
  userGetParam,
  userGetRequestsResponse,
  userGetResponse,
  userGetSelfResponse, 
  userUpdateBody,
  userUpdateRequestBody,
  userUpdateRequestParam
} from '../schemas/user';
import { ipc } from '../handlers/ipc';

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
        hash
      }
    });

    return c.json({ id }, 201);
  }
);

// Fetch the authorized user
// GET /users/@me
app.get(
  '/@me',
  describeRoute({
    description: 'Fetch the authorized user\n\nThis route will return additional details that can only be accessed by the authorized user',
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
      omit: { hash: true }
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

    const changes: { [x: string]: string } = {};

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

    // Save changes
    await prisma.user.update({
      where: { id: user.id },
      data: changes
    });

    // Invalidate sessions, if required
    if ('hash' in changes)
      await prisma.session.deleteMany({
        where: { userId: user.id }
      });

    return c.json({});
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

// Fetch the authorized user\'s friends
// GET /@me/friends
app.get(
  '/@me/friends',
  describeRoute({
    description: 'Fetch the authorized user\'s friends',
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

    return c.json(
      user.friends.map(({ id }) => id)
    );
  }
);

// Remove a friend
// DELETE /@me/friends/:userId
app.delete(
  '/@me/friends/:userId',
  describeRoute({
    description: 'Remove a friend',
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
    description: 'Fetch the authorized user\'s friend requests (incoming, outgoing)',
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
    description: 'Send a friend request',
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
    description: 'Accept/ignore a friend request',
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

// Get blocked users
// GET /@me/blocked
app.get('/@me/blocked', authMiddleware, async (c) => {
  return c.json([])
});

// Block a user
// POST /@me/blocked
app.post(
  '/@me/blocked',
  authMiddleware,
  validate('json', userCreateBlockedBody),
  async (c) => {}
);

// Unblock a user
// DELETE /@me/blocked/:userId
app.delete(
  '/@me/blocked/:userId',
  authMiddleware,
  validate('param', userDeleteBlockedParam),
  async (c) => {}
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
    description: 'Fetch a user by ID\n\nFor privacy, this route will only return basic information, unless you share a relation with the user (ie. you share a server, are friends, etc.)',
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
        username: true
      }
    });

    if (!user) return c.json({ error: Errors.UserNotFound }, 404);

    // TODO: check relation :)

    return c.json(user);
  }
);

export default app;
