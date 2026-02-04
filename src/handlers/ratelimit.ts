import type { Context } from 'hono'
import { getConnInfo } from 'hono/bun';
import { createMiddleware } from 'hono/factory';
import { Redis } from 'ioredis';
import { RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';
import { Errors } from '../constants';

// Rate limit points
const limitMultiplier = process.env.NODE_ENV === 'development' ? 100 : 1;

const pointsGlobal = 300 * limitMultiplier;
const pointsRegiser = 10 * limitMultiplier;
export const pointsChangeUsername = 1 * limitMultiplier;
const pointsVerifyResend = 1 * limitMultiplier;

// Redis (Valkey) client
export const redis = new Redis({
  enableOfflineQueue: false
});

// Normalize IP
export const normalizeIP = (ip: string | null): string | null => {
  if (!ip) return null;
  if (ip.startsWith('::ffff:')) return ip.slice(7);
  if (ip === '::1') return '127.0.0.1';
  return ip;
}

// Get IP
export const getRequestIP = (c: Context): string | null => {
  const info = getConnInfo(c);
  
  return normalizeIP(
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    info.remote?.address ||
    null
  );
}

// Set rate limit headers
export const setRateLimitHeaders = (c: Context, msBeforeNext: number, limit: number, remaining: number): void => {
  c.header('Retry-After', (msBeforeNext / 1000).toString());
  c.header('X-RateLimit-Limit', limit.toString());
  c.header('X-RateLimit-Remaining', remaining.toString());
  c.header('X-RateLimit-Reset', Math.ceil((Date.now() + msBeforeNext) / 1000).toString());
}

// Rate limiters
const rateLimiter = new RateLimiterRedis({
  keyPrefix: 'pygmy:ratelimit:global',
  storeClient: redis,
  inMemoryBlockOnConsumed: pointsGlobal,
  points: pointsGlobal,
  duration: 60 // 1 minute
});

const rateLimiterRegister = new RateLimiterRedis({
  keyPrefix: 'pygmy:ratelimit:register',
  storeClient: redis,
  inMemoryBlockOnConsumed: pointsRegiser,
  points: pointsRegiser,
  duration: 60 * 60 // 1 hour
});

export const rateLimiterChangeUsername = new RateLimiterRedis({
  keyPrefix: 'pygmy:ratelimit:username',
  storeClient: redis,
  inMemoryBlockOnConsumed: pointsChangeUsername,
  points: pointsChangeUsername,
  duration: (60 * 60) * 24 // 24 hours
});

const rateLimiterVerifyResend = new RateLimiterRedis({
  keyPrefix: 'pygmy:ratelimit:verify_resend',
  storeClient: redis,
  inMemoryBlockOnConsumed: pointsVerifyResend,
  points: pointsVerifyResend,
  duration: 60 * 60 // 1 hour
});

// Rate limit middleware
export const ratelimitMiddleware = createMiddleware<{
  Variables: {
    sessionId?: string;
    userId?: string;
  }
}>(async (c, next) => {
  const currentPath = c.req.path;
  const sessionId = c.get('sessionId');

  // As a last resort, if there is no unique identifier present, funnel unidentified traffic into an "unknown" key
  const key = sessionId
    ? `session:${sessionId}`
    : getRequestIP(c)
      ? `ip:${getRequestIP(c)}`
      : 'unknown';

  // Register
  if (currentPath === '/users') 
    return rateLimiterRegister.consume(key, 1)
      .then((res) => {
        setRateLimitHeaders(c, res.msBeforeNext, pointsRegiser, res.remainingPoints);
        return next();
      })
      .catch((res) => {
        if (res instanceof RateLimiterRes) {
          setRateLimitHeaders(c, res.msBeforeNext, pointsRegiser, res.remainingPoints);
          return c.json({ error: Errors.RateLimited }, 429);
        } else {
          console.error(res)
          return c.json({ error: Errors.ServerError }, 500);
        }
      });

  // Resend verification email
  if (currentPath === '/users/verify/resend')
    return rateLimiterVerifyResend.consume(key, 1)
      .then((res) => {
        setRateLimitHeaders(c, res.msBeforeNext, pointsVerifyResend, res.remainingPoints);
        return next();
      })
      .catch((res) => {
        if (res instanceof RateLimiterRes) {
          setRateLimitHeaders(c, res.msBeforeNext, pointsVerifyResend, res.remainingPoints);
          return c.json({ error: Errors.RateLimited }, 429);
        } else {
          console.error(res)
          return c.json({ error: Errors.ServerError }, 500);
        }
      });

  // All other routes
  return rateLimiter.consume(key, 1)
    .then((res) => {
      setRateLimitHeaders(c, res.msBeforeNext, pointsGlobal, res.remainingPoints);
      return next();
    })
    .catch((res) => {
      if (res instanceof RateLimiterRes) {
        setRateLimitHeaders(c, res.msBeforeNext, pointsGlobal, res.remainingPoints);
        return c.json({ error: Errors.RateLimited }, 429);
      } else {
        return c.json({ error: Errors.ServerError }, 500);
      }
    });
});