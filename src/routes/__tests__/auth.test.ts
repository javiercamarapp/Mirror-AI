import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppVariables } from '../../types/index.js';

// ─── Mock Supabase ─────────────────────────────────────────────────────────
const mockSupabase = {
  auth: {
    signInWithIdToken: vi.fn(),
    signInWithOtp: vi.fn(),
    exchangeCodeForSession: vi.fn(),
    refreshSession: vi.fn(),
    getUser: vi.fn(),
    admin: { deleteUser: vi.fn() },
  },
  from: vi.fn(),
  storage: {
    from: vi.fn(() => ({
      list: vi.fn().mockResolvedValue({ data: [], error: null }),
      remove: vi.fn().mockResolvedValue({ error: null }),
    })),
  },
};

vi.mock('../../services/supabase.js', () => ({
  supabaseAdmin: mockSupabase,
}));

vi.mock('../../middleware/auth.js', () => ({
  authMiddleware: vi.fn(async (c: any, next: any) => {
    const userId = c.req.header('X-Test-User-Id');
    if (!userId) return c.json({ success: false, error: 'Unauthorized' }, 401);
    c.set('userId', userId);
    await next();
  }),
}));

vi.mock('../../services/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
  createChildLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

vi.mock('../../services/redis.js', () => ({
  getRedisClient: vi.fn(() => null),
}));

// Helper to build chainable query mock
function chainMock(returnValue: { data: any; error: any; count?: number }) {
  const chain: any = {};
  const methods = ['select', 'insert', 'update', 'delete', 'eq', 'neq', 'or', 'in', 'single', 'maybeSingle', 'order', 'limit', 'range', 'ilike', 'contains', 'not', 'gt'];
  for (const method of methods) {
    chain[method] = vi.fn(() => chain);
  }
  chain.single = vi.fn(() => Promise.resolve(returnValue));
  chain.maybeSingle = vi.fn(() => Promise.resolve(returnValue));
  // Make the chain itself thenable for queries without .single()
  chain.then = (resolve: any) => resolve(returnValue);
  return chain;
}

// ─── Import route after mocks ──────────────────────────────────────────────
const { authRoutes } = await import('../../routes/auth.js');

const app = new Hono<{ Variables: AppVariables }>();
app.route('/auth', authRoutes);

// Fake JWT-format token (3 base64url segments) for passing format validation
const FAKE_JWT = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXIiLCJlbWFpbCI6InRlc3RAdGVzdC5jb20ifQ.ZmFrZS1zaWduYXR1cmU';

function req(method: string, path: string, body?: any, headers?: Record<string, string>) {
  const init: RequestInit = { method, headers: { 'Content-Type': 'application/json', ...headers } };
  if (body) init.body = JSON.stringify(body);
  return app.request(`http://localhost/auth${path}`, init);
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('Auth Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Apple Sign In ──────────────────────────────────────────────────────

  describe('POST /auth/apple', () => {
    it('should sign in with a valid Apple id_token (new user)', async () => {
      mockSupabase.auth.signInWithIdToken.mockResolvedValue({
        data: {
          user: { id: 'user-1', email: 'alice@test.com', user_metadata: { full_name: 'Alice' } },
          session: { access_token: 'at-1', refresh_token: 'rt-1', expires_at: 9999999999 },
        },
        error: null,
      });
      // No existing profile
      const profileChain = chainMock({ data: null, error: { code: 'PGRST116' } });
      const insertChain = chainMock({ data: { id: 'user-1' }, error: null });
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'user_profiles') return profileChain;
        return insertChain;
      });

      const res = await req('POST', '/apple', { id_token: FAKE_JWT, full_name: 'Alice' });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.access_token).toBe('at-1');
      expect(json.data.user.email).toBe('alice@test.com');
    });

    it('should return 400 when id_token is missing', async () => {
      const res = await req('POST', '/apple', {});
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toContain('id_token');
    });

    it('should return 401 when Apple auth fails', async () => {
      mockSupabase.auth.signInWithIdToken.mockResolvedValue({
        data: { user: null, session: null },
        error: { message: 'Invalid token' },
      });

      const res = await req('POST', '/apple', { id_token: FAKE_JWT });
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.success).toBe(false);
    });

    it('should update full_name for existing user when provided', async () => {
      mockSupabase.auth.signInWithIdToken.mockResolvedValue({
        data: {
          user: { id: 'user-1', email: 'a@test.com', user_metadata: {} },
          session: { access_token: 'at', refresh_token: 'rt', expires_at: 99 },
        },
        error: null,
      });
      const profileChain = chainMock({ data: { id: 'user-1' }, error: null });
      mockSupabase.from.mockReturnValue(profileChain);

      const res = await req('POST', '/apple', { id_token: FAKE_JWT, full_name: 'New Name' });
      expect(res.status).toBe(200);
    });
  });

  // ── Google Sign In ─────────────────────────────────────────────────────

  describe('POST /auth/google', () => {
    it('should sign in with a valid Google id_token', async () => {
      mockSupabase.auth.signInWithIdToken.mockResolvedValue({
        data: {
          user: { id: 'user-2', email: 'bob@test.com', user_metadata: { full_name: 'Bob' } },
          session: { access_token: 'at-2', refresh_token: 'rt-2', expires_at: 99 },
        },
        error: null,
      });
      const profileChain = chainMock({ data: { id: 'user-2' }, error: null });
      mockSupabase.from.mockReturnValue(profileChain);

      const res = await req('POST', '/google', { id_token: FAKE_JWT });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.user.id).toBe('user-2');
    });

    it('should return 400 when Google id_token is missing', async () => {
      const res = await req('POST', '/google', {});
      expect(res.status).toBe(400);
    });
  });

  // ── Magic Link ─────────────────────────────────────────────────────────

  describe('POST /auth/magic-link', () => {
    it('should send a magic link to a valid email', async () => {
      mockSupabase.auth.signInWithOtp.mockResolvedValue({ error: null });

      const res = await req('POST', '/magic-link', { email: 'test@example.com' });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.message).toContain('Magic link');
    });

    it('should return 400 when email is missing', async () => {
      const res = await req('POST', '/magic-link', {});
      expect(res.status).toBe(400);
    });

    it('should return 400 when OTP sending fails', async () => {
      mockSupabase.auth.signInWithOtp.mockResolvedValue({
        error: { message: 'Rate limit exceeded' },
      });

      const res = await req('POST', '/magic-link', { email: 'test@test.com' });
      expect(res.status).toBe(400);
    });
  });

  // ── Signup ─────────────────────────────────────────────────────────────

  describe('POST /auth/signup', () => {
    it('should create a new user profile', async () => {
      const chain = chainMock({ data: null, error: { code: 'PGRST116' } });
      const insertChain = chainMock({
        data: { id: 'user-3', email: 'new@test.com', full_name: 'New' },
        error: null,
      });
      // First call: check existing, second call: insert
      let callCount = 0;
      mockSupabase.from.mockImplementation(() => {
        callCount++;
        return callCount === 1 ? chain : insertChain;
      });

      const res = await req('POST', '/signup', { id: 'user-3', email: 'new@test.com', name: 'New' });
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
    });

    it('should return 400 when required fields are missing', async () => {
      const res = await req('POST', '/signup', { id: 'x' });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('required');
    });

    it('should return 200 when profile already exists', async () => {
      const chain = chainMock({ data: { id: 'user-3' }, error: null });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('POST', '/signup', { id: 'user-3', email: 'e@t.com', name: 'N' });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.message).toContain('already exists');
    });
  });

  // ── Token Refresh ──────────────────────────────────────────────────────

  describe('POST /auth/refresh', () => {
    it('should refresh the session with a valid refresh token', async () => {
      mockSupabase.auth.refreshSession.mockResolvedValue({
        data: {
          session: { access_token: 'new-at', refresh_token: 'new-rt', expires_at: 88888 },
        },
        error: null,
      });

      const res = await req('POST', '/refresh', { refresh_token: 'valid-rt' });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.access_token).toBe('new-at');
    });

    it('should return 400 when refresh_token is missing', async () => {
      const res = await req('POST', '/refresh', {});
      expect(res.status).toBe(400);
    });

    it('should return 401 when refresh_token is invalid', async () => {
      mockSupabase.auth.refreshSession.mockResolvedValue({
        data: { session: null },
        error: { message: 'Invalid refresh token' },
      });

      const res = await req('POST', '/refresh', { refresh_token: 'bad-rt' });
      expect(res.status).toBe(401);
    });
  });

  // ── Callback ───────────────────────────────────────────────────────────

  describe('POST /auth/callback', () => {
    it('should exchange code for session and ensure profile', async () => {
      mockSupabase.auth.exchangeCodeForSession.mockResolvedValue({
        data: {
          user: { id: 'u-cb', email: 'cb@test.com', user_metadata: { full_name: 'CB' } },
          session: { access_token: 'at-cb', refresh_token: 'rt-cb', expires_at: 99 },
        },
        error: null,
      });
      const chain = chainMock({ data: { id: 'u-cb' }, error: null });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('POST', '/callback', { code: 'auth-code-123' });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.access_token).toBe('at-cb');
    });

    it('should return 400 when code is missing', async () => {
      const res = await req('POST', '/callback', {});
      expect(res.status).toBe(400);
    });

    it('should return 401 when code exchange fails', async () => {
      mockSupabase.auth.exchangeCodeForSession.mockResolvedValue({
        data: { user: null },
        error: { message: 'Invalid code' },
      });

      const res = await req('POST', '/callback', { code: 'bad-code' });
      expect(res.status).toBe(401);
    });
  });

  // ── Account Deletion ──────────────────────────────────────────────────

  describe('DELETE /auth/account', () => {
    it('should delete user account and all related data', async () => {
      const chain = chainMock({ data: null, error: null });
      mockSupabase.from.mockReturnValue(chain);
      mockSupabase.auth.admin.deleteUser.mockResolvedValue({ error: null });
      mockSupabase.storage.from.mockReturnValue({
        list: vi.fn().mockResolvedValue({ data: [], error: null }),
        remove: vi.fn().mockResolvedValue({ error: null }),
      });

      const res = await req('DELETE', '/account', undefined, {
        'X-Test-User-Id': 'user-del',
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.message).toContain('deleted');
    });

    it('should return 401 when not authenticated', async () => {
      const res = await req('DELETE', '/account');
      expect(res.status).toBe(401);
    });
  });
});
