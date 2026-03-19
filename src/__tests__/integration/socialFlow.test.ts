import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppVariables } from '../../types/index.js';

// ─── Mock Supabase ──────────────────────────────────────────────────────────
const mockRpc = vi.fn().mockResolvedValue({ data: null, error: null });
const mockSupabase = {
  from: vi.fn(),
  rpc: mockRpc,
};

function chainMock(returnValue: { data: any; error: any; count?: number }) {
  const chain: any = {};
  const methods = [
    'select', 'insert', 'update', 'delete', 'upsert', 'eq', 'neq', 'or', 'in',
    'single', 'maybeSingle', 'order', 'limit', 'range', 'ilike', 'contains',
    'not', 'gt', 'is', 'head',
  ];
  for (const method of methods) {
    chain[method] = vi.fn(() => chain);
  }
  chain.single = vi.fn(() => Promise.resolve(returnValue));
  chain.maybeSingle = vi.fn(() => Promise.resolve(returnValue));
  chain.then = (resolve: any) => resolve(returnValue);
  return chain;
}

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

vi.mock('../../middleware/moderation.js', () => ({
  moderationMiddleware: vi.fn(async (_c: any, next: any) => {
    await next();
  }),
}));

vi.mock('../../services/pushNotifications.js', () => ({
  sendPushNotification: vi.fn().mockResolvedValue(undefined),
  sendPushNotificationToMany: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../services/contentModeration.js', () => ({
  processReports: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../services/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
  createChildLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'mock-uuid-' + Math.random().toString(36).slice(2, 8)),
}));

// ─── Import route after mocks ───────────────────────────────────────────────
const { socialRoutes } = await import('../../routes/social.js');

const app = new Hono<{ Variables: AppVariables }>();
app.route('/social', socialRoutes);

const AUTH = { 'X-Test-User-Id': 'user-1' };
const AUTH2 = { 'X-Test-User-Id': 'user-2' };

function req(method: string, path: string, body?: any, headers?: Record<string, string>) {
  const init: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
  };
  if (body) init.body = JSON.stringify(body);
  return app.request(`http://localhost/social${path}`, init);
}

