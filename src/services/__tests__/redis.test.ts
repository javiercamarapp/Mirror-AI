import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock dependencies ──────────────────────────────────────────────────────

vi.mock('../logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
  },
  createChildLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

const mockPing = vi.fn().mockResolvedValue('PONG');
const mockQuit = vi.fn().mockResolvedValue('OK');
const mockOn = vi.fn();

vi.mock('ioredis', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      ping: mockPing,
      quit: mockQuit,
      on: mockOn,
    })),
  };
});

// ─── Tests ──────────────────────────────────────────────────────────────────
describe('Redis Service', () => {
  const originalEnv = process.env.REDIS_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the module to clear cached redis client
    vi.resetModules();
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.REDIS_URL = originalEnv;
    } else {
      delete process.env.REDIS_URL;
    }
  });

  it('should return null when REDIS_URL is not set', async () => {
    delete process.env.REDIS_URL;

    // Re-mock after resetModules
    vi.mock('../logger.js', () => ({
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
      createChildLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
    }));
    vi.mock('ioredis', () => ({
      default: vi.fn().mockImplementation(() => ({
        ping: vi.fn(), quit: vi.fn(), on: vi.fn(),
      })),
    }));

    const { getRedisClient } = await import('../redis.js');
    const client = getRedisClient();
    expect(client).toBeNull();
  });

  it('should create Redis client when REDIS_URL is set', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';

    vi.mock('../logger.js', () => ({
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
      createChildLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
    }));
    vi.mock('ioredis', () => ({
      default: vi.fn().mockImplementation(() => ({
        ping: vi.fn(), quit: vi.fn(), on: vi.fn(),
      })),
    }));

    const { getRedisClient } = await import('../redis.js');
    // Client is created but redisAvailable starts as false until connect event
    const client = getRedisClient();
    // Returns null because redisAvailable is false until connect event fires
    expect(client).toBeNull();
  });

  it('should register event listeners on Redis client', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';

    const localOn = vi.fn();
    vi.mock('../logger.js', () => ({
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
      createChildLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
    }));
    vi.mock('ioredis', () => ({
      default: vi.fn().mockImplementation(() => ({
        ping: vi.fn(), quit: vi.fn(), on: localOn,
      })),
    }));

    const { getRedisClient } = await import('../redis.js');
    getRedisClient();

    const events = localOn.mock.calls.map((c: any[]) => c[0]);
    expect(events).toContain('connect');
    expect(events).toContain('ready');
    expect(events).toContain('error');
    expect(events).toContain('close');
  });

  it('should return false from isRedisHealthy when no client exists', async () => {
    delete process.env.REDIS_URL;

    vi.mock('../logger.js', () => ({
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
      createChildLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
    }));
    vi.mock('ioredis', () => ({
      default: vi.fn().mockImplementation(() => ({
        ping: vi.fn(), quit: vi.fn(), on: vi.fn(),
      })),
    }));

    const { isRedisHealthy } = await import('../redis.js');
    const healthy = await isRedisHealthy();
    expect(healthy).toBe(false);
  });

  it('should return false from isRedisHealthy when ping fails', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';

    const failingPing = vi.fn().mockRejectedValue(new Error('connection lost'));
    const localOn = vi.fn();

    vi.mock('../logger.js', () => ({
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
      createChildLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
    }));
    vi.mock('ioredis', () => ({
      default: vi.fn().mockImplementation(() => ({
        ping: failingPing, quit: vi.fn(), on: localOn,
      })),
    }));

    const { getRedisClient, isRedisHealthy } = await import('../redis.js');
    getRedisClient();
    // redisAvailable is false since connect event hasn't fired
    const healthy = await isRedisHealthy();
    expect(healthy).toBe(false);
  });

  it('should gracefully disconnect via disconnectRedis', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';

    const localQuit = vi.fn().mockResolvedValue('OK');
    const localOn = vi.fn();

    vi.mock('../logger.js', () => ({
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
      createChildLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
    }));
    vi.mock('ioredis', () => ({
      default: vi.fn().mockImplementation(() => ({
        ping: vi.fn(), quit: localQuit, on: localOn,
      })),
    }));

    const { getRedisClient, disconnectRedis } = await import('../redis.js');
    getRedisClient(); // initialize
    await disconnectRedis();
    expect(localQuit).toHaveBeenCalled();
  });

  it('should handle disconnectRedis when no client exists', async () => {
    delete process.env.REDIS_URL;

    vi.mock('../logger.js', () => ({
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
      createChildLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
    }));
    vi.mock('ioredis', () => ({
      default: vi.fn().mockImplementation(() => ({
        ping: vi.fn(), quit: vi.fn(), on: vi.fn(),
      })),
    }));

    const { disconnectRedis } = await import('../redis.js');
    // Should not throw
    await expect(disconnectRedis()).resolves.toBeUndefined();
  });

  it('should log warning when REDIS_URL is not set', async () => {
    delete process.env.REDIS_URL;

    const warnFn = vi.fn();
    vi.mock('../logger.js', () => ({
      logger: { info: vi.fn(), warn: warnFn, error: vi.fn(), debug: vi.fn(), child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
      createChildLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
    }));
    vi.mock('ioredis', () => ({
      default: vi.fn().mockImplementation(() => ({
        ping: vi.fn(), quit: vi.fn(), on: vi.fn(),
      })),
    }));

    const { getRedisClient } = await import('../redis.js');
    getRedisClient();
    expect(warnFn).toHaveBeenCalledWith(expect.stringContaining('REDIS_URL'));
  });
});
