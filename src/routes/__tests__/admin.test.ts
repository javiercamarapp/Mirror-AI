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

const mockCleanupExpiredStories = vi.fn();
vi.mock('../../jobs/storyCleanup.js', () => ({
  cleanupExpiredStories: (...args: any[]) => mockCleanupExpiredStories(...args),
}));

// ─── Import route after mocks ──────────────────────────────────────────────
const { adminRoutes } = await import('../../routes/admin.js');

const app = new Hono<{ Variables: AppVariables }>();
app.route('/admin', adminRoutes);

function req(method: string, path: string, body?: any, headers?: Record<string, string>) {
  const init: RequestInit = { method, headers: { 'Content-Type': 'application/json', ...headers } };
  if (body) init.body = JSON.stringify(body);
  return app.request(`http://localhost/admin${path}`, init);
}

const ADMIN_ID = 'admin-user-1';
const NON_ADMIN_ID = 'regular-user-1';
const ADMIN_HEADER = { 'X-Test-User-Id': ADMIN_ID };
const NON_ADMIN_HEADER = { 'X-Test-User-Id': NON_ADMIN_ID };

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('Admin Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set up admin user IDs env
    process.env.ADMIN_USER_IDS = ADMIN_ID;
  });

  // ── Admin Auth Middleware ───────────────────────────────────────────────

  describe('Admin Authorization', () => {
    it('should allow admin users through', async () => {
      mockCleanupExpiredStories.mockResolvedValue({ deletedStories: 0, deletedViews: 0 });

      const res = await req('GET', '/jobs/cleanup-stories', undefined, ADMIN_HEADER);
      expect(res.status).toBe(200);
    });

    it('should return 403 for non-admin users', async () => {
      const res = await req('GET', '/jobs/cleanup-stories', undefined, NON_ADMIN_HEADER);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toContain('Admin access required');
    });

    it('should return 401 when not authenticated', async () => {
      const res = await req('GET', '/jobs/cleanup-stories');
      expect(res.status).toBe(401);
    });

    it('should handle multiple admin IDs in environment variable', async () => {
      process.env.ADMIN_USER_IDS = `other-admin, ${ADMIN_ID}, another-admin`;
      mockCleanupExpiredStories.mockResolvedValue({ deletedStories: 0, deletedViews: 0 });

      const res = await req('GET', '/jobs/cleanup-stories', undefined, ADMIN_HEADER);
      expect(res.status).toBe(200);
    });

    it('should return 403 when ADMIN_USER_IDS is not set', async () => {
      delete process.env.ADMIN_USER_IDS;

      const res = await req('GET', '/jobs/cleanup-stories', undefined, ADMIN_HEADER);
      expect(res.status).toBe(403);
    });
  });

  // ── GET /admin/jobs/cleanup-stories ────────────────────────────────────

  describe('GET /admin/jobs/cleanup-stories', () => {
    it('should run story cleanup and return results', async () => {
      mockCleanupExpiredStories.mockResolvedValue({
        deletedStories: 5,
        deletedViews: 20,
      });

      const res = await req('GET', '/jobs/cleanup-stories', undefined, ADMIN_HEADER);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.deleted_stories).toBe(5);
      expect(json.data.deleted_views).toBe(20);
      expect(json.data.executed_at).toBeDefined();
      expect(json.data.message).toContain('cleanup completed');
    });

    it('should return results when no stories need cleanup', async () => {
      mockCleanupExpiredStories.mockResolvedValue({
        deletedStories: 0,
        deletedViews: 0,
      });

      const res = await req('GET', '/jobs/cleanup-stories', undefined, ADMIN_HEADER);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.deleted_stories).toBe(0);
      expect(json.data.deleted_views).toBe(0);
    });

    it('should return 500 when cleanup job fails', async () => {
      mockCleanupExpiredStories.mockRejectedValue(new Error('Database connection lost'));

      const res = await req('GET', '/jobs/cleanup-stories', undefined, ADMIN_HEADER);
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toContain('Database connection lost');
    });

    it('should return 500 when cleanup throws unexpected error', async () => {
      mockCleanupExpiredStories.mockRejectedValue('string error');

      const res = await req('GET', '/jobs/cleanup-stories', undefined, ADMIN_HEADER);
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('Unknown error');
    });

    it('should handle large cleanup results', async () => {
      mockCleanupExpiredStories.mockResolvedValue({
        deletedStories: 10000,
        deletedViews: 50000,
      });

      const res = await req('GET', '/jobs/cleanup-stories', undefined, ADMIN_HEADER);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.deleted_stories).toBe(10000);
      expect(json.data.deleted_views).toBe(50000);
    });

    it('should call cleanupExpiredStories exactly once', async () => {
      mockCleanupExpiredStories.mockResolvedValue({ deletedStories: 0, deletedViews: 0 });

      await req('GET', '/jobs/cleanup-stories', undefined, ADMIN_HEADER);
      expect(mockCleanupExpiredStories).toHaveBeenCalledTimes(1);
    });

    it('should include ISO timestamp in executed_at', async () => {
      mockCleanupExpiredStories.mockResolvedValue({ deletedStories: 0, deletedViews: 0 });

      const res = await req('GET', '/jobs/cleanup-stories', undefined, ADMIN_HEADER);
      const json = await res.json();
      // Verify it's a valid ISO date
      expect(() => new Date(json.data.executed_at)).not.toThrow();
      expect(new Date(json.data.executed_at).toISOString()).toBe(json.data.executed_at);
    });

    it('should not call cleanup when request is from non-admin', async () => {
      await req('GET', '/jobs/cleanup-stories', undefined, NON_ADMIN_HEADER);
      expect(mockCleanupExpiredStories).not.toHaveBeenCalled();
    });

    it('should not call cleanup when request is unauthenticated', async () => {
      await req('GET', '/jobs/cleanup-stories');
      expect(mockCleanupExpiredStories).not.toHaveBeenCalled();
    });

    it('should handle comma-separated admin IDs with extra whitespace', async () => {
      process.env.ADMIN_USER_IDS = `  ${ADMIN_ID}  ,  other-admin  `;
      mockCleanupExpiredStories.mockResolvedValue({ deletedStories: 1, deletedViews: 2 });

      const res = await req('GET', '/jobs/cleanup-stories', undefined, ADMIN_HEADER);
      expect(res.status).toBe(200);
    });

    it('should return 403 when admin ID is substring of another but not exact match', async () => {
      process.env.ADMIN_USER_IDS = 'admin-user-100,admin-user-12';

      const res = await req('GET', '/jobs/cleanup-stories', undefined, ADMIN_HEADER);
      expect(res.status).toBe(403);
    });

    it('should reject empty admin ID', async () => {
      process.env.ADMIN_USER_IDS = ',,,';

      const res = await req('GET', '/jobs/cleanup-stories', undefined, { 'X-Test-User-Id': '' });
      // Empty user ID means auth fails
      expect(res.status).toBe(401);
    });
  });
});
