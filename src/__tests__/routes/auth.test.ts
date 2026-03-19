import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// ─── Mock Supabase ──────────────────────────────────────────────────────────
const mockSingle = vi.fn();
const mockMaybeSingle = vi.fn();
const mockSelect = vi.fn(() => ({ single: mockSingle, maybeSingle: mockMaybeSingle }));
const mockInsert = vi.fn(() => ({ select: mockSelect }));
const mockUpdate = vi.fn(() => ({ eq: vi.fn(() => ({ select: mockSelect })) }));
const mockDelete = vi.fn(() => ({
  eq: vi.fn(() => ({
    eq: vi.fn(),
  })),
  or: vi.fn(),
}));
const mockEq = vi.fn(() => ({ single: mockSingle, eq: mockEq, select: mockSelect, or: vi.fn() }));
const mockFrom = vi.fn(() => ({
  select: vi.fn(() => ({ eq: mockEq, in: vi.fn() })),
  insert: mockInsert,
  update: mockUpdate,
  delete: mockDelete,
}));

const mockSignInWithIdToken = vi.fn();
const mockSignInWithOtp = vi.fn();
const mockExchangeCodeForSession = vi.fn();
const mockRefreshSession = vi.fn();
const mockGetUser = vi.fn();
const mockDeleteUser = vi.fn();

const mockStorage = {
  from: vi.fn(() => ({
    list: vi.fn().mockResolvedValue({ data: [], error: null }),
    remove: vi.fn().mockResolvedValue({ error: null }),
  })),
};

vi.mock('../../services/supabase.js', () => ({
  supabaseAdmin: {
    from: (...args: unknown[]) => mockFrom(...args),
    auth: {
      signInWithIdToken: (...args: unknown[]) => mockSignInWithIdToken(...args),
      signInWithOtp: (...args: unknown[]) => mockSignInWithOtp(...args),
      exchangeCodeForSession: (...args: unknown[]) => mockExchangeCodeForSession(...args),
      refreshSession: (...args: unknown[]) => mockRefreshSession(...args),
      getUser: (...args: unknown[]) => mockGetUser(...args),
      admin: {
        deleteUser: (...args: unknown[]) => mockDeleteUser(...args),
      },
    },
    storage: mockStorage,
  },
}));

// ─── Import route after mocks ───────────────────────────────────────────────
import { authRoutes } from '../../routes/auth.js';

// ─── Test app ───────────────────────────────────────────────────────────────
function createApp() {
  const app = new Hono();
  app.route('/auth', authRoutes);
  return app;
}

// ─── Helpers ────────────────────────────────────────────────────────────────
const TEST_USER = {
  id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  email: 'test@example.com',
  user_metadata: { full_name: 'Test User', avatar_url: null },
};

const TEST_SESSION = {
  access_token: 'mock-access-token',
  refresh_token: 'mock-refresh-token',
  expires_at: 1700000000,
};

