import type { Context, Next } from 'hono';
import type { AppVariables, SubscriptionPlan } from '../types/index.js';
import { getRedisClient } from '../services/redis.js';
import { logger } from '../services/logger.js';

// ─── Rate Limit Tiers ────────────────────────────────────────────────────────

interface TierLimits {
  perMinute: number;
  perDay: number;
}

const GENERAL_LIMITS: Record<SubscriptionPlan, TierLimits> = {
  free: { perMinute: 60, perDay: 1000 },
  basic: { perMinute: 120, perDay: 5000 },
  premium: { perMinute: 300, perDay: 20000 },
};

interface EndpointLimits {
  perDay: Record<SubscriptionPlan, number>;
}

const ENDPOINT_LIMITS: Record<string, EndpointLimits> = {
  '/api/ai': {
    perDay: { free: 5, basic: 20, premium: 100 },
  },
  '/api/avatar': {
    perDay: { free: 0, basic: 5, premium: 20 },
  },
};

// ─── In-Memory Fallback ──────────────────────────────────────────────────────

const inMemoryMap = new Map<string, { count: number; resetAt: number }>();

function inMemoryIncrement(key: string, windowMs: number, limit: number): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const entry = inMemoryMap.get(key);

  if (!entry || now > entry.resetAt) {
    const resetAt = now + windowMs;
    inMemoryMap.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: limit - 1, resetAt };
  }

  entry.count++;
  const remaining = Math.max(0, limit - entry.count);
  return { allowed: entry.count <= limit, remaining, resetAt: entry.resetAt };
}

// Periodic cleanup of expired in-memory entries
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of inMemoryMap) {
    if (now > entry.resetAt) inMemoryMap.delete(key);
  }
}, 60_000);

// ─── Redis Sliding Window ────────────────────────────────────────────────────

async function redisIncrement(
  key: string,
  windowMs: number,
  limit: number
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const redis = getRedisClient();
  if (!redis) {
    return inMemoryIncrement(key, windowMs, limit);
  }

  try {
    const now = Date.now();
    const windowStart = now - windowMs;
    const member = `${now}:${Math.random().toString(36).slice(2, 8)}`;

    const pipeline = redis.pipeline();
    // Remove entries outside the window
    pipeline.zremrangebyscore(key, 0, windowStart);
    // Add current request
    pipeline.zadd(key, now, member);
    // Count entries in window
    pipeline.zcard(key);
    // Set TTL
    pipeline.pexpire(key, windowMs);

    const results = await pipeline.exec();
    if (!results) {
      return inMemoryIncrement(key, windowMs, limit);
    }

    const count = (results[2]?.[1] as number) ?? 0;
    const remaining = Math.max(0, limit - count);
    const resetAt = now + windowMs;

    return { allowed: count <= limit, remaining, resetAt };
  } catch (err) {
    logger.warn({ err, key }, 'Redis rate limit failed, falling back to in-memory');
    return inMemoryIncrement(key, windowMs, limit);
  }
}

// ─── Helper: Resolve Subscription Plan ───────────────────────────────────────

function resolveSubscriptionPlan(c: Context<{ Variables: AppVariables }>): SubscriptionPlan {
  // If set by auth middleware or upstream, use that; otherwise default to free
  const plan = c.get('subscriptionPlan' as never) as SubscriptionPlan | undefined;
  return plan || 'free';
}

// ─── Middleware: General Rate Limiter ─────────────────────────────────────────

/**
 * Global rate limiter middleware.
 * Applies per-minute and per-day limits based on subscription tier.
 * Uses Redis sliding window with in-memory fallback.
 */
export async function rateLimiter(
  c: Context<{ Variables: AppVariables }>,
  next: Next
): Promise<Response | void> {
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const userId = c.get('userId') as string | undefined;
  const identifier = userId || ip;
  const plan = resolveSubscriptionPlan(c);
  const limits = GENERAL_LIMITS[plan];

  // Check per-minute limit
  const minuteKey = `rl:min:${identifier}`;
  const minuteResult = await redisIncrement(minuteKey, 60_000, limits.perMinute);

  if (!minuteResult.allowed) {
    const retryAfter = Math.ceil((minuteResult.resetAt - Date.now()) / 1000);
    c.header('X-RateLimit-Limit', String(limits.perMinute));
    c.header('X-RateLimit-Remaining', '0');
    c.header('X-RateLimit-Reset', String(Math.ceil(minuteResult.resetAt / 1000)));
    c.header('Retry-After', String(retryAfter));
    return c.json(
      { success: false, error: 'Too many requests. Please try again later.' },
      429
    );
  }

  // Check per-day limit
  const dayKey = `rl:day:${identifier}`;
  const dayResult = await redisIncrement(dayKey, 86_400_000, limits.perDay);

  if (!dayResult.allowed) {
    const retryAfter = Math.ceil((dayResult.resetAt - Date.now()) / 1000);
    c.header('X-RateLimit-Limit', String(limits.perDay));
    c.header('X-RateLimit-Remaining', '0');
    c.header('X-RateLimit-Reset', String(Math.ceil(dayResult.resetAt / 1000)));
    c.header('Retry-After', String(retryAfter));
    return c.json(
      { success: false, error: 'Daily request limit exceeded. Please try again tomorrow.' },
      429
    );
  }

  // Set rate limit headers for successful requests
  c.header('X-RateLimit-Limit', String(limits.perMinute));
  c.header('X-RateLimit-Remaining', String(minuteResult.remaining));
  c.header('X-RateLimit-Reset', String(Math.ceil(minuteResult.resetAt / 1000)));

  await next();
}

// ─── Middleware: Endpoint-Specific Rate Limiter ──────────────────────────────

/**
 * Creates a rate limiter for specific expensive endpoints (AI chat, avatar generation).
 * Must be applied AFTER auth middleware so userId is available.
 */
export function endpointRateLimiter(endpointPrefix: string) {
  return async (c: Context<{ Variables: AppVariables }>, next: Next): Promise<Response | void> => {
    const limits = ENDPOINT_LIMITS[endpointPrefix];
    if (!limits) {
      await next();
      return;
    }

    const userId = c.get('userId') as string | undefined;
    if (!userId) {
      // Unauthenticated requests are handled by general limiter
      await next();
      return;
    }

    const plan = resolveSubscriptionPlan(c);
    const dailyLimit = limits.perDay[plan];

    // Plan does not allow this endpoint at all
    if (dailyLimit === 0) {
      return c.json(
        {
          success: false,
          error: 'This feature requires a Basic or Premium subscription.',
        },
        403
      );
    }

    const key = `rl:endpoint:${endpointPrefix}:${userId}`;
    const result = await redisIncrement(key, 86_400_000, dailyLimit);

    if (!result.allowed) {
      const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000);
      c.header('X-RateLimit-Limit', String(dailyLimit));
      c.header('X-RateLimit-Remaining', '0');
      c.header('X-RateLimit-Reset', String(Math.ceil(result.resetAt / 1000)));
      c.header('Retry-After', String(retryAfter));
      return c.json(
        {
          success: false,
          error: `Daily limit for this feature reached (${dailyLimit}/day on ${plan} plan). Upgrade for higher limits.`,
        },
        429
      );
    }

    c.header('X-RateLimit-Limit', String(dailyLimit));
    c.header('X-RateLimit-Remaining', String(result.remaining));
    c.header('X-RateLimit-Reset', String(Math.ceil(result.resetAt / 1000)));

    await next();
  };
}
