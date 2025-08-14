import { createMiddleware } from 'hono/factory';
import { jwtVerify, SignJWT } from 'jose';
import { Errors } from '../constants';
import prisma from '../handlers/db';
import { generateSnowflake } from './snowflake';

const secret = new TextEncoder().encode(process.env.SESSION_SECRET ?? '');

// Encode/create session token
export const encodeToken = async (
  userId: string
): Promise<{ sessionId: string; token: string }> => {
  if (!userId || userId === '') throw 'Missing userId';

  const sessionId = generateSnowflake();

  const token = await new SignJWT({
    sessionId: sessionId,
    userId: userId
  })
    .setProtectedHeader({
      alg: 'HS256'
    })
    .setIssuedAt()
    .setExpirationTime('12w')
    .setIssuer('pygmy:rest')
    .setAudience('pygmy:rest,pygmy:gateway')
    .sign(secret);

  return {
    sessionId,
    token
  };
};

// Validate session token
export const validateToken = async (
  token: string
): Promise<{ sessionId: string; userId: string }> => {
  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer: 'pygmy:rest',
      audience: 'pygmy:rest,pygmy:gateway'
    });

    if (!payload.sessionId || typeof payload.sessionId !== 'string')
      throw 'Invalid token (missing sessionId)';
    if (!payload.userId || typeof payload.userId !== 'string')
      throw 'Invalid token (missing userId)';

    return {
      sessionId: payload.sessionId,
      userId: payload.userId
    };
  } catch (err) {
    console.error(err);

    throw 'Invalid token';
  }
};

// Authorized middleware
export const authMiddleware = createMiddleware<{
  Variables: {
    sessionId: string;
    userId: string;
  };
}>(async (c, next) => {
  // Get header
  const header = c.req.header('Authorization');
  if (!header || header === '')
    return c.json({ error: Errors.InvalidToken }, 401);

  // Check it is valid (Bearer and non-empty)
  const [type, token, ...other] = header.split(' ');
  if (!type || !token || other.length !== 0)
    return c.json({ error: Errors.InvalidToken }, 401);
  if (type !== 'Bearer') return c.json({ error: Errors.InvalidTokenType }, 401);

  try {
    // Validate token
    const { sessionId: id } = await validateToken(token);

    // Check session is still valid in database
    const session = await prisma.session.findUnique({
      where: { id }
    });

    if (!session) return c.json({ error: Errors.ExpiredToken }, 401);

    // If session hasn't been used in more than 2 weeks, it should be expired
    const now = new Date();
    const weekAgo = new Date();

    weekAgo.setDate(now.getDate() - 14);

    if (session.lastUse < weekAgo) {
      await prisma.session.delete({
        where: { id }
      });

      return c.json({ error: Errors.ExpiredToken }, 401);
    }

    // Update session last use
    await prisma.session.update({
      where: { id },
      data: {
        lastUse: new Date()
      }
    });

    // Set session variables and continue request
    c.set('sessionId', session.id);
    c.set('userId', session.userId);

    await next();
  } catch (err) {
    console.error(err);
    
    return c.json({ error: Errors.InvalidToken }, 401);
  }
});
