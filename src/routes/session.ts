import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Hono } from 'hono';
import { describeRoute, resolver } from 'hono-openapi';
import { Errors } from '../constants';
import { sessionsTable, usersTable } from '../db/schema';
import { authMiddleware, encodeToken } from '../handlers/session';
import { validate } from '../handlers/validator';
import {
  sessionCreateBody,
  sessionCreateResponse,
  sessionDeleteQuery,
  sessionListResponse
} from '../schemas/session';
import { errorResponse } from '../schemas/shared';

const app = new Hono();
const db = drizzle(process.env.DATABASE_URL ?? '');

// Get all sessions of logged in user
app.get(
  '/',
  describeRoute({
    description:
      "Fetch a list of the authorized user's active sessions\n\n**🔒 Requires Authorization**",
    tags: ['Sessions'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'List of sessions',
        content: {
          'application/json': {
            schema: resolver(sessionListResponse)
          }
        }
      }
    }
  }),
  authMiddleware,
  async (c) => {
    const sessions = await db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.userId, c.var.userId));

    if (sessions === undefined)
      return c.json({ error: Errors.ServerError }, 500);

    const formatted = sessions.map(({ id, userId, lastUse }) => ({
      id,
      userId,
      lastUsed: lastUse,
      active: id === c.var.sessionId
    }));

    return c.json(formatted);
  }
);

// Create session (log in)
app.post(
  '/',
  describeRoute({
    description: 'Create a new session (log in)',
    tags: ['Sessions'],
    responses: {
      201: {
        description: 'Session created',
        content: {
          'application/json': {
            schema: resolver(sessionCreateResponse)
          }
        }
      },
      401: {
        description: 'Invalid email or password',
        content: {
          'application/json': {
            schema: resolver(errorResponse)
          }
        }
      }
    }
  }),
  validate('json', sessionCreateBody),
  async (c) => {
    const { email, password } = c.req.valid('json');

    // Find user
    const [user] = await db
      .select({ id: usersTable.id, hash: usersTable.hash })
      .from(usersTable)
      .where(eq(usersTable.email, email));

    if (user === undefined)
      return c.json({ error: Errors.InvalidEmailOrPassword }, 401);

    // Validate password
    const valid = await Bun.password.verify(password, user.hash);

    if (!valid) return c.json({ error: Errors.InvalidEmailOrPassword }, 401);

    // Generate token
    const { sessionId, token } = await encodeToken(user.id);

    // Add session to database
    const session: typeof sessionsTable.$inferInsert = {
      id: sessionId,
      userId: user.id
    };

    await db.insert(sessionsTable).values(session);

    return c.json(
      {
        sessionId,
        token
      },
      201
    );
  }
);

// Delete (log out) all sessions
// (including currently authorized/logged in session)
app.delete(
  '/',
  describeRoute({
    description:
      'Delete (log out) all sessions, including the current session in use\n\n**🔒 Requires Authorization**',
    tags: ['Sessions'],
    security: [{ bearerAuth: [] }],
    responses: {
      204: {
        description: 'All sessions deleted'
      }
    }
  }),
  authMiddleware,
  async (c) => {
    await db
      .delete(sessionsTable)
      .where(eq(sessionsTable.userId, c.var.userId));

    return c.status(204);
  }
);

// Delete (log out) a session
app.delete(
  '/:sessionId',
  describeRoute({
    description:
      'Delete (log out) a specific session by ID\n\n**🔒 Requires Authorization**',
    tags: ['Sessions'],
    security: [{ bearerAuth: [] }],
    responses: {
      204: {
        description: 'Session deleted'
      },
      404: {
        description: 'Session not found (invalid or expired)',
        content: {
          'application/json': {
            schema: resolver(errorResponse)
          }
        }
      }
    }
  }),
  authMiddleware,
  validate('query', sessionDeleteQuery),
  async (c) => {
    const id = c.req.valid('query');

    const [session] = await db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.id, id));

    if (session === undefined)
      return c.json({ error: Errors.SessionNotFound }, 404);

    await db.delete(sessionsTable).where(eq(sessionsTable.id, id));

    return c.status(204);
  }
);

export default app;
