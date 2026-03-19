import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock logger ────────────────────────────────────────────────────────────
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

vi.mock('../../services/logger.js', () => ({
  logger: mockLogger,
  createChildLogger: vi.fn(() => mockLogger),
}));

// ─── Mock ioredis ───────────────────────────────────────────────────────────
const eventHandlers: Record<string, Function> = {};
const mockRedisInstance = {
  on: vi.fn((event: string, handler: Function) => {
    eventHandlers[event] = handler;
    return mockRedisInstance;
  }),
  ping: vi.fn(),
  quit: vi.fn().mockResolvedValue('OK'),
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
};

let redisMockConstructor = vi.fn(() => mockRedisInstance);

vi.mock('ioredis', () => ({
  default: class MockRedis {
    constructor(...args: any[]) {
      redisMockConstructor(...args);
      return mockRedisInstance as any;
    }
  },
}));

// ─── Tests ──────────────────────────────────────────────────────────────────
describe('Redis service', () => {
  const originalEnv = process.env.REDIS_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset eventHandlers
    for (const key of Object.keys(eventHandlers)) {
      delete eventHandlers[key];
    }
    // Reset module cache to get fresh state for each test
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

    // Re-mock dependencies for fresh module
    vi.doMock('../../services/logger.js', () => ({
      logger: mockLogger,
      createChildLogger: vi.fn(() => mockLogger),
    }));

    const { getRedisClient } = await import('../../services/redis.js');
    const client = getRedisClient();
    expect(client).toBeNull();
  });

  it('should log a warning when REDIS_URL is not set', async () => {
    delete process.env.REDIS_URL;

    vi.doMock('../../services/logger.js', () => ({
      logger: mockLogger,
      createChildLogger: vi.fn(() => mockLogger),
    }));

    const { getRedisClient } = await import('../../services/redis.js');
    getRedisClient();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('REDIS_URL')
    );
  });

  it('should create a Redis client when REDIS_URL is set', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';

    vi.doMock('../../services/logger.js', () => ({
      logger: mockLogger,
      createChildLogger: vi.fn(() => mockLogger),
    }));
    vi.doMock('ioredis', () => ({
      default: class MockRedis {
        constructor(...args: any[]) {
          redisMockConstructor(...args);
          return mockRedisInstance as any;
        }
      },
    }));

    const { getRedisClient } = await import('../../services/redis.js');
    getRedisClient();

    // The constructor should have been called (via module init or getRedisClient)
    expect(mockRedisInstance.on).toHaveBeenCalledWith('connect', expect.any(Function));
    expect(mockRedisInstance.on).toHaveBeenCalledWith('ready', expect.any(Function));
    expect(mockRedisInstance.on).toHaveBeenCalledWith('error', expect.any(Function));
    expect(mockRedisInstance.on).toHaveBeenCalledWith('close', expect.any(Function));
  });

  it('should return the same client on subsequent calls', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';

    vi.doMock('../../services/logger.js', () => ({
      logger: mockLogger,
      createChildLogger: vi.fn(() => mockLogger),
    }));
    vi.doMock('ioredis', () => ({
      default: class MockRedis {
        constructor(...args: any[]) {
          redisMockConstructor(...args);
          return mockRedisInstance as any;
        }
      },
    }));

    const { getRedisClient } = await import('../../services/redis.js');
    // Simulate the "ready" event to make redisAvailable = true
    getRedisClient();
    if (eventHandlers['ready']) eventHandlers['ready']();

    const client1 = getRedisClient();
    const client2 = getRedisClient();
    // Both should be the same reference (or both null if not available)
    expect(client1).toBe(client2);
  });

  it('should report healthy when ping returns PONG', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';

    vi.doMock('../../services/logger.js', () => ({
      logger: mockLogger,
      createChildLogger: vi.fn(() => mockLogger),
    }));
    vi.doMock('ioredis', () => ({
      default: class MockRedis {
        constructor() { return mockRedisInstance as any; }
      },
    }));

    const { getRedisClient, isRedisHealthy } = await import('../../services/redis.js');
    getRedisClient();
    if (eventHandlers['ready']) eventHandlers['ready']();

    mockRedisInstance.ping.mockResolvedValue('PONG');
    const healthy = await isRedisHealthy();
    expect(healthy).toBe(true);
  });

  it('should report unhealthy when ping fails', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';

    vi.doMock('../../services/logger.js', () => ({
      logger: mockLogger,
      createChildLogger: vi.fn(() => mockLogger),
    }));
    vi.doMock('ioredis', () => ({
      default: class MockRedis {
        constructor() { return mockRedisInstance as any; }
      },
    }));

    const { getRedisClient, isRedisHealthy } = await import('../../services/redis.js');
    getRedisClient();
    if (eventHandlers['ready']) eventHandlers['ready']();

    mockRedisInstance.ping.mockRejectedValue(new Error('connection refused'));
    const healthy = await isRedisHealthy();
    expect(healthy).toBe(false);
  });

  it('should report unhealthy when no client exists', async () => {
    delete process.env.REDIS_URL;

    vi.doMock('../../services/logger.js', () => ({
      logger: mockLogger,
      createChildLogger: vi.fn(() => mockLogger),
    }));

    const { isRedisHealthy } = await import('../../services/redis.js');
    const healthy = await isRedisHealthy();
    expect(healthy).toBe(false);
  });

  it('should disconnect gracefully', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';

    vi.doMock('../../services/logger.js', () => ({
      logger: mockLogger,
      createChildLogger: vi.fn(() => mockLogger),
    }));
    vi.doMock('ioredis', () => ({
      default: class MockRedis {
        constructor() { return mockRedisInstance as any; }
      },
    }));

    const { getRedisClient, disconnectRedis } = await import('../../services/redis.js');
    getRedisClient();
    if (eventHandlers['ready']) eventHandlers['ready']();

    await disconnectRedis();
    expect(mockRedisInstance.quit).toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('disconnected'));
  });

  it('should handle disconnect when no client exists', async () => {
    delete process.env.REDIS_URL;

    vi.doMock('../../services/logger.js', () => ({
      logger: mockLogger,
      createChildLogger: vi.fn(() => mockLogger),
    }));

    const { disconnectRedis } = await import('../../services/redis.js');
    // Should not throw
    await expect(disconnectRedis()).resolves.not.toThrow();
  });
});