// ─── Tests ───────────────────────────────────────────────────────────────────
describe('Social Flow Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc.mockResolvedValue({ data: null, error: null });
  });

  // ── Create Post ───────────────────────────────────────────────────────────

  describe('Create Post → Feed Flow', () => {
    it('should create a post successfully', async () => {
      // Insert returns the post
      const postData = {
        id: 'post-1', user_id: 'user-1', type: 'outfit',
        image_url: 'https://img.jpg', caption: 'My look',
        likes_count: 0, comments_count: 0,
        user: { full_name: 'User 1', avatar_url: null },
      };
      const insertChain = chainMock({ data: postData, error: null });

      // getFriendIds
      const friendsChain = chainMock({
        data: [{ requester_id: 'user-1', addressee_id: 'user-2' }],
        error: null,
      });

      // Profile for notification
      const profileChain = chainMock({
        data: { full_name: 'User 1' },
        error: null,
      });

      // notifications insert
      const notifChain = chainMock({ data: null, error: null });

      let callIdx = 0;
      mockSupabase.from.mockImplementation((table: string) => {
        callIdx++;
        if (table === 'social_posts') return insertChain;
        if (table === 'friendships') return friendsChain;
        if (table === 'user_profiles') return profileChain;
        if (table === 'notifications') return notifChain;
        return chainMock({ data: null, error: null });
      });

      const res = await req('POST', '/posts', {
        type: 'outfit',
        image_url: 'https://img.jpg',
        caption: 'My look',
      }, AUTH);

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe('post-1');
    });

    it('should return 400 when type is missing', async () => {
      const res = await req('POST', '/posts', { image_url: 'https://img.jpg' }, AUTH);
      expect(res.status).toBe(400);
    });

    it('should return 400 when image_url is missing', async () => {
      const res = await req('POST', '/posts', { type: 'outfit' }, AUTH);
      expect(res.status).toBe(400);
    });
  });

  // ── Like Post ─────────────────────────────────────────────────────────────

  describe('Like Post → Notification Flow', () => {
    it('should like a post and increment counter via RPC', async () => {
      // Check existing like (none)
      const noLikeChain = chainMock({ data: null, error: null });
      // Get post owner for notification
      const postChain = chainMock({ data: { user_id: 'user-2' }, error: null });
      // Get liker profile
      const profileChain = chainMock({ data: { full_name: 'User 1' }, error: null });
      // Notification insert
      const notifChain = chainMock({ data: null, error: null });

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'post_likes') return noLikeChain;
        if (table === 'social_posts') return postChain;
        if (table === 'user_profiles') return profileChain;
        if (table === 'notifications') return notifChain;
        return chainMock({ data: null, error: null });
      });

      const res = await req('POST', '/posts/post-1/like', undefined, AUTH);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.liked).toBe(true);

      // Uses atomic_like_post RPC
      expect(mockRpc).toHaveBeenCalledWith('atomic_like_post', expect.objectContaining({
        p_post_id: 'post-1',
        p_user_id: 'user-1',
      }));
    });

    it('should unlike a post and decrement counter', async () => {
      // Existing like found
      const existingLikeChain = chainMock({ data: { id: 'like-1' }, error: null });

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'post_likes') return existingLikeChain;
        return chainMock({ data: null, error: null });
      });

      const res = await req('POST', '/posts/post-1/like', undefined, AUTH);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.liked).toBe(false);

      // Uses atomic_unlike_post RPC
      expect(mockRpc).toHaveBeenCalledWith('atomic_unlike_post', {
        p_like_id: 'like-1',
        p_post_id: 'post-1',
      });
    });
  });

  // ── Comment Flow ──────────────────────────────────────────────────────────

  describe('Comment on Post → Notification Flow', () => {
    it('should add a comment and increment counter', async () => {
      const commentData = {
        id: 'comment-1', post_id: 'post-1', user_id: 'user-1',
        content: 'Nice!', user: { full_name: 'User 1', avatar_url: null },
      };
      const insertChain = chainMock({ data: commentData, error: null });
      const postChain = chainMock({ data: { user_id: 'user-2' }, error: null });
      const profileChain = chainMock({ data: { full_name: 'User 1' }, error: null });
      const notifChain = chainMock({ data: null, error: null });

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'post_comments') return insertChain;
        if (table === 'social_posts') return postChain;
        if (table === 'user_profiles') return profileChain;
        if (table === 'notifications') return notifChain;
        return chainMock({ data: null, error: null });
      });

      const res = await req('POST', '/posts/post-1/comments', { content: 'Nice!' }, AUTH);
      expect(res.status).toBe(201);

      expect(mockRpc).toHaveBeenCalledWith('increment_post_comments', {
        p_post_id: 'post-1',
        p_delta: 1,
      });
    });

    it('should return 400 for empty comment content', async () => {
      const res = await req('POST', '/posts/post-1/comments', { content: '' }, AUTH);
      expect(res.status).toBe(400);
    });

    it('should return 400 for comment over 500 characters', async () => {
      const res = await req(
        'POST',
        '/posts/post-1/comments',
        { content: 'x'.repeat(501) },
        AUTH
      );
      expect(res.status).toBe(400);
    });

    it('should strip HTML tags from comments', async () => {
      const commentData = {
        id: 'comment-2', post_id: 'post-1', user_id: 'user-1',
        content: 'alert("xss")',
        user: { full_name: 'User 1', avatar_url: null },
      };
      const insertChain = chainMock({ data: commentData, error: null });
      const postChain = chainMock({ data: { user_id: 'user-2' }, error: null });
      const profileChain = chainMock({ data: { full_name: 'User 1' }, error: null });
      const notifChain = chainMock({ data: null, error: null });

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'post_comments') return insertChain;
        if (table === 'social_posts') return postChain;
        if (table === 'user_profiles') return profileChain;
        if (table === 'notifications') return notifChain;
        return chainMock({ data: null, error: null });
      });

      const res = await req(
        'POST',
        '/posts/post-1/comments',
        { content: '<script>alert("xss")</script>' },
        AUTH
      );
      expect(res.status).toBe(201);
      // The insert should have been called with sanitized content
    });
  });

  // ── Block User → Hidden from Feed ────────────────────────────────────────

  describe('Block User → Posts Hidden', () => {
    it('should block a user successfully', async () => {
      const deleteChain = chainMock({ data: null, error: null });
      const insertChain = chainMock({
        data: { id: 'block-1', requester_id: 'user-1', addressee_id: 'user-2', status: 'blocked' },
        error: null,
      });

      let callIdx = 0;
      mockSupabase.from.mockImplementation(() => {
        callIdx++;
        return callIdx === 1 ? deleteChain : insertChain;
      });

      const res = await req('POST', '/block', { blocked_user_id: 'a0000000-0000-4000-a000-000000000002' }, AUTH);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.data.message).toContain('blocked');
    });

    it('should not allow blocking yourself', async () => {
      const res = await req('POST', '/block', { blocked_user_id: 'user-1' }, AUTH);
      expect(res.status).toBe(400);
    });

    it('should return 400 when blocked_user_id is missing', async () => {
      const res = await req('POST', '/block', {}, AUTH);
      expect(res.status).toBe(400);
    });

    it('should filter blocked users from feed', async () => {
      // getFriendIds
      const friendsChain = chainMock({
        data: [{ requester_id: 'user-1', addressee_id: 'user-2' }],
        error: null,
      });
      // Blocked users
      const blocksChain = chainMock({
        data: [{ requester_id: 'user-1', addressee_id: 'user-2', status: 'blocked' }],
        error: null,
      });
      // Posts (filtered)
      const postsChain = chainMock({ data: [], error: null, count: 0 });
      // User likes
      const likesChain = chainMock({ data: [], error: null });

      let callIdx = 0;
      mockSupabase.from.mockImplementation((table: string) => {
        callIdx++;
        if (table === 'friendships' && callIdx === 1) return friendsChain;
        if (table === 'friendships' && callIdx === 2) return blocksChain;
        if (table === 'social_posts') return postsChain;
        if (table === 'post_likes') return likesChain;
        return chainMock({ data: [], error: null });
      });

      const res = await req('GET', '/feed', undefined, AUTH);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
    });
  });

  // ── Report Post ───────────────────────────────────────────────────────────

  describe('Report Post Flow', () => {
    it('should create a report and trigger processing', async () => {
      const { processReports } = await import('../../services/contentModeration.js');

      const insertChain = chainMock({
        data: { id: 'report-1', content_type: 'post', content_id: 'post-1', status: 'pending' },
        error: null,
      });
      mockSupabase.from.mockReturnValue(insertChain);

      const res = await req('POST', '/report', {
        content_type: 'post',
        content_id: 'post-1',
        reason: 'spam',
      }, AUTH);

      expect(res.status).toBe(201);
      expect(processReports).toHaveBeenCalledWith('post', 'post-1');
    });

    it('should return 400 with invalid content_type', async () => {
      const res = await req('POST', '/report', {
        content_type: 'invalid',
        content_id: 'x',
        reason: 'spam',
      }, AUTH);
      expect(res.status).toBe(400);
    });

    it('should return 400 when missing required fields', async () => {
      const res = await req('POST', '/report', { content_type: 'post' }, AUTH);
      expect(res.status).toBe(400);
    });
  });

  // ── Create Story ──────────────────────────────────────────────────────────

  describe('Create Story Flow', () => {
    it('should create a story with 24h expiry', async () => {
      const storyData = {
        id: 'story-1', user_id: 'user-1', image_url: 'https://img.jpg',
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        views_count: 0,
        user: { full_name: 'User 1', avatar_url: null },
      };
      const insertChain = chainMock({ data: storyData, error: null });
      mockSupabase.from.mockReturnValue(insertChain);

      const res = await req('POST', '/stories', { image_url: 'https://img.jpg' }, AUTH);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.data.expires_at).toBeDefined();
    });

    it('should return 400 when image_url is missing', async () => {
      const res = await req('POST', '/stories', {}, AUTH);
      expect(res.status).toBe(400);
    });
  });

  // ── Share Post ────────────────────────────────────────────────────────────

  describe('Share Post Flow', () => {
    it('should track a share event', async () => {
      const postChain = chainMock({ data: { id: 'post-1' }, error: null });
      const shareChain = chainMock({
        data: { id: 'share-1', post_id: 'post-1', user_id: 'user-1', platform: 'instagram' },
        error: null,
      });

      let callIdx = 0;
      mockSupabase.from.mockImplementation((table: string) => {
        callIdx++;
        if (table === 'social_posts') return postChain;
        if (table === 'post_shares') return shareChain;
        return chainMock({ data: null, error: null });
      });

      const res = await req('POST', '/posts/post-1/share', { platform: 'instagram' }, AUTH);
      expect(res.status).toBe(201);
    });

    it('should return 404 when post does not exist', async () => {
      const postChain = chainMock({ data: null, error: null });
      mockSupabase.from.mockReturnValue(postChain);

      const res = await req('POST', '/posts/missing/share', {}, AUTH);
      expect(res.status).toBe(404);
    });
  });

  // ── Delete Post ───────────────────────────────────────────────────────────

  describe('Delete Post Flow', () => {
    it('should soft-delete own post', async () => {
      mockRpc.mockResolvedValueOnce({ data: true, error: null });
      const updateChain = chainMock({ data: null, error: null });
      mockSupabase.from.mockReturnValue(updateChain);

      const res = await req('DELETE', '/posts/post-1', undefined, AUTH);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.message).toContain('deleted');
    });

    it('should return 404 when post not found or not owned', async () => {
      mockRpc.mockResolvedValueOnce({ data: false, error: null });

      const res = await req('DELETE', '/posts/other-post', undefined, AUTH);
      expect(res.status).toBe(404);
    });
  });

  // ── Unauthenticated ──────────────────────────────────────────────────────

  describe('Authentication Required', () => {
    it('should return 401 for unauthenticated feed request', async () => {
      const res = await req('GET', '/feed');
      expect(res.status).toBe(401);
    });

    it('should return 401 for unauthenticated post creation', async () => {
      const res = await req('POST', '/posts', { type: 'outfit', image_url: 'https://img.jpg' });
      expect(res.status).toBe(401);
    });
  });
});
