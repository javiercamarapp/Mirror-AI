import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';

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

// ─── Import after mocks ────────────────────────────────────────────────────
const { globalErrorHandler, notFoundHandler } = await import('../../middleware/errorHandler.js');

function createApp() {
  const app = new Hono();

  // Simulate requestId being set by upstream middleware
  app.use('*', async (c, next) => {
    c.set('requestId' as never, 'test-request-id-123' as never);
    await next();
  });

  // Route that throws a generic Error
  app.get('/error', () => {
    throw new Error('Something broke');
  });

  // Route that throws an error with a status property
  app.get('/not-authorized', () => {
    const err = new Error('Not authorized') as Error & { status: number };
    err.status = 401;
    throw err;
  });

  // Route that throws a 400 error
  app.get('/bad-request', () => {
    const err = new Error('Invalid input data') as Error & { status: number };
    err.status = 400;
    throw err;
  });

  // Route that throws a 422 error
  app.get('/validation-error', () => {
    const err = new Error('Validation failed: name is required') as Error & { status: number };
    err.status = 422;
    throw err;
  });

  app.onError(globalErrorHandler);
  app.notFound(notFoundHandler);

  return app;
}

// ─── Tests ──────────────────────────────────────────────────────────────────
describe('globalErrorHandler', () => {
  let app: ReturnType<typeof createApp>;
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('should return 500 with error details in non-production', async () => {
    process.env.NODE_ENV = 'test';

    const res = await app.request('http://localhost/error');
    expect(res.status).toBe(500);

    const json = await res.json() as any;
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('INTERNAL_SERVER_ERROR');
    expect(json.error.message).toBe('Something broke');
    expect(json.error.requestId).toBe('test-request-id-123');
  });

  it('should hide error message in production for 500 errors', async () => {
    process.env.NODE_ENV = 'production';

    const res = await app.request('http://localhost/error');
    expect(res.status).toBe(500);

    const json = await res.json() as any;
    expect(json.success).toBe(false);
    expect(json.error.message).toBe('Internal server error');
    // Original message should NOT be leaked
    expect(json.error.message).not.toContain('Something broke');
  });

  it('should show error message in production for 4xx errors', async () => {
    process.env.NODE_ENV = 'production';

    const res = await app.request('http://localhost/bad-request');
    expect(res.status).toBe(400);

    const json = await res.json() as any;
    expect(json.error.message).toBe('Invalid input data');
    expect(json.error.code).toBe('BAD_REQUEST');
  });

  it('should use the error status property when available', async () => {
    const res = await app.request('http://localhost/not-authorized');
    expect(res.status).toBe(401);

    const json = await res.json() as any;
    expect(json.error.code).toBe('UNAUTHORIZED');
  });

  it('should format validation errors correctly', async () => {
    const res = await app.request('http://localhost/validation-error');
    expect(res.status).toBe(422);

    const json = await res.json() as any;
    expect(json.error.code).toBe('UNPROCESSABLE_ENTITY');
    expect(json.error.message).toContain('Validation failed');
  });

  it('should log the full error details', async () => {
    await app.request('http://localhost/error');

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'test-request-id-123',
        method: 'GET',
        path: '/error',
        status: 500,
      }),
      expect.stringContaining('Something broke')
    );
  });

  it('should include requestId in the response body', async () => {
    const res = await app.request('http://localhost/error');
    const json = await res.json() as any;
    expect(json.error.requestId).toBe('test-request-id-123');
  });
});

describe('notFoundHandler', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  it('should return 404 for unknown routes', async () => {
    const res = await app.request('http://localhost/unknown/path');
    expect(res.status).toBe(404);

    const json = await res.json() as any;
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('NOT_FOUND');
  });

  it('should include the route method and path in the error message', async () => {
    const res = await app.request('http://localhost/api/nonexistent');
    expect(res.status).toBe(404);

    const json = await res.json() as any;
    expect(json.error.message).toContain('GET');
    expect(json.error.message).toContain('/api/nonexistent');
  });

  it('should include requestId in 404 responses', async () => {
    const res = await app.request('http://localhost/missing');
    const json = await res.json() as any;
    expect(json.error.requestId).toBe('test-request-id-123');
  });

  it('should handle POST requests to unknown routes', async () => {
    const res = await app.request('http://localhost/api/unknown', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: 'test' }),
    });

    expect(res.status).toBe(404);
    const json = await res.json() as any;
    expect(json.error.message).toContain('POST');
    expect(json.error.message).toContain('/api/unknown');
  });

  it('should return consistent error shape', async () => {
    const res = await app.request('http://localhost/nope');
    const json = await res.json() as any;

    // Verify the shape matches ErrorResponse interface
    expect(json).toHaveProperty('success', false);
    expect(json).toHaveProperty('error.code');
    expect(json).toHaveProperty('error.message');
    expect(json).toHaveProperty('error.requestId');
  });
});
