import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppVariables } from '../../types/index.js';

// ─── Mock Supabase ─────────────────────────────────────────────────────────
const mockSupabase = {
  auth: { getUser: vi.fn() },
  from: vi.fn(),
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

vi.mock('../../services/pushNotifications.js', () => ({
  sendPushNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../services/contentModeration.js', () => ({
  processReports: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../middleware/moderation.js', () => ({
  moderationMiddleware: vi.fn(async (_c: any, next: any) => { await next(); }),
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'mock-uuid'),
}));

// Chainable query builder mock
function chainMock(returnValue: { data: any; error: any; count?: number | null }) {
  const chain: any = {};
  const methods = [
    'select', 'insert', 'update', 'delete', 'upsert',
    'eq', 'neq', 'or', 'in', 'not', 'gt', 'ilike', 'contains',
    'single', 'maybeSingle', 'order', 'limit', 'range',
  ];
  for (const m of methods) {
    chain[m] = vi.fn(() => chain);
  }
  chain.single = vi.fn(() => Promise.resolve(returnValue));
  chain.maybeSingle = vi.fn(() => Promise.resolve(returnValue));
  chain.then = (resolve: any) => resolve(returnValue);
  return chain;
}

const { socialRoutes } = await import('../../routes/social.js');

const app = new Hono<{ Variables: AppVariables }>();
app.route('/social', socialRoutes);

function req(method: string, path: string, body?: any, headers?: Record<string, string>) {
  const init: RequestInit = { method, headers: { 'Content-Type': 'application/json', ...headers } };
  if (body) init.body = JSON.stringify(body);
  return app.request(`http://localhost/social${path}`, init);
}

const AUTH = { 'X-Test-User-Id': 'user-social-1' };

