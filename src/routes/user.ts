import { eq, getTableColumns } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Hono } from 'hono';
import { describeRoute, resolver } from 'hono-openapi';
import { Errors } from '../constants';
import { sessionsTable, usersTable } from '../db/schema';
import { sendMail } from '../handlers/mail';
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
  userGetSelfResponse,
  userUpdateBody,
  userUpdateRequestBody,
  userUpdateRequestParam
} from '../schemas/user';

const app = new Hono();
const db = drizzle(process.env.DATABASE_URL ?? '');

// Create user
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
    const existingEmail = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email));

    if (existingEmail.length > 0)
      return c.json({ error: Errors.EmailAlreadyInUse }, 400);

    // Check if username is already in use
    const existingUsername = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.username, username));

    if (existingUsername.length > 0)
      return c.json({ error: Errors.UsernameAlreadyInUse }, 400);

    // Add user to database
    const id = generateSnowflake();
    const hash = await Bun.password.hash(password);

    const user: typeof usersTable.$inferInsert = {
      id,
      username,
      email,
      hash,
      verified: false
    };

    await db.insert(usersTable).values(user);

    return c.json({ id }, 201);
  }
);

// Get current user
app.get(
  '/@me',
  describeRoute({
    description: 'Fetch the authorized user\n\n**🔒 Requires Authorization**',
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
    const { hash, ...columns } = getTableColumns(usersTable);

    const [user] = await db
      .select({ ...columns })
      .from(usersTable)
      .where(eq(usersTable.id, c.var.userId));

    if (!user) return c.json({ error: Errors.ServerError }, 500);

    return c.json(user);
  }
);

// Edit user
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

    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, c.var.userId));

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
      if (!data.currentPassword) return c.json({ error: Errors.CurrentPasswordRequired }, 400);

      const currentPasswordValid = await Bun.password.verify(data.currentPassword, user.hash)

      if (!currentPasswordValid) return c.json({ error: Errors.InvalidPassword }, 401);

      // Check that new email address isn't in use
      const existingEmail = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.email, data.email));

      if (existingEmail.length > 0)
        return c.json({ error: Errors.EmailAlreadyInUse }, 400);

      changes.email = data.email;
    }

    // Username
    if (data.username !== undefined && data.username !== user.username) {
      // Check that new username isn't in use
      const existingUsername = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.username, data.username));

      if (existingUsername.length > 0)
        return c.json({ error: Errors.UsernameAlreadyInUse }, 400);

      changes.username = data.username.toLowerCase();
    }

    // Password
    if (data.newPassword !== undefined) {
      // Check that current password is correct
      if (!data.currentPassword) return c.json({ error: Errors.CurrentPasswordRequired }, 400);

      const currentPasswordValid = await Bun.password.verify(data.currentPassword, user.hash)

      if (!currentPasswordValid) return c.json({ error: Errors.InvalidPassword }, 401);

      // Check that new password isn't the same as the current password
      const passwordMatch = await Bun.password.verify(data.newPassword, user.hash);

      if (passwordMatch) return c.json({ error: Errors.PasswordNotChanged }, 401);

      // Hash new password
      const hash = await Bun.password.hash(data.newPassword);

      changes.hash = hash;
    }

    // Save changes
    await db.update(usersTable)
      .set(changes)
      .where(eq(usersTable.id, c.var.userId));

    // Invalidate sessions, if required
    if ('hash' in changes) {
      await db
        .delete(sessionsTable)
        .where(eq(sessionsTable.userId, c.var.userId));
    }

    return c.json({});
  }
);

// Delete user
app.delete(
  '/@me',
  describeRoute({
    description:
      'Delete the authorized user\n\n**⚠️ This process is irreversible!**\n\n**🔒 Requires Authorization**',
    tags: ['Users'],
    security: [{ bearerAuth: [] }],
    responses: {
      204: {
        description: 'User deleted successfully'
      }
    }
  }),
  authMiddleware,
  async (c) => {
    await db.delete(usersTable).where(eq(usersTable.id, c.var.userId));

    return c.status(204);
  }
);

// Get friends
// GET /@me/friends
app.get('/@me/friends', authMiddleware, async (c) => {});

// Remove a friend
// DELETE /@me/friends/:userId
app.delete('/@me/friends/:userId', authMiddleware, validate('param', userDeleteFriendParam), async (c) => {});

// Get friend requests (incoming, outgoing)
// GET /@me/requests
app.get('/@me/requests', authMiddleware, async (c) => {});

// Send a friend request
// POST /@me/requests
app.post('/@me/requests', authMiddleware, validate('json', userCreateRequestBody), async (c) => {});

// Accept/ignore an incoming friend request
// PATCH /@me/requests/:userId
app.patch('/@me/requests/:userId', authMiddleware, validate('param', userUpdateRequestParam), validate('json', userUpdateRequestBody), async (c) => {});

// Cancel an outgoing friend request
// DELETE /@me/requests/:userId
app.delete('/@me/requests/:userId', authMiddleware, validate('param', userDeleteRequestParam), async (c) => {});

// Get blocked users
// GET /@me/blocked
app.get('/@me/blocked', authMiddleware, async (c) => {});

// Block a user
// POST /@me/blocked
app.post('/@me/blocked', authMiddleware, validate('json', userCreateBlockedBody), async (c) => {});

// Unblock a user
// DELETE /@me/blocked/:userId
app.delete('/@me/blocked/:userId', authMiddleware, validate('param', userDeleteBlockedParam), async (c) => {});

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

export default app;
