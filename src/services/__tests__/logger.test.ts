import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock pino ──────────────────────────────────────────────────────────────

const mockChildLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(),
};

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  level: 'info',
  child: vi.fn(() => mockChildLogger),
  isLevelEnabled: vi.fn((level: string) => true),
  bindings: vi.fn(() => ({ service: 'mirror-ai-api' })),
};

const mockPino = vi.fn(() => mockLogger);
(mockPino as any).stdSerializers = {
  err: vi.fn((err: Error) => ({ message: err.message, type: err.constructor.name, stack: err.stack })),
  req: vi.fn((req: any) => ({ method: req?.method, url: req?.url })),
  res: vi.fn((res: any) => ({ statusCode: res?.statusCode })),
};

vi.mock('pino', () => ({
  default: mockPino,
}));

// ─── Tests ───────────────────────────────────────────────────────────────────
describe('Logger Service', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    // Re-apply mock after resetModules
    vi.mock('pino', () => ({
      default: mockPino,
    }));
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should create a logger with correct base config', async () => {
    process.env.NODE_ENV = 'test';
    const { logger } = await import('../logger.js');

    expect(logger).toBeDefined();
    expect(mockPino).toHaveBeenCalledWith(
      expect.objectContaining({
        base: { service: 'mirror-ai-api' },
      })
    );
  });

  it('should create a child logger with additional bindings', async () => {
    process.env.NODE_ENV = 'test';
    const { createChildLogger } = await import('../logger.js');

    const child = createChildLogger({ requestId: 'req-123', userId: 'user-1' });
    expect(mockLogger.child).toHaveBeenCalledWith({ requestId: 'req-123', userId: 'user-1' });
    expect(child).toBeDefined();
  });

  it('should expose info log level function', async () => {
    process.env.NODE_ENV = 'test';
    const { logger } = await import('../logger.js');

    expect(typeof logger.info).toBe('function');
    logger.info('test message');
    expect(mockLogger.info).toHaveBeenCalledWith('test message');
  });

  it('should expose warn log level function', async () => {
    process.env.NODE_ENV = 'test';
    const { logger } = await import('../logger.js');

    expect(typeof logger.warn).toBe('function');
    logger.warn({ code: 'DEPRECATED' }, 'deprecated feature used');
    expect(mockLogger.warn).toHaveBeenCalledWith({ code: 'DEPRECATED' }, 'deprecated feature used');
  });

  it('should expose error log level function', async () => {
    process.env.NODE_ENV = 'test';
    const { logger } = await import('../logger.js');

    const err = new Error('something broke');
    logger.error({ err }, 'operation failed');
    expect(mockLogger.error).toHaveBeenCalledWith({ err }, 'operation failed');
  });

  it('should configure standard err, req, res serializers', async () => {
    process.env.NODE_ENV = 'test';
    await import('../logger.js');

    const pinoCallArgs = mockPino.mock.calls[0][0];
    expect(pinoCallArgs.serializers).toBeDefined();
    expect(pinoCallArgs.serializers.err).toBe(mockPino.stdSerializers.err);
    expect(pinoCallArgs.serializers.req).toBe(mockPino.stdSerializers.req);
    expect(pinoCallArgs.serializers.res).toBe(mockPino.stdSerializers.res);
  });

  it('should use pino-pretty transport in development', async () => {
    process.env.NODE_ENV = 'development';
    await import('../logger.js');

    const pinoCallArgs = mockPino.mock.calls[0][0];
    expect(pinoCallArgs.transport).toEqual({
      target: 'pino-pretty',
      options: { colorize: true },
    });
  });

  it('should not use pino-pretty transport in production', async () => {
    process.env.NODE_ENV = 'production';
    await import('../logger.js');

    const pinoCallArgs = mockPino.mock.calls[0][0];
    expect(pinoCallArgs.transport).toBeUndefined();
  });

  it('should default to info log level when LOG_LEVEL is not set', async () => {
    delete process.env.LOG_LEVEL;
    process.env.NODE_ENV = 'test';
    await import('../logger.js');

    const pinoCallArgs = mockPino.mock.calls[0][0];
    expect(pinoCallArgs.level).toBe('info');
  });

  it('should use LOG_LEVEL env var when set', async () => {
    process.env.LOG_LEVEL = 'debug';
    process.env.NODE_ENV = 'test';
    await import('../logger.js');

    const pinoCallArgs = mockPino.mock.calls[0][0];
    expect(pinoCallArgs.level).toBe('debug');
  });
});
