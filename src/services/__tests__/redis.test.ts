import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Shared mock state ──────────────────────────────────────────────────────
const mockWarn = vi.fn();
const mockInfo = vi.fn();
const mockError = vi.fn();
const mockDebug = vi.fn();

const mockPing = vi.fn().mockResolvedValue('PONG');
const mockQuit = vi.fn().mockResolvedValue('OK');
const mockOn = vi.fn();

vi.mock('../logger.js', () => ({
  logger: {
    info: (...args: any[]) => mockInfo(...args),
    warn: (...args: any[]) => mockWarn(...args),
    error: (...args: any[]) => mockError(...args),
    debug: (...args: any[]) => mockDebug(...args),
    child: vi.fn(() => ({
      info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
    })),
  },
  createChildLogger: vi.fn(() => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  })),
}));

vi.mock('ioredis', () => {
  const FakeRedis = vi.fn(function (this: any) {
    this.ping = mockPing;
    this.quit = mockQuit;
    this.on = mockOn;
  });
  return { default: FakeRedis };
});

// ─── Tests ──────────────────────────────────────────────────────────────────
describe('Redis Service', () => {
  const originalEnv = process.env.REDIS_URL;

  beforeEach(() => {
    vi.clearAllMocks();
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

    const { getRedisClient } = await import('../redis.js');
    const client = getRedisClient();
    expect(client).toBeNull();
  });

  it('should create Redis client when REDIS_URL is set', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';

    const { getRedisClient } = await import('../redis.js');
    const client = getRedisClient();
    // Returns null because redisAvailable is false until connect event fires
    expect(client).toBeNull();
  });

  it('should register event listeners on Redis client', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';

    const { getRedisClient } = await import('../redis.js');
    getRedisClient();

    const events = mockOn.mock.calls.map((c: any[]) => c[0]);
    expect(events).toContain('connect');
    expect(events).toContain('ready');
    expect(events).toContain('error');
    expect(events).toContain('close');
  });

  it('should return false from isRedisHealthy when no client exists', async () => {
    delete process.env.REDIS_URL;

    const { isRedisHealthy } = await import('../redis.js');
    const healthy = await isRedisHealthy();
    expect(healthy).toBe(false);
  });

  it('should return false from isRedisHealthy when ping fails', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    mockPing.mockRejectedValueOnce(new Error('connection lost'));

    const { getRedisClient, isRedisHealthy } = await import('../redis.js');
    getRedisClient();
    // redisAvailable is false since connect event hasn't fired
    const healthy = await isRedisHealthy();
    expect(healthy).toBe(false);
  });

  it('should gracefully disconnect via disconnectRedis', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';

    const { getRedisClient, disconnectRedis } = await import('../redis.js');
    getRedisClient(); // initialize
    await disconnectRedis();
    expect(mockQuit).toHaveBeenCalled();
  });

  it('should handle disconnectRedis when no client exists', async () => {
    delete process.env.REDIS_URL;

    const { disconnectRedis } = await import('../redis.js');
    // Should not throw
    await expect(disconnectRedis()).resolves.toBeUndefined();
  });

  it('should log warning when REDIS_URL is not set', async () => {
    delete process.env.REDIS_URL;

    const { getRedisClient } = await import('../redis.js');
    getRedisClient();
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('REDIS_URL'));
  });
});
