import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// ─── Mock dependencies ──────────────────────────────────────────────────────

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
};

vi.mock('../../services/logger.js', () => ({
  logger: mockLogger,
  createChildLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

let uuidCounter = 0;
vi.mock('uuid', () => ({
  v4: vi.fn(() => `00000000-0000-4000-a000-00000000${String(++uuidCounter).padStart(4, '0')}`),
}));

// ─── Import after mocks ─────────────────────────────────────────────────────
const { requestLogger } = await import('../../middleware/requestLogger.js');

// ─── Helpers ────────────────────────────────────────────────────────────────

function createApp(handler?: (c: any) => any) {
  const app = new Hono();
  app.use('*', requestLogger as any);
  app.get('/test', (c) => {
    if (handler) return handler(c);
    return c.json({ ok: true });
  });
  app.get('/error', () => {
    throw new Error('boom');
  });
  app.post('/data', (c) => c.json({ ok: true }));
  app.get('/slow', async (c) => {
    await new Promise((r) => setTimeout(r, 50));
    return c.json({ ok: true });
  });
  app.get('/not-found', (c) => c.json({ error: 'not found' }, 404));
  app.get('/server-error', (c) => c.json({ error: 'internal' }, 500));
  return app;
}

// ─── Tests ──────────────────────────────────────────────────────────────────
describe('requestLogger middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uuidCounter = 0;
  });

  it('should generate a UUID v4 request ID when none provided', async () => {
    const app = createApp();
    const res = await app.request('http://localhost/test');

    expect(res.status).toBe(200);
    const requestId = res.headers.get('X-Request-Id');
    expect(requestId).toBeDefined();
    // Should be a valid UUID format
    expect(requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  it('should accept a valid UUID from X-Request-Id header', async () => {
    const app = createApp();
    const validUuid = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
    const res = await app.request('http://localhost/test', {
      headers: { 'X-Request-Id': validUuid },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Request-Id')).toBe(validUuid);
  });

  it('should reject an invalid X-Request-Id and generate a new one', async () => {
    const app = createApp();
    const res = await app.request('http://localhost/test', {
      headers: { 'X-Request-Id': 'not-a-uuid' },
    });

    expect(res.status).toBe(200);
    const requestId = res.headers.get('X-Request-Id');
    expect(requestId).not.toBe('not-a-uuid');
    expect(requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  it('should set X-Request-Id response header', async () => {
    const app = createApp();
    const res = await app.request('http://localhost/test');

    expect(res.headers.get('X-Request-Id')).toBeTruthy();
  });

  it('should log request completion with info for 2xx', async () => {
    const app = createApp();
    await app.request('http://localhost/test');

    expect(mockLogger.info).toHaveBeenCalled();
    const logCall = mockLogger.info.mock.calls[0];
    expect(logCall[0]).toMatchObject({
      method: 'GET',
      path: '/test',
      status: 200,
    });
    expect(logCall[1]).toContain('GET');
    expect(logCall[1]).toContain('/test');
    expect(logCall[1]).toContain('200');
  });

  it('should log correct HTTP method and path', async () => {
    const app = createApp();
    await app.request('http://localhost/data', { method: 'POST' });

    expect(mockLogger.info).toHaveBeenCalled();
    const logCall = mockLogger.info.mock.calls[0];
    expect(logCall[0].method).toBe('POST');
    expect(logCall[0].path).toBe('/data');
  });

  it('should log with warn level for 4xx responses', async () => {
    const app = createApp();
    await app.request('http://localhost/not-found');

    expect(mockLogger.warn).toHaveBeenCalled();
    const logCall = mockLogger.warn.mock.calls[0];
    expect(logCall[0].status).toBe(404);
  });

  it('should log with error level for 5xx responses', async () => {
    const app = createApp();
    await app.request('http://localhost/server-error');

    expect(mockLogger.error).toHaveBeenCalled();
    const logCall = mockLogger.error.mock.calls[0];
    expect(logCall[0].status).toBe(500);
  });

  it('should include duration in log data', async () => {
    const app = createApp();
    await app.request('http://localhost/slow');

    expect(mockLogger.info).toHaveBeenCalled();
    const logCall = mockLogger.info.mock.calls[0];
    expect(logCall[0].duration).toBeGreaterThanOrEqual(0);
    expect(typeof logCall[0].duration).toBe('number');
  });

  it('should include requestId in log data', async () => {
    const app = createApp();
    const res = await app.request('http://localhost/test');

    const requestId = res.headers.get('X-Request-Id');
    const logCall = mockLogger.info.mock.calls[0];
    expect(logCall[0].requestId).toBe(requestId);
  });

  it('should include user-agent and ip in log data', async () => {
    const app = createApp();
    await app.request('http://localhost/test', {
      headers: {
        'User-Agent': 'TestAgent/1.0',
        'X-Forwarded-For': '192.168.1.1, 10.0.0.1',
      },
    });

    const logCall = mockLogger.info.mock.calls[0];
    expect(logCall[0].userAgent).toBe('TestAgent/1.0');
    expect(logCall[0].ip).toBe('192.168.1.1');
  });
});
