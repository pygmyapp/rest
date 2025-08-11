import { eq, getTableColumns } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Hono } from 'hono';
import { describeRoute, resolver } from 'hono-openapi';
import { Errors } from '../constants';
import { usersTable } from '../db/schema';
import { sendMail } from '../handlers/mail';
import { authMiddleware } from '../handlers/session';
import { generateSnowflake } from '../handlers/snowflake';
import { validate } from '../handlers/validator';
import { errorResponse } from '../schemas/shared';
import {
  userCreateBody,
  userCreateResponse,
  userGetSelfResponse,
  userUpdateBody
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
      return c.json({ error: Errors.EmailAlreadyInUse }, 400);

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
      "Update the authorized user's details\n\nTo change the user's email address or password, the user's current password is required in the `currentPassword` field for security purposes.\n\n**🔒 Requires Authorization**",
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

    if (
      data.email === undefined &&
      data.username === undefined &&
      data.newPassword === undefined
    )
      return c.status(304);

    const changes: { [x: string]: string } = {};

    // Email
    if (data.email !== undefined) {
    }

    // Username
    if (data.username !== undefined) {
    }

    // Password
    if (data.newPassword !== undefined) {
    }

    // Save changes
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

export default app;