describe('Auth Routes', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();

    // Default: getUser succeeds (for authMiddleware on protected routes)
    mockGetUser.mockResolvedValue({
      data: { user: TEST_USER },
      error: null,
    });
  });

  // ─── Apple Sign In ──────────────────────────────────────────────────────
  describe('POST /auth/apple', () => {
    it('should sign in with a valid Apple id_token and create a new profile', async () => {
      mockSignInWithIdToken.mockResolvedValue({
        data: { user: TEST_USER, session: TEST_SESSION },
        error: null,
      });
      mockSingle.mockResolvedValue({ data: null, error: { code: 'PGRST116' } });
      mockInsert.mockReturnValue({ select: mockSelect });

      const res = await app.request('/auth/apple', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_token: 'valid-apple-token', full_name: 'Jane Doe' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.access_token).toBe('mock-access-token');
      expect(body.data.user.id).toBe(TEST_USER.id);
    });

    it('should return 400 when id_token is missing', async () => {
      const res = await app.request('/auth/apple', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('id_token');
    });

    it('should return 401 when Apple sign-in fails', async () => {
      mockSignInWithIdToken.mockResolvedValue({
        data: { user: null, session: null },
        error: { message: 'Invalid token' },
      });

      const res = await app.request('/auth/apple', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_token: 'invalid-token' }),
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('Invalid token');
    });

    it('should update name for existing users when full_name is provided', async () => {
      mockSignInWithIdToken.mockResolvedValue({
        data: { user: TEST_USER, session: TEST_SESSION },
        error: null,
      });
      // Existing profile found
      mockSingle.mockResolvedValue({ data: { id: TEST_USER.id }, error: null });

      const res = await app.request('/auth/apple', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_token: 'valid-token', full_name: 'Updated Name' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
    });
  });

  // ─── Google Sign In ─────────────────────────────────────────────────────
  describe('POST /auth/google', () => {
    it('should sign in with a valid Google id_token', async () => {
      mockSignInWithIdToken.mockResolvedValue({
        data: { user: TEST_USER, session: TEST_SESSION },
        error: null,
      });
      mockSingle.mockResolvedValue({ data: { id: TEST_USER.id }, error: null });

      const res = await app.request('/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_token: 'valid-google-token' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.access_token).toBe('mock-access-token');
    });

    it('should return 400 when id_token is missing', async () => {
      const res = await app.request('/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });

    it('should create new profile for first-time Google users', async () => {
      mockSignInWithIdToken.mockResolvedValue({
        data: { user: TEST_USER, session: TEST_SESSION },
        error: null,
      });
      // No existing profile
      mockSingle.mockResolvedValue({ data: null, error: { code: 'PGRST116' } });
      mockInsert.mockReturnValue({ select: mockSelect });

      const res = await app.request('/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_token: 'valid-google-token' }),
      });

      expect(res.status).toBe(200);
      expect(mockFrom).toHaveBeenCalledWith('user_profiles');
    });
  });

  // ─── Magic Link ─────────────────────────────────────────────────────────
  describe('POST /auth/magic-link', () => {
    it('should send a magic link for a valid email', async () => {
      mockSignInWithOtp.mockResolvedValue({ error: null });

      const res = await app.request('/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'user@example.com' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.message).toContain('Magic link');
    });

    it('should return 400 when email is missing', async () => {
      const res = await app.request('/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('email');
    });

    it('should return 400 when OTP sending fails', async () => {
      mockSignInWithOtp.mockResolvedValue({ error: { message: 'Rate limit exceeded' } });

      const res = await app.request('/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'user@example.com' }),
      });

      expect(res.status).toBe(400);
    });
  });

  // ─── Signup ─────────────────────────────────────────────────────────────
  describe('POST /auth/signup', () => {
    it('should create a user profile on signup', async () => {
      // No existing profile
      mockSingle.mockResolvedValueOnce({ data: null, error: { code: 'PGRST116' } });
      // Insert succeeds
      mockSingle.mockResolvedValueOnce({
        data: { id: TEST_USER.id, email: TEST_USER.email, full_name: 'New User' },
        error: null,
      });

      const res = await app.request('/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: TEST_USER.id, email: 'new@example.com', name: 'New User' }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.success).toBe(true);
    });

    it('should return 400 when required fields are missing', async () => {
      const res = await app.request('/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'test@example.com' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('required');
    });

    it('should return success when profile already exists (idempotent)', async () => {
      mockSingle.mockResolvedValueOnce({ data: { id: TEST_USER.id }, error: null });

      const res = await app.request('/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: TEST_USER.id, email: 'test@example.com', name: 'Test' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.message).toContain('already exists');
    });
  });

  // ─── Token Refresh ──────────────────────────────────────────────────────
  describe('POST /auth/refresh', () => {
    it('should refresh tokens with a valid refresh_token', async () => {
      mockRefreshSession.mockResolvedValue({
        data: { session: { ...TEST_SESSION, access_token: 'new-access-token' } },
        error: null,
      });

      const res = await app.request('/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: 'valid-refresh-token' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.access_token).toBe('new-access-token');
    });

    it('should return 400 when refresh_token is missing', async () => {
      const res = await app.request('/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });

    it('should return 401 when refresh token is invalid', async () => {
      mockRefreshSession.mockResolvedValue({
        data: { session: null },
        error: { message: 'Invalid refresh token' },
      });

      const res = await app.request('/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: 'expired-token' }),
      });

      expect(res.status).toBe(401);
    });
  });

  // ─── OAuth Callback ─────────────────────────────────────────────────────
  describe('POST /auth/callback', () => {
    it('should exchange code for session successfully', async () => {
      mockExchangeCodeForSession.mockResolvedValue({
        data: { user: TEST_USER, session: TEST_SESSION },
        error: null,
      });
      mockSingle.mockResolvedValue({ data: { id: TEST_USER.id }, error: null });

      const res = await app.request('/auth/callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'valid-auth-code' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.access_token).toBeDefined();
    });

    it('should return 400 when code is missing', async () => {
      const res = await app.request('/auth/callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });

    it('should return 401 when code exchange fails', async () => {
      mockExchangeCodeForSession.mockResolvedValue({
        data: { user: null },
        error: { message: 'Invalid code' },
      });

      const res = await app.request('/auth/callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'invalid-code' }),
      });

      expect(res.status).toBe(401);
    });
  });

  // ─── Account Deletion ──────────────────────────────────────────────────
  describe('DELETE /auth/account', () => {
    it('should return 401 without authorization header', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'No token' } });

      const res = await app.request('/auth/account', {
        method: 'DELETE',
      });

      expect(res.status).toBe(401);
    });

    it('should delete account with valid auth token', async () => {
      mockGetUser.mockResolvedValue({ data: { user: TEST_USER }, error: null });
      mockDeleteUser.mockResolvedValue({ error: null });

      // Mock all the cascade delete calls
      const mockDeleteChain = {
        eq: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
      };
      mockFrom.mockReturnValue({
        delete: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({ error: null }),
          or: vi.fn().mockResolvedValue({ error: null }),
        })),
        select: vi.fn(() => ({ eq: mockEq })),
      });

      const res = await app.request('/auth/account', {
        method: 'DELETE',
        headers: { Authorization: 'Bearer valid-token' },
      });

      expect(res.status).toBe(200);
    });
  });
});
