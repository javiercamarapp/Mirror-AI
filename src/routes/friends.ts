import { Hono } from 'hono';
import { supabaseAdmin } from '../services/supabase.js';
import { authMiddleware } from '../middleware/auth.js';
import { sendPushNotification } from '../services/pushNotifications.js';
import { logger } from '../services/logger.js';
import type { AppVariables } from '../types/index.js';
import { v4 as uuidv4 } from 'uuid';

const friends = new Hono<{ Variables: AppVariables }>();

// All friend routes require authentication
friends.use('*', authMiddleware);

// ─── GET /friends ───────────────────────────────────────────────────────────
// List accepted friends (with profile info).
friends.get('/', async (c) => {
  try {
    const userId = c.get('userId');

    const { data: friendships, error } = await supabaseAdmin
      .from('friendships')
      .select('id, requester_id, addressee_id, created_at')
      .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
      .eq('status', 'accepted');

    if (error) {
      return c.json({ success: false, error: error.message }, 500);
    }

    if (!friendships || friendships.length === 0) {
      return c.json({ success: true, data: [] });
    }

    const friendIds = friendships.map((f) =>
      f.requester_id === userId ? f.addressee_id : f.requester_id
    );

    const { data: profiles } = await supabaseAdmin
      .from('user_profiles')
      .select('id, full_name, avatar_url, style_preferences')
      .in('id', friendIds);

    // Map friendship IDs to profiles for easy unfriending
    const friendsWithMeta = (profiles ?? []).map((profile) => {
      const friendship = friendships.find(
        (f) => f.requester_id === profile.id || f.addressee_id === profile.id
      );
      return {
        ...profile,
        friendship_id: friendship?.id ?? null,
        friends_since: friendship?.created_at ?? null,
      };
    });

    return c.json({ success: true, data: friendsWithMeta });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── POST /friends/request ──────────────────────────────────────────────────
// Send friend request (body: { user_id or username }).
friends.post('/request', async (c) => {
  try {
    const userId = c.get('userId');
    const body = await c.req.json<{
      user_id?: string;
      username?: string;
    }>();

    let targetId = body.user_id;

    // Look up by username if no user_id provided
    if (!targetId && body.username) {
      const { data: targetUser } = await supabaseAdmin
        .from('user_profiles')
        .select('id')
        .ilike('full_name', body.username)
        .limit(1)
        .single();

      if (!targetUser) {
        return c.json({ success: false, error: 'User not found' }, 404);
      }
      targetId = targetUser.id;
    }

    if (!targetId) {
      return c.json({ success: false, error: 'user_id or username is required' }, 400);
    }

    if (targetId === userId) {
      return c.json({ success: false, error: 'You cannot send a friend request to yourself' }, 400);
    }

    // Verify the target user exists
    const { data: targetExists } = await supabaseAdmin
      .from('user_profiles')
      .select('id')
      .eq('id', targetId)
      .single();

    if (!targetExists) {
      return c.json({ success: false, error: 'User not found' }, 404);
    }

    // Check if friendship already exists in either direction
    const { data: existing } = await supabaseAdmin
      .from('friendships')
      .select('id, status')
      .or(
        `and(requester_id.eq.${userId},addressee_id.eq.${targetId}),and(requester_id.eq.${targetId},addressee_id.eq.${userId})`
      )
      .maybeSingle();

    if (existing) {
      if (existing.status === 'accepted') {
        return c.json({ success: false, error: 'You are already friends' }, 400);
      }
      if (existing.status === 'pending') {
        return c.json({ success: false, error: 'Friend request already pending' }, 400);
      }
      if (existing.status === 'blocked') {
        return c.json({ success: false, error: 'Cannot send friend request' }, 400);
      }
    }

    // Create the friend request
    const { data: request, error } = await supabaseAdmin
      .from('friendships')
      .insert({
        id: uuidv4(),
        requester_id: userId,
        addressee_id: targetId,
        status: 'pending',
      })
      .select()
      .single();

    if (error) {
      return c.json({ success: false, error: error.message }, 500);
    }

    // Notify the target user
    const { data: requester } = await supabaseAdmin
      .from('user_profiles')
      .select('full_name')
      .eq('id', userId)
      .single();

    await supabaseAdmin.from('notifications').insert({
      id: uuidv4(),
      user_id: targetId,
      type: 'friend_request',
      title: `${requester?.full_name ?? 'Someone'} sent you a friend request`,
      body: 'Accept to share outfits and see each other\'s wardrobes',
      data: { friendship_id: request.id, requester_id: userId },
      read: false,
    });

    // Send push notification to the target user
    sendPushNotification(
      targetId,
      `${requester?.full_name ?? 'Someone'} sent you a friend request`,
      'Accept to share outfits and see each other\'s wardrobes',
      { type: 'friend_request', friendship_id: request.id, requester_id: userId }
    ).catch((err) => { logger.warn({ err, targetId }, 'Failed to send friend request push notification'); });

    return c.json({ success: true, data: request }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error({ err }, 'Friend request failed');
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── GET /friends/requests ──────────────────────────────────────────────────
// Get pending incoming friend requests.
friends.get('/requests', async (c) => {
  try {
    const userId = c.get('userId');

    const { data: requests, error } = await supabaseAdmin
      .from('friendships')
      .select('id, requester_id, created_at')
      .eq('addressee_id', userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) {
      return c.json({ success: false, error: error.message }, 500);
    }

    if (!requests || requests.length === 0) {
      return c.json({ success: true, data: [] });
    }

    // Enrich with requester profile info
    const requesterIds = requests.map((r) => r.requester_id);
    const { data: profiles } = await supabaseAdmin
      .from('user_profiles')
      .select('id, full_name, avatar_url')
      .in('id', requesterIds);

    const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));

    const enrichedRequests = requests.map((request) => ({
      ...request,
      requester: profileMap.get(request.requester_id) ?? null,
    }));

    return c.json({ success: true, data: enrichedRequests });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── POST /friends/accept/:id ───────────────────────────────────────────────
// Accept a friend request.
friends.post('/accept/:id', async (c) => {
  try {
    const userId = c.get('userId');
    const friendshipId = c.req.param('id');

    const { data, error } = await supabaseAdmin
      .from('friendships')
      .update({ status: 'accepted' })
      .eq('id', friendshipId)
      .eq('addressee_id', userId)
      .eq('status', 'pending')
      .select()
      .single();

    if (error || !data) {
      return c.json({ success: false, error: 'Friend request not found or already handled' }, 404);
    }

    // Notify the requester
    const { data: accepter } = await supabaseAdmin
      .from('user_profiles')
      .select('full_name')
      .eq('id', userId)
      .single();

    await supabaseAdmin.from('notifications').insert({
      id: uuidv4(),
      user_id: data.requester_id,
      type: 'friend_accepted',
      title: `${accepter?.full_name ?? 'Someone'} accepted your friend request`,
      body: 'You can now share outfits and view each other\'s wardrobes',
      data: { friendship_id: data.id },
      read: false,
    });

    // Send push notification to the requester
    sendPushNotification(
      data.requester_id,
      `${accepter?.full_name ?? 'Someone'} accepted your friend request`,
      'You can now share outfits and view each other\'s wardrobes',
      { type: 'friend_accepted', friendship_id: data.id }
    ).catch((err) => { logger.warn({ err }, 'Failed to send friend accepted push notification'); });

    return c.json({ success: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── POST /friends/reject/:id ───────────────────────────────────────────────
// Reject a friend request.
friends.post('/reject/:id', async (c) => {
  try {
    const userId = c.get('userId');
    const friendshipId = c.req.param('id');

    const { error } = await supabaseAdmin
      .from('friendships')
      .delete()
      .eq('id', friendshipId)
      .eq('addressee_id', userId)
      .eq('status', 'pending');

    if (error) {
      return c.json({ success: false, error: error.message }, 500);
    }

    return c.json({ success: true, data: { message: 'Friend request rejected' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── DELETE /friends/:id ────────────────────────────────────────────────────
// Remove a friend.
friends.delete('/:id', async (c) => {
  try {
    const userId = c.get('userId');
    const friendId = c.req.param('id');

    const { error } = await supabaseAdmin
      .from('friendships')
      .delete()
      .or(
        `and(requester_id.eq.${userId},addressee_id.eq.${friendId}),and(requester_id.eq.${friendId},addressee_id.eq.${userId})`
      )
      .eq('status', 'accepted');

    if (error) {
      return c.json({ success: false, error: error.message }, 500);
    }

    return c.json({ success: true, data: { message: 'Friend removed successfully' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── GET /friends/search ────────────────────────────────────────────────────
// Search users by name/username.
friends.get('/search', async (c) => {
  try {
    const userId = c.get('userId');
    const query = c.req.query('q');

    if (!query || query.length < 2) {
      return c.json({ success: false, error: 'Query must be at least 2 characters' }, 400);
    }

    if (query.length > 50) {
      return c.json({ success: false, error: 'Query must be 50 characters or less' }, 400);
    }

    const { data: users, error } = await supabaseAdmin
      .from('user_profiles')
      .select('id, full_name, avatar_url')
      .neq('id', userId)
      .ilike('full_name', `%${query}%`)
      .limit(20);

    if (error) {
      return c.json({ success: false, error: error.message }, 500);
    }

    if (!users || users.length === 0) {
      return c.json({ success: true, data: [] });
    }

    // Batch fetch all friendships for found users in a single query (fixes N+1)
    const userIds = users.map((u) => u.id);
    const { data: friendships } = await supabaseAdmin
      .from('friendships')
      .select('id, status, requester_id, addressee_id')
      .or(
        userIds
          .map((uid) => `and(requester_id.eq.${userId},addressee_id.eq.${uid}),and(requester_id.eq.${uid},addressee_id.eq.${userId})`)
          .join(',')
      );

    // Build a map of user_id -> friendship for quick lookup
    const friendshipMap = new Map<string, { id: string; status: string; requester_id: string }>();
    for (const f of friendships ?? []) {
      const otherUserId = f.requester_id === userId ? f.addressee_id : f.requester_id;
      friendshipMap.set(otherUserId, f);
    }

    const enriched = users.map((user) => {
      const friendship = friendshipMap.get(user.id) ?? null;

      let friendshipStatus: string | null = null;
      if (friendship) {
        if (friendship.status === 'accepted') {
          friendshipStatus = 'friends';
        } else if (friendship.status === 'pending') {
          friendshipStatus = friendship.requester_id === userId
            ? 'request_sent'
            : 'request_received';
        } else {
          friendshipStatus = friendship.status;
        }
      }

      return {
        ...user,
        friendship_status: friendshipStatus,
        friendship_id: friendship?.id ?? null,
      };
    });

    return c.json({ success: true, data: enriched });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── GET /friends/:id/closet ────────────────────────────────────────────────
// View friend's wardrobe (public items). Requires accepted friendship.
friends.get('/:id/closet', async (c) => {
  try {
    const userId = c.get('userId');
    const friendId = c.req.param('id');
    const category = c.req.query('category');
    const page = parseInt(c.req.query('page') ?? '1', 10);
    const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 100);
    const offset = (page - 1) * limit;

    // Verify friendship
    const { data: friendship } = await supabaseAdmin
      .from('friendships')
      .select('id')
      .or(
        `and(requester_id.eq.${userId},addressee_id.eq.${friendId}),and(requester_id.eq.${friendId},addressee_id.eq.${userId})`
      )
      .eq('status', 'accepted')
      .maybeSingle();

    if (!friendship) {
      return c.json({ success: false, error: 'You must be friends to view their wardrobe' }, 403);
    }

    let query = supabaseAdmin
      .from('wardrobe_items')
      .select('id, name, category, subcategory, color, brand, image_url, image_no_bg_url, is_favorite, season, occasions', { count: 'exact' })
      .eq('user_id', friendId)
      .order('created_at', { ascending: false });

    if (category) {
      query = query.eq('category', category);
    }

    query = query.range(offset, offset + limit - 1);

    const { data: items, error, count } = await query;

    if (error) {
      return c.json({ success: false, error: error.message }, 500);
    }

    return c.json({
      success: true,
      data: items ?? [],
      pagination: {
        page,
        limit,
        total: count ?? 0,
        has_more: (count ?? 0) > offset + limit,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── GET /friends/:id/outfits ───────────────────────────────────────────────
// View friend's shared outfits. Requires accepted friendship.
friends.get('/:id/outfits', async (c) => {
  try {
    const userId = c.get('userId');
    const friendId = c.req.param('id');
    const page = parseInt(c.req.query('page') ?? '1', 10);
    const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10), 50);
    const offset = (page - 1) * limit;

    // Verify friendship
    const { data: friendship } = await supabaseAdmin
      .from('friendships')
      .select('id')
      .or(
        `and(requester_id.eq.${userId},addressee_id.eq.${friendId}),and(requester_id.eq.${friendId},addressee_id.eq.${userId})`
      )
      .eq('status', 'accepted')
      .maybeSingle();

    if (!friendship) {
      return c.json({ success: false, error: 'You must be friends to view their outfits' }, 403);
    }

    // Get their social posts (outfit shares)
    const { data: posts, error, count } = await supabaseAdmin
      .from('social_posts')
      .select('*, user:user_profiles!user_id(full_name, avatar_url)', { count: 'exact' })
      .eq('user_id', friendId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      return c.json({ success: false, error: error.message }, 500);
    }

    // Check which posts the current user has liked
    const postIds = (posts ?? []).map((p) => p.id);
    let likedPostIds = new Set<string>();

    if (postIds.length > 0) {
      const { data: userLikes } = await supabaseAdmin
        .from('post_likes')
        .select('post_id')
        .eq('user_id', userId)
        .in('post_id', postIds);

      likedPostIds = new Set((userLikes ?? []).map((l) => l.post_id));
    }

    const enrichedPosts = (posts ?? []).map((post) => ({
      ...post,
      is_liked: likedPostIds.has(post.id),
    }));

    return c.json({
      success: true,
      data: enrichedPosts,
      pagination: {
        page,
        limit,
        total: count ?? 0,
        has_more: (count ?? 0) > offset + limit,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── POST /friends/unblock/:userId ─────────────────────────────────────────
// Unblock a user. Only the user who initiated the block can unblock.
friends.post('/unblock/:userId', async (c) => {
  try {
    const userId = c.get('userId');
    const blockedUserId = c.req.param('userId');

    if (!blockedUserId) {
      return c.json({ success: false, error: 'userId parameter is required' }, 400);
    }

    if (blockedUserId === userId) {
      return c.json({ success: false, error: 'Invalid user ID' }, 400);
    }

    // Find the blocked friendship record where the current user is the blocker.
    // In the block flow (POST /social/block), the blocker is stored as requester_id.
    const { data: blocked, error: findError } = await supabaseAdmin
      .from('friendships')
      .select('id, requester_id')
      .eq('status', 'blocked')
      .eq('requester_id', userId)
      .eq('addressee_id', blockedUserId)
      .maybeSingle();

    if (findError) {
      return c.json({ success: false, error: findError.message }, 500);
    }

    if (!blocked) {
      return c.json({ success: false, error: 'Block record not found or you are not the blocker' }, 404);
    }

    // Validate that the current user is indeed the blocker (requester_id)
    if (blocked.requester_id !== userId) {
      return c.json({ success: false, error: 'Only the user who blocked can unblock' }, 403);
    }

    // Remove the blocked friendship record
    const { error: deleteError } = await supabaseAdmin
      .from('friendships')
      .delete()
      .eq('id', blocked.id);

    if (deleteError) {
      return c.json({ success: false, error: deleteError.message }, 500);
    }

    return c.json({ success: true, data: { message: 'User unblocked successfully' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error({ err }, 'Unblock user failed');
    return c.json({ success: false, error: message }, 500);
  }
});

export { friends as friendsRoutes };
