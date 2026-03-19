import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppVariables } from '../../types/index.js';

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

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'friend-uuid'),
}));

function chainMock(returnValue: { data: any; error: any; count?: number | null }) {
  const chain: any = {};
  const methods = [
    'select', 'insert', 'update', 'delete',
    'eq', 'neq', 'or', 'in', 'ilike', 'contains', 'not', 'gt',
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

const { friendsRoutes } = await import('../../routes/friends.js');

const app = new Hono<{ Variables: AppVariables }>();
app.route('/friends', friendsRoutes);

function req(method: string, path: string, body?: any, headers?: Record<string, string>) {
  const init: RequestInit = { method, headers: { 'Content-Type': 'application/json', ...headers } };
  if (body) init.body = JSON.stringify(body);
  return app.request(`http://localhost/friends${path}`, init);
}

const AUTH = { 'X-Test-User-Id': 'user-f-1' };

describe('Friends Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── List Friends ──────────────────────────────────────────────────────

  describe('GET /friends', () => {
    it('should return list of accepted friends with profiles', async () => {
      const friendshipsChain = chainMock({
        data: [
          { id: 'fs-1', requester_id: 'user-f-1', addressee_id: 'friend-1', created_at: '2025-01-01' },
        ],
        error: null,
      });
      const profilesChain = chainMock({
        data: [
          { id: 'friend-1', full_name: 'Friend One', avatar_url: null, style_preferences: [] },
        ],
        error: null,
      });

      let callIdx = 0;
      mockSupabase.from.mockImplementation(() => {
        callIdx++;
        return callIdx === 1 ? friendshipsChain : profilesChain;
      });

      const res = await req('GET', '', undefined, AUTH);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toHaveLength(1);
      expect(json.data[0].full_name).toBe('Friend One');
      expect(json.data[0].friendship_id).toBe('fs-1');
    });

    it('should return empty array when user has no friends', async () => {
      const chain = chainMock({ data: [], error: null });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('GET', '', undefined, AUTH);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toEqual([]);
    });
  });

  // ── Send Friend Request ───────────────────────────────────────────────

  describe('POST /friends/request', () => {
    it('should send a friend request by user_id', async () => {
      // target exists
      const targetChain = chainMock({ data: { id: 'target-1' }, error: null });
      // no existing friendship
      const existingChain = chainMock({ data: null, error: null });
      // insert
      const insertChain = chainMock({
        data: { id: 'friend-uuid', requester_id: 'user-f-1', addressee_id: 'target-1', status: 'pending' },
        error: null,
      });
      // requester profile for notification
      const profileChain = chainMock({ data: { full_name: 'User F1' }, error: null });
      // notification insert
      const notifChain = chainMock({ data: null, error: null });

      let callIdx = 0;
      mockSupabase.from.mockImplementation(() => {
        callIdx++;
        if (callIdx === 1) return targetChain;
        if (callIdx === 2) return existingChain;
        if (callIdx === 3) return insertChain;
        if (callIdx === 4) return profileChain;
        return notifChain;
      });

      const res = await req('POST', '/request', { user_id: 'target-1' }, AUTH);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.data.status).toBe('pending');
    });

    it('should send a friend request by username', async () => {
      // lookup by username
      const lookupChain = chainMock({ data: { id: 'target-2' }, error: null });
      // target exists
      const targetChain = chainMock({ data: { id: 'target-2' }, error: null });
      // no existing
      const existingChain = chainMock({ data: null, error: null });
      // insert
      const insertChain = chainMock({
        data: { id: 'friend-uuid', status: 'pending' },
        error: null,
      });
      const profileChain = chainMock({ data: { full_name: 'User' }, error: null });
      const notifChain = chainMock({ data: null, error: null });

      let callIdx = 0;
      mockSupabase.from.mockImplementation(() => {
        callIdx++;
        if (callIdx === 1) return lookupChain;
        if (callIdx === 2) return targetChain;
        if (callIdx === 3) return existingChain;
        if (callIdx === 4) return insertChain;
        if (callIdx === 5) return profileChain;
        return notifChain;
      });

      const res = await req('POST', '/request', { username: 'target_user' }, AUTH);
      expect(res.status).toBe(201);
    });

    it('should prevent self friend request', async () => {
      const res = await req('POST', '/request', { user_id: 'user-f-1' }, AUTH);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('yourself');
    });

    it('should return 400 when no user_id or username provided', async () => {
      const res = await req('POST', '/request', {}, AUTH);
      expect(res.status).toBe(400);
    });

    it('should return 404 when target user does not exist', async () => {
      const chain = chainMock({ data: null, error: { code: 'PGRST116' } });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('POST', '/request', { user_id: 'nonexistent' }, AUTH);
      expect(res.status).toBe(404);
    });

    it('should return 400 when already friends', async () => {
      // target exists
      const targetChain = chainMock({ data: { id: 'target-3' }, error: null });
      // existing friendship
      const existingChain = chainMock({
        data: { id: 'fs-existing', status: 'accepted' },
        error: null,
      });

      let callIdx = 0;
      mockSupabase.from.mockImplementation(() => {
        callIdx++;
        return callIdx === 1 ? targetChain : existingChain;
      });

      const res = await req('POST', '/request', { user_id: 'target-3' }, AUTH);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('already friends');
    });

    it('should return 400 when request already pending', async () => {
      const targetChain = chainMock({ data: { id: 'target-4' }, error: null });
      const existingChain = chainMock({
        data: { id: 'fs-pending', status: 'pending' },
        error: null,
      });

      let callIdx = 0;
      mockSupabase.from.mockImplementation(() => {
        callIdx++;
        return callIdx === 1 ? targetChain : existingChain;
      });

      const res = await req('POST', '/request', { user_id: 'target-4' }, AUTH);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('pending');
    });

    it('should return 400 when blocked', async () => {
      const targetChain = chainMock({ data: { id: 'target-5' }, error: null });
      const existingChain = chainMock({
        data: { id: 'fs-blocked', status: 'blocked' },
        error: null,
      });

      let callIdx = 0;
      mockSupabase.from.mockImplementation(() => {
        callIdx++;
        return callIdx === 1 ? targetChain : existingChain;
      });

      const res = await req('POST', '/request', { user_id: 'target-5' }, AUTH);
      expect(res.status).toBe(400);
    });
  });

  // ── Incoming Requests ─────────────────────────────────────────────────

  describe('GET /friends/requests', () => {
    it('should return pending incoming friend requests', async () => {
      const requestsChain = chainMock({
        data: [{ id: 'req-1', requester_id: 'requester-1', created_at: '2025-01-01' }],
        error: null,
      });
      const profilesChain = chainMock({
        data: [{ id: 'requester-1', full_name: 'Requester', avatar_url: null }],
        error: null,
      });

      let callIdx = 0;
      mockSupabase.from.mockImplementation(() => {
        callIdx++;
        return callIdx === 1 ? requestsChain : profilesChain;
      });

      const res = await req('GET', '/requests', undefined, AUTH);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toHaveLength(1);
      expect(json.data[0].requester.full_name).toBe('Requester');
    });
  });

  // ── Accept Friend Request ─────────────────────────────────────────────

  describe('POST /friends/accept/:id', () => {
    it('should accept a pending friend request', async () => {
      const updateChain = chainMock({
        data: { id: 'fs-1', requester_id: 'other-user', addressee_id: 'user-f-1', status: 'accepted' },
        error: null,
      });
      const profileChain = chainMock({ data: { full_name: 'Accepter' }, error: null });
      const notifChain = chainMock({ data: null, error: null });

      let callIdx = 0;
      mockSupabase.from.mockImplementation(() => {
        callIdx++;
        if (callIdx === 1) return updateChain;
        if (callIdx === 2) return profileChain;
        return notifChain;
      });

      const res = await req('POST', '/accept/fs-1', {}, AUTH);
      expect(res.status).toBe(200);
    });

    it('should return 404 when request not found', async () => {
      const chain = chainMock({ data: null, error: { code: 'PGRST116' } });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('POST', '/accept/nonexistent', {}, AUTH);
      expect(res.status).toBe(404);
    });
  });

  // ── Reject Friend Request ─────────────────────────────────────────────

  describe('POST /friends/reject/:id', () => {
    it('should reject a pending friend request', async () => {
      const chain = chainMock({ data: null, error: null });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('POST', '/reject/fs-1', {}, AUTH);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.message).toContain('rejected');
    });
  });

  // ── Remove Friend ─────────────────────────────────────────────────────

  describe('DELETE /friends/:id', () => {
    it('should remove a friend', async () => {
      const chain = chainMock({ data: null, error: null });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('DELETE', '/friend-1', undefined, AUTH);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.message).toContain('removed');
    });
  });

  // ── Search ────────────────────────────────────────────────────────────

  describe('GET /friends/search', () => {
    it('should search users by name', async () => {
      const usersChain = chainMock({
        data: [{ id: 'found-1', full_name: 'Alice Smith', avatar_url: null }],
        error: null,
      });
      const friendshipChain = chainMock({ data: null, error: null });

      let callIdx = 0;
      mockSupabase.from.mockImplementation(() => {
        callIdx++;
        return callIdx === 1 ? usersChain : friendshipChain;
      });

      const res = await req('GET', '/search?q=Alice', undefined, AUTH);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toHaveLength(1);
      expect(json.data[0].full_name).toBe('Alice Smith');
    });

    it('should return 400 when query is too short', async () => {
      const res = await req('GET', '/search?q=A', undefined, AUTH);
      expect(res.status).toBe(400);
    });

    it('should return 400 when query is too long', async () => {
      const res = await req('GET', `/search?q=${'a'.repeat(51)}`, undefined, AUTH);
      expect(res.status).toBe(400);
    });

    it('should include friendship status in results', async () => {
      const usersChain = chainMock({
        data: [{ id: 'found-2', full_name: 'Bob', avatar_url: null }],
        error: null,
      });
      const friendshipChain = chainMock({
        data: { id: 'fs-bob', status: 'accepted', requester_id: 'user-f-1' },
        error: null,
      });

      let callIdx = 0;
      mockSupabase.from.mockImplementation(() => {
        callIdx++;
        return callIdx === 1 ? usersChain : friendshipChain;
      });

      const res = await req('GET', '/search?q=Bob', undefined, AUTH);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data[0].friendship_status).toBe('friends');
    });
  });

  // ── View Friend's Closet ──────────────────────────────────────────────

  describe('GET /friends/:id/closet', () => {
    it('should return friend closet when friendship exists', async () => {
      const friendshipChain = chainMock({ data: { id: 'fs-1' }, error: null });
      const itemsChain = chainMock({
        data: [{ id: 'item-1', name: 'Shirt', category: 'tops' }],
        error: null,
        count: 1,
      });

      let callIdx = 0;
      mockSupabase.from.mockImplementation(() => {
        callIdx++;
        return callIdx === 1 ? friendshipChain : itemsChain;
      });

      const res = await req('GET', '/friend-1/closet', undefined, AUTH);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toHaveLength(1);
    });

    it('should return 403 when not friends', async () => {
      const chain = chainMock({ data: null, error: null });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('GET', '/stranger-1/closet', undefined, AUTH);
      expect(res.status).toBe(403);
    });
  });
});