describe('Social Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Feed ───────────────────────────────────────────────────────────────

  describe('GET /social/feed', () => {
    it('should return paginated feed with liked status', async () => {
      // friendships (getFriendIds)
      const friendshipsChain = chainMock({ data: [{ requester_id: 'user-social-1', addressee_id: 'friend-1' }], error: null });
      // blocks
      const blocksChain = chainMock({ data: [], error: null });
      // posts
      const postsChain = chainMock({
        data: [
          { id: 'post-1', user_id: 'friend-1', caption: 'Hi', created_at: '2025-01-01', likes_count: 2, user: { full_name: 'F1', avatar_url: null } },
        ],
        error: null,
        count: 1,
      });
      // likes
      const likesChain = chainMock({ data: [{ post_id: 'post-1' }], error: null });

      let callIdx = 0;
      mockSupabase.from.mockImplementation(() => {
        callIdx++;
        if (callIdx === 1) return friendshipsChain;
        if (callIdx === 2) return blocksChain;
        if (callIdx === 3) return postsChain;
        return likesChain;
      });

      const res = await req('GET', '/feed?page=1&limit=10', undefined, AUTH);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toHaveLength(1);
      expect(json.data[0].is_liked).toBe(true);
      expect(json.pagination.page).toBe(1);
    });

    it('should respect pagination params', async () => {
      const friendshipsChain = chainMock({ data: [], error: null });
      const blocksChain = chainMock({ data: [], error: null });
      const postsChain = chainMock({ data: [], error: null, count: 0 });
      let callIdx = 0;
      mockSupabase.from.mockImplementation(() => {
        callIdx++;
        if (callIdx === 1) return friendshipsChain;
        if (callIdx === 2) return blocksChain;
        return postsChain;
      });

      const res = await req('GET', '/feed?page=2&limit=5', undefined, AUTH);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.pagination.page).toBe(2);
      expect(json.pagination.limit).toBe(5);
    });

    it('should cap limit at 50', async () => {
      const friendshipsChain = chainMock({ data: [], error: null });
      const blocksChain = chainMock({ data: [], error: null });
      const postsChain = chainMock({ data: [], error: null, count: 0 });
      let callIdx = 0;
      mockSupabase.from.mockImplementation(() => {
        callIdx++;
        if (callIdx === 1) return friendshipsChain;
        if (callIdx === 2) return blocksChain;
        return postsChain;
      });

      const res = await req('GET', '/feed?limit=200', undefined, AUTH);
      const json = await res.json();
      expect(json.pagination.limit).toBe(50);
    });

    it('should filter out blocked users from feed', async () => {
      const friendshipsChain = chainMock({
        data: [
          { requester_id: 'user-social-1', addressee_id: 'friend-1' },
          { requester_id: 'user-social-1', addressee_id: 'friend-2' },
        ],
        error: null,
      });
      const blocksChain = chainMock({
        data: [{ requester_id: 'user-social-1', addressee_id: 'friend-2' }],
        error: null,
      });
      const postsChain = chainMock({ data: [], error: null, count: 0 });

      let callIdx = 0;
      mockSupabase.from.mockImplementation(() => {
        callIdx++;
        if (callIdx === 1) return friendshipsChain;
        if (callIdx === 2) return blocksChain;
        return postsChain;
      });

      const res = await req('GET', '/feed', undefined, AUTH);
      expect(res.status).toBe(200);
    });
  });

  // ── Posts ──────────────────────────────────────────────────────────────

  describe('POST /social/posts', () => {
    it('should create a post', async () => {
      const insertChain = chainMock({
        data: { id: 'mock-uuid', user_id: 'user-social-1', type: 'outfit', image_url: 'https://img.com/a.jpg', likes_count: 0, comments_count: 0, user: { full_name: 'Test', avatar_url: null } },
        error: null,
      });
      const friendshipsChain = chainMock({ data: [], error: null });
      let callIdx = 0;
      mockSupabase.from.mockImplementation(() => {
        callIdx++;
        if (callIdx === 1) return insertChain;
        return friendshipsChain;
      });

      const res = await req('POST', '/posts', {
        type: 'outfit',
        image_url: 'https://img.com/a.jpg',
        caption: 'My outfit',
      }, AUTH);

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.data.is_liked).toBe(false);
    });

    it('should return 400 when type is missing', async () => {
      const res = await req('POST', '/posts', { image_url: 'https://x.com/i.jpg' }, AUTH);
      expect(res.status).toBe(400);
    });

    it('should return 400 when image_url is missing', async () => {
      const res = await req('POST', '/posts', { type: 'outfit' }, AUTH);
      expect(res.status).toBe(400);
    });
  });

  // ── Like / Unlike ─────────────────────────────────────────────────────

  describe('POST /social/posts/:id/like', () => {
    it('should like a post when not already liked', async () => {
      const existingChain = chainMock({ data: null, error: null });
      const insertChain = chainMock({ data: null, error: null });
      const postChain = chainMock({ data: { likes_count: 5, user_id: 'other-user' }, error: null });
      const updateChain = chainMock({ data: null, error: null });
      const profileChain = chainMock({ data: { full_name: 'Liker' }, error: null });
      const notifChain = chainMock({ data: null, error: null });

      let callIdx = 0;
      mockSupabase.from.mockImplementation(() => {
        callIdx++;
        if (callIdx === 1) return existingChain;
        if (callIdx === 2) return insertChain;
        if (callIdx === 3) return postChain;
        if (callIdx === 4) return updateChain;
        if (callIdx === 5) return profileChain;
        return notifChain;
      });

      const res = await req('POST', '/posts/post-1/like', {}, AUTH);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.liked).toBe(true);
    });

    it('should unlike a post when already liked', async () => {
      const existingChain = chainMock({ data: { id: 'like-1' }, error: null });
      const deleteChain = chainMock({ data: null, error: null });
      const postChain = chainMock({ data: { likes_count: 5 }, error: null });
      const updateChain = chainMock({ data: null, error: null });

      let callIdx = 0;
      mockSupabase.from.mockImplementation(() => {
        callIdx++;
        if (callIdx === 1) return existingChain;
        if (callIdx === 2) return deleteChain;
        if (callIdx === 3) return postChain;
        return updateChain;
      });

      const res = await req('POST', '/posts/post-1/like', {}, AUTH);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.liked).toBe(false);
    });
  });

  // ── Comments ──────────────────────────────────────────────────────────

  describe('POST /social/posts/:id/comments', () => {
    it('should add a comment to a post', async () => {
      const insertChain = chainMock({
        data: { id: 'comment-1', content: 'Nice outfit!', user: { full_name: 'Commenter', avatar_url: null } },
        error: null,
      });
      const postChain = chainMock({ data: { comments_count: 2, user_id: 'other-user' }, error: null });
      const updateChain = chainMock({ data: null, error: null });
      const profileChain = chainMock({ data: { full_name: 'Commenter' }, error: null });
      const notifChain = chainMock({ data: null, error: null });

      let callIdx = 0;
      mockSupabase.from.mockImplementation(() => {
        callIdx++;
        if (callIdx === 1) return insertChain;
        if (callIdx === 2) return postChain;
        if (callIdx === 3) return updateChain;
        if (callIdx === 4) return profileChain;
        return notifChain;
      });

      const res = await req('POST', '/posts/post-1/comments', { content: 'Nice outfit!' }, AUTH);
      expect(res.status).toBe(201);
    });

    it('should return 400 for empty comment', async () => {
      const res = await req('POST', '/posts/post-1/comments', { content: '' }, AUTH);
      expect(res.status).toBe(400);
    });

    it('should return 400 for comment over 500 characters', async () => {
      const res = await req('POST', '/posts/post-1/comments', { content: 'a'.repeat(501) }, AUTH);
      expect(res.status).toBe(400);
    });

    it('should sanitize HTML from comment content', async () => {
      const insertChain = chainMock({
        data: { id: 'c-2', content: 'clean text', user: { full_name: 'T', avatar_url: null } },
        error: null,
      });
      const postChain = chainMock({ data: { comments_count: 0, user_id: 'user-social-1' }, error: null });
      const updateChain = chainMock({ data: null, error: null });

      let callIdx = 0;
      mockSupabase.from.mockImplementation(() => {
        callIdx++;
        if (callIdx === 1) return insertChain;
        if (callIdx === 2) return postChain;
        return updateChain;
      });

      const res = await req('POST', '/posts/post-1/comments', { content: '<script>alert("xss")</script>clean text' }, AUTH);
      expect(res.status).toBe(201);
    });
  });

  describe('GET /social/posts/:id/comments', () => {
    it('should return paginated comments', async () => {
      const chain = chainMock({
        data: [
          { id: 'c-1', content: 'First!', user: { full_name: 'A', avatar_url: null } },
        ],
        error: null,
        count: 1,
      });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('GET', '/posts/post-1/comments', undefined, AUTH);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toHaveLength(1);
    });
  });

  // ── Delete Post ───────────────────────────────────────────────────────

  describe('DELETE /social/posts/:id', () => {
    it('should delete own post', async () => {
      const fetchChain = chainMock({ data: { id: 'post-del', user_id: 'user-social-1' }, error: null });
      const deleteChain = chainMock({ data: null, error: null });

      let callIdx = 0;
      mockSupabase.from.mockImplementation(() => {
        callIdx++;
        if (callIdx === 1) return fetchChain;
        return deleteChain;
      });

      const res = await req('DELETE', '/posts/post-del', undefined, AUTH);
      expect(res.status).toBe(200);
    });

    it('should return 403 when deleting another users post', async () => {
      const chain = chainMock({ data: { id: 'post-other', user_id: 'other-user' }, error: null });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('DELETE', '/posts/post-other', undefined, AUTH);
      expect(res.status).toBe(403);
    });

    it('should return 404 when post not found', async () => {
      const chain = chainMock({ data: null, error: { code: 'PGRST116' } });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('DELETE', '/posts/nonexistent', undefined, AUTH);
      expect(res.status).toBe(404);
    });
  });

  // ── Stories ────────────────────────────────────────────────────────────

  describe('POST /social/stories', () => {
    it('should create a story with 24h expiry', async () => {
      const chain = chainMock({
        data: { id: 'story-1', user_id: 'user-social-1', image_url: 'https://img.com/s.jpg', expires_at: '2025-06-02T12:00:00Z', user: { full_name: 'T', avatar_url: null } },
        error: null,
      });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('POST', '/stories', { image_url: 'https://img.com/s.jpg' }, AUTH);
      expect(res.status).toBe(201);
    });

    it('should return 400 when image_url is missing', async () => {
      const res = await req('POST', '/stories', {}, AUTH);
      expect(res.status).toBe(400);
    });
  });

  // ── Hide Post ─────────────────────────────────────────────────────────

  describe('POST /social/posts/:id/hide', () => {
    it('should hide a post from feed', async () => {
      const chain = chainMock({ data: null, error: null });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('POST', '/posts/post-1/hide', {}, AUTH);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.message).toContain('hidden');
    });
  });

  // ── Block ─────────────────────────────────────────────────────────────

  describe('POST /social/block', () => {
    it('should block a user', async () => {
      const deleteChain = chainMock({ data: null, error: null });
      const insertChain = chainMock({ data: { id: 'block-1' }, error: null });
      let callIdx = 0;
      mockSupabase.from.mockImplementation(() => {
        callIdx++;
        return callIdx === 1 ? deleteChain : insertChain;
      });

      const res = await req('POST', '/block', { blocked_user_id: 'bad-user' }, AUTH);
      expect(res.status).toBe(201);
    });

    it('should return 400 when trying to block yourself', async () => {
      const res = await req('POST', '/block', { blocked_user_id: 'user-social-1' }, AUTH);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('yourself');
    });

    it('should return 400 when blocked_user_id is missing', async () => {
      const res = await req('POST', '/block', {}, AUTH);
      expect(res.status).toBe(400);
    });
  });

  // ── Report ────────────────────────────────────────────────────────────

  describe('POST /social/report', () => {
    it('should report content', async () => {
      const chain = chainMock({ data: { id: 'report-1', status: 'pending' }, error: null });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('POST', '/report', {
        content_type: 'post',
        content_id: 'post-1',
        reason: 'Inappropriate content',
      }, AUTH);
      expect(res.status).toBe(201);
    });

    it('should return 400 for invalid content_type', async () => {
      const res = await req('POST', '/report', {
        content_type: 'invalid',
        content_id: 'x',
        reason: 'test',
      }, AUTH);
      expect(res.status).toBe(400);
    });

    it('should return 400 when required fields are missing', async () => {
      const res = await req('POST', '/report', { content_type: 'post' }, AUTH);
      expect(res.status).toBe(400);
    });
  });
});
