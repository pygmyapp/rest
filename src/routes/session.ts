import { Hono } from 'hono';
import { describeRoute, resolver } from 'hono-openapi';
import { Errors } from '../constants';
import prisma from '../handlers/db';
import { authMiddleware, encodeToken } from '../handlers/session';
import { validate } from '../handlers/validator';
import {
  sessionCreateBody,
  sessionCreateResponse,
  sessionDeleteParam,
  sessionListResponse
} from '../schemas/session';
import { errorResponse } from '../schemas/shared';

const app = new Hono();

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
    const sessions = await prisma.session.findMany({
      where: { userId: c.var.userId }
    });

    if (!sessions.length) return c.json([]);

    return c.json(
      sessions.map(({ id, userId, lastUse }) => ({
        id,
        userId,
        lastUsed: lastUse,
        active: id === c.var.sessionId
      }))
    );
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
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, hash: true }
    });

    if (!user) return c.json({ error: Errors.InvalidEmailOrPassword }, 401);

    // Validate password
    const valid = await Bun.password.verify(password, user.hash);

    if (!valid) return c.json({ error: Errors.InvalidEmailOrPassword }, 401);

    // Generate token
    const { sessionId, token } = await encodeToken(user.id);

    // Add session to database
    await prisma.session.create({
      data: {
        id: sessionId,
        userId: user.id
      }
    });

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
    await prisma.session.deleteMany({
      where: { userId: c.var.userId }
    });

    return c.body(null, 204);
  }
);

// Delete (log out) the currently authorized/logged in session
app.delete(
  '/@me',
  describeRoute({
    description:
      'Delete (log out) the current session in use\n\n**🔒 Requires Authorization**',
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
  async (c) => {
    await prisma.session.delete({
      where: { id: c.var.sessionId }
    });

    return c.body(null, 204);
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
  validate('param', sessionDeleteParam),
  async (c) => {
    const { sessionId: id } = c.req.valid('param');

    const session = await prisma.session.findUnique({
      where: { id }
    });

    if (!session) return c.json({ error: Errors.SessionNotFound }, 404);

    await prisma.session.delete({
      where: { id }
    });

    return c.body(null, 204);
  }
);

export default app;
