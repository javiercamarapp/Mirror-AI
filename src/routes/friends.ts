import { Hono } from 'hono';
import { supabaseAdmin } from '../services/supabase.js';
import { authMiddleware } from '../middleware/auth.js';
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
      .from('profiles')
      .select('id, name, avatar_url, style_preferences')
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
        .from('profiles')
        .select('id')
        .ilike('name', body.username)
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
      .from('profiles')
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
      .from('profiles')
      .select('name')
      .eq('id', userId)
      .single();

    await supabaseAdmin.from('notifications').insert({
      id: uuidv4(),
      user_id: targetId,
      type: 'friend_request',
      title: `${requester?.name ?? 'Someone'} sent you a friend request`,
      body: 'Accept to share outfits and see each other\'s wardrobes',
      data: { friendship_id: request.id, requester_id: userId },
      read: false,
    });

    return c.json({ success: true, data: request }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Friend Request Error]:', err);
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
      .from('profiles')
      .select('id, name, avatar_url')
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
      .from('profiles')
      .select('name')
      .eq('id', userId)
      .single();

    await supabaseAdmin.from('notifications').insert({
      id: uuidv4(),
      user_id: data.requester_id,
      type: 'friend_accepted',
      title: `${accepter?.name ?? 'Someone'} accepted your friend request`,
      body: 'You can now share outfits and view each other\'s wardrobes',
      data: { friendship_id: data.id },
      read: false,
    });

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

    const { data: users, error } = await supabaseAdmin
      .from('profiles')
      .select('id, name, avatar_url')
      .neq('id', userId)
      .ilike('name', `%${query}%`)
      .limit(20);

    if (error) {
      return c.json({ success: false, error: error.message }, 500);
    }

    if (!users || users.length === 0) {
      return c.json({ success: true, data: [] });
    }

    // Check friendship status for each found user
    const enriched = await Promise.all(
      users.map(async (user) => {
        const { data: friendship } = await supabaseAdmin
          .from('friendships')
          .select('id, status, requester_id')
          .or(
            `and(requester_id.eq.${userId},addressee_id.eq.${user.id}),and(requester_id.eq.${user.id},addressee_id.eq.${userId})`
          )
          .maybeSingle();

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
      })
    );

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
      .select('*, user:profiles!user_id(name, avatar_url)', { count: 'exact' })
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
        .from('likes')
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

export { friends as friendsRoutes };
