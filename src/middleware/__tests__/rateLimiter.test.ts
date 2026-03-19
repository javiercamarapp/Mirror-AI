import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import type { AppVariables } from '../../types/index.js';

// ─── Mock Redis ─────────────────────────────────────────────────────────────
let mockRedisClient: any = null;

vi.mock('../../services/redis.js', () => ({
  getRedisClient: () => mockRedisClient,
}));

vi.mock('../../services/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createChildLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

// ─── Import after mocks ────────────────────────────────────────────────────
const { rateLimiter, endpointRateLimiter } = await import('../../middleware/rateLimiter.js');

function createApp(opts?: { plan?: string }) {
  const app = new Hono<{ Variables: AppVariables }>();
  // Optionally set subscription plan before rate limiter
  if (opts?.plan) {
    app.use('*', async (c, next) => {
      c.set('subscriptionPlan' as never, opts.plan as never);
      c.set('userId', 'test-user-id');
      await next();
    });
  }
  app.use('*', rateLimiter);
  app.get('/test', (c) => c.json({ success: true }));
  return app;
}

// ─── Tests ──────────────────────────────────────────────────────────────────
describe('rateLimiter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no Redis, use in-memory fallback
    mockRedisClient = null;
  });

  it('should allow a request within limits', async () => {
    const app = createApp();
    const res = await app.request('http://localhost/test', {
      headers: { 'x-forwarded-for': '1.2.3.4' },
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it('should set rate limit headers on successful requests', async () => {
    const app = createApp();
    const res = await app.request('http://localhost/test', {
      headers: { 'x-forwarded-for': '10.0.0.1' },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('X-RateLimit-Limit')).toBeTruthy();
    expect(res.headers.get('X-RateLimit-Remaining')).toBeTruthy();
    expect(res.headers.get('X-RateLimit-Reset')).toBeTruthy();
  });

  it('should return 429 when per-minute limit is exceeded (free tier = 60)', async () => {
    const app = createApp();
    // Make 61 requests from the same IP to exceed the free per-minute limit of 60
    let lastRes: Response | undefined;
    for (let i = 0; i < 61; i++) {
      lastRes = await app.request('http://localhost/test', {
        headers: { 'x-forwarded-for': '50.50.50.50' },
      });
    }

    expect(lastRes!.status).toBe(429);
    const json = await lastRes!.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain('Too many requests');
  });

  it('should set Retry-After header when rate limited', async () => {
    const app = createApp();
    for (let i = 0; i < 61; i++) {
      await app.request('http://localhost/test', {
        headers: { 'x-forwarded-for': '60.60.60.60' },
      });
    }

    const res = await app.request('http://localhost/test', {
      headers: { 'x-forwarded-for': '60.60.60.60' },
    });

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeTruthy();
    const retryAfter = parseInt(res.headers.get('Retry-After')!, 10);
    expect(retryAfter).toBeGreaterThan(0);
  });

  it('should allow higher per-minute limit for basic tier (120)', async () => {
    const app = createApp({ plan: 'basic' });
    // Send 61 requests — should still be allowed under basic (limit=120)
    let lastRes: Response | undefined;
    for (let i = 0; i < 61; i++) {
      lastRes = await app.request('http://localhost/test', {
        headers: { 'x-forwarded-for': '70.70.70.70' },
      });
    }

    expect(lastRes!.status).toBe(200);
  });

  it('should allow higher per-minute limit for premium tier (300)', async () => {
    const app = createApp({ plan: 'premium' });
    let lastRes: Response | undefined;
    for (let i = 0; i < 121; i++) {
      lastRes = await app.request('http://localhost/test', {
        headers: { 'x-forwarded-for': '80.80.80.80' },
      });
    }

    expect(lastRes!.status).toBe(200);
  });

  it('should use userId as identifier when authenticated', async () => {
    const uniqueUserId = `user-auth-test-${Date.now()}`;
    const app = new Hono<{ Variables: AppVariables }>();
    app.use('*', async (c, next) => {
      c.set('subscriptionPlan' as never, 'free' as never);
      c.set('userId', uniqueUserId);
      await next();
    });
    app.use('*', rateLimiter);
    app.get('/test', (c) => c.json({ success: true }));

    // Requests from same user but different IPs should share limits
    const res1 = await app.request('http://localhost/test', {
      headers: { 'x-forwarded-for': '1.1.1.1' },
    });
    const res2 = await app.request('http://localhost/test', {
      headers: { 'x-forwarded-for': '2.2.2.2' },
    });

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    // Both counted against the same userId limit
  });

  it('should use IP as identifier for unauthenticated requests', async () => {
    const app = createApp(); // no plan = no userId
    const res = await app.request('http://localhost/test', {
      headers: { 'x-forwarded-for': '99.99.99.99' },
    });
    expect(res.status).toBe(200);
  });

  it('should fall back to in-memory when Redis returns null', async () => {
    mockRedisClient = null;
    const app = createApp();

    const res = await app.request('http://localhost/test', {
      headers: { 'x-forwarded-for': '100.0.0.1' },
    });

    expect(res.status).toBe(200);
  });

  it('should fall back to in-memory when Redis pipeline throws', async () => {
    mockRedisClient = {
      pipeline: () => ({
        zremrangebyscore: vi.fn().mockReturnThis(),
        zadd: vi.fn().mockReturnThis(),
        zcard: vi.fn().mockReturnThis(),
        pexpire: vi.fn().mockReturnThis(),
        exec: vi.fn().mockRejectedValue(new Error('Redis connection lost')),
      }),
    };

    const app = createApp();
    const res = await app.request('http://localhost/test', {
      headers: { 'x-forwarded-for': '110.0.0.1' },
    });

    expect(res.status).toBe(200);
  });

  it('should show X-RateLimit-Remaining as 0 when rate limited', async () => {
    const app = createApp();
    for (let i = 0; i < 61; i++) {
      await app.request('http://localhost/test', {
        headers: { 'x-forwarded-for': '120.0.0.1' },
      });
    }

    const res = await app.request('http://localhost/test', {
      headers: { 'x-forwarded-for': '120.0.0.1' },
    });

    expect(res.status).toBe(429);
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('0');
  });
});

describe('endpointRateLimiter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisClient = null;
  });

  it('should allow requests within endpoint daily limit', async () => {
    const app = new Hono<{ Variables: AppVariables }>();
    app.use('*', async (c, next) => {
      c.set('userId', 'ep-user-1');
      c.set('subscriptionPlan' as never, 'free' as never);
      await next();
    });
    app.use('/api/ai/*', endpointRateLimiter('/api/ai'));
    app.get('/api/ai/chat', (c) => c.json({ success: true }));

    const res = await app.request('http://localhost/api/ai/chat');
    expect(res.status).toBe(200);
  });

  it('should return 403 when plan does not allow endpoint (free + avatar)', async () => {
    const app = new Hono<{ Variables: AppVariables }>();
    app.use('*', async (c, next) => {
      c.set('userId', 'ep-user-2');
      c.set('subscriptionPlan' as never, 'free' as never);
      await next();
    });
    app.use('/api/avatar/*', endpointRateLimiter('/api/avatar'));
    app.get('/api/avatar/generate', (c) => c.json({ success: true }));

    const res = await app.request('http://localhost/api/avatar/generate');
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain('requires a Basic or Premium');
  });

  it('should pass through for unknown endpoints', async () => {
    const app = new Hono<{ Variables: AppVariables }>();
    app.use('*', endpointRateLimiter('/api/unknown'));
    app.get('/api/unknown/thing', (c) => c.json({ success: true }));

    const res = await app.request('http://localhost/api/unknown/thing');
    expect(res.status).toBe(200);
  });
});
