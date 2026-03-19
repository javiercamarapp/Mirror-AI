import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppVariables } from '../../types/index.js';

// ─── Mock Supabase ─────────────────────────────────────────────────────────
const mockGetUser = vi.fn();

vi.mock('../../services/supabase.js', () => ({
  supabaseAdmin: {
    auth: {
      getUser: mockGetUser,
    },
  },
}));

vi.mock('../../services/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createChildLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

// ─── Import after mocks ────────────────────────────────────────────────────
const { authMiddleware } = await import('../../middleware/auth.js');

function createApp() {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('/protected/*', authMiddleware);
  app.get('/protected/resource', (c) => {
    return c.json({ success: true, userId: c.get('userId') });
  });
  return app;
}

// ─── Tests ──────────────────────────────────────────────────────────────────
describe('authMiddleware', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  it('should extract a valid Bearer token and set userId', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: '550e8400-e29b-41d4-a716-446655440000' } },
      error: null,
    });

    const res = await app.request('http://localhost/protected/resource', {
      headers: { Authorization: 'Bearer valid-token-123' },
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.userId).toBe('550e8400-e29b-41d4-a716-446655440000');
  });

  it('should return 401 when Authorization header is missing', async () => {
    const res = await app.request('http://localhost/protected/resource');

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain('Missing');
  });

  it('should return 401 when Authorization header has no Bearer prefix', async () => {
    const res = await app.request('http://localhost/protected/resource', {
      headers: { Authorization: 'Basic some-token' },
    });

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain('malformed');
  });

  it('should return 401 when Bearer token is empty', async () => {
    const res = await app.request('http://localhost/protected/resource', {
      headers: { Authorization: 'Bearer ' },
    });

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it('should return 401 when Supabase verification fails with error', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'Invalid JWT' },
    });

    const res = await app.request('http://localhost/protected/resource', {
      headers: { Authorization: 'Bearer bad-token' },
    });

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toContain('Invalid or expired');
  });

  it('should return 401 when Supabase returns no user (null)', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });

    const res = await app.request('http://localhost/protected/resource', {
      headers: { Authorization: 'Bearer orphan-token' },
    });

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toContain('Invalid or expired');
  });

  it('should return 401 when user ID is not a valid UUID', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'not-a-uuid' } },
      error: null,
    });

    const res = await app.request('http://localhost/protected/resource', {
      headers: { Authorization: 'Bearer valid-token' },
    });

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toContain('Invalid user ID');
  });

  it('should accept uppercase UUID', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: '550E8400-E29B-41D4-A716-446655440000' } },
      error: null,
    });

    const res = await app.request('http://localhost/protected/resource', {
      headers: { Authorization: 'Bearer valid-token' },
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.userId).toBe('550E8400-E29B-41D4-A716-446655440000');
  });

  it('should call supabaseAdmin.auth.getUser with the extracted token', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: '550e8400-e29b-41d4-a716-446655440000' } },
      error: null,
    });

    await app.request('http://localhost/protected/resource', {
      headers: { Authorization: 'Bearer my-specific-token-value' },
    });

    expect(mockGetUser).toHaveBeenCalledWith('my-specific-token-value');
  });

  it('should reject tokens with SQL injection-like user IDs', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "'; DROP TABLE users; --" } },
      error: null,
    });

    const res = await app.request('http://localhost/protected/resource', {
      headers: { Authorization: 'Bearer evil-token' },
    });

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toContain('Invalid user ID');
  });

  it('should allow the next middleware to run on success', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: '550e8400-e29b-41d4-a716-446655440000' } },
      error: null,
    });

    const res = await app.request('http://localhost/protected/resource', {
      headers: { Authorization: 'Bearer good-token' },
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });
});
