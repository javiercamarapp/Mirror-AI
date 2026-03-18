import { Hono } from 'hono';
import { supabaseAdmin } from '../services/supabase.js';
import { authMiddleware } from '../middleware/auth.js';
import type { AppVariables } from '../types/index.js';
import { v4 as uuidv4 } from 'uuid';

const social = new Hono<{ Variables: AppVariables }>();

// All social routes require authentication
social.use('*', authMiddleware);

// ─── Helper: Get friend IDs for a user ─────────────────────────────────────
async function getFriendIds(userId: string): Promise<string[]> {
  const { data: friendships } = await supabaseAdmin
    .from('friendships')
    .select('requester_id, addressee_id')
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
    .eq('status', 'accepted');

  return (friendships ?? []).map((f) =>
    f.requester_id === userId ? f.addressee_id : f.requester_id
  );
}

// ─── GET /social/feed ───────────────────────────────────────────────────────
// Get friend feed (posts from friends, ordered by date, paginated).
social.get('/feed', async (c) => {
  try {
    const userId = c.get('userId');
    const page = parseInt(c.req.query('page') ?? '1', 10);
    const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10), 50);
    const offset = (page - 1) * limit;

    const friendIds = await getFriendIds(userId);
    // Include own posts in feed
    const allIds = [userId, ...friendIds];

    const { data: posts, error, count } = await supabaseAdmin
      .from('social_posts')
      .select('*, user:user_profiles!user_id(full_name, avatar_url)', { count: 'exact' })
      .in('user_id', allIds)
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
    console.error('[Feed Error]:', err);
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── POST /social/posts ─────────────────────────────────────────────────────
// Create post (outfit share).
social.post('/posts', async (c) => {
  try {
    const userId = c.get('userId');
    const body = await c.req.json<{
      type: string;
      image_url: string;
      caption?: string;
      occasion?: string;
      outfit_id?: string;
      outfit_data?: Record<string, unknown>;
      score?: number;
    }>();

    if (!body.type || !body.image_url) {
      return c.json({ success: false, error: 'type and image_url are required' }, 400);
    }

    const { data: post, error } = await supabaseAdmin
      .from('social_posts')
      .insert({
        id: uuidv4(),
        user_id: userId,
        type: body.type,
        image_url: body.image_url,
        caption: body.caption ?? null,
        occasion: body.occasion ?? null,
        outfit_id: body.outfit_id ?? null,
        outfit_data: body.outfit_data ?? null,
        score: body.score ?? null,
        likes_count: 0,
        comments_count: 0,
      })
      .select('*, user:user_profiles!user_id(full_name, avatar_url)')
      .single();

    if (error) {
      return c.json({ success: false, error: error.message }, 500);
    }

    // Notify friends about new post
    const friendIds = await getFriendIds(userId);
    if (friendIds.length > 0) {
      const { data: profile } = await supabaseAdmin
        .from('user_profiles')
        .select('full_name')
        .eq('id', userId)
        .single();

      const notifications = friendIds.map((friendId) => ({
        id: uuidv4(),
        user_id: friendId,
        type: 'new_post',
        title: `${profile?.full_name ?? 'Someone'} shared a new outfit`,
        body: body.caption ?? 'Check out their new look!',
        data: { post_id: post.id },
        read: false,
      }));

      await supabaseAdmin.from('notifications').insert(notifications);
    }

    return c.json({ success: true, data: { ...post, is_liked: false } }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Create Post Error]:', err);
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── GET /social/posts/:id ──────────────────────────────────────────────────
// Get single post with user info.
social.get('/posts/:id', async (c) => {
  try {
    const userId = c.get('userId');
    const postId = c.req.param('id');

    const { data: post, error } = await supabaseAdmin
      .from('social_posts')
      .select('*, user:user_profiles!user_id(full_name, avatar_url)')
      .eq('id', postId)
      .single();

    if (error || !post) {
      return c.json({ success: false, error: 'Post not found' }, 404);
    }

    // Check if user has liked this post
    const { data: like } = await supabaseAdmin
      .from('post_likes')
      .select('id')
      .eq('post_id', postId)
      .eq('user_id', userId)
      .maybeSingle();

    return c.json({
      success: true,
      data: { ...post, is_liked: !!like },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── POST /social/posts/:id/like ────────────────────────────────────────────
// Toggle like on a post.
social.post('/posts/:id/like', async (c) => {
  try {
    const userId = c.get('userId');
    const postId = c.req.param('id');

    // Check if already liked
    const { data: existing } = await supabaseAdmin
      .from('post_likes')
      .select('id')
      .eq('post_id', postId)
      .eq('user_id', userId)
      .maybeSingle();

    if (existing) {
      // Unlike: remove the like and decrement count
      await supabaseAdmin.from('post_likes').delete().eq('id', existing.id);

      // Decrement likes_count
      const { data: post } = await supabaseAdmin
        .from('social_posts')
        .select('likes_count')
        .eq('id', postId)
        .single();

      if (post) {
        await supabaseAdmin
          .from('social_posts')
          .update({ likes_count: Math.max(0, (post.likes_count ?? 1) - 1) })
          .eq('id', postId);
      }

      return c.json({ success: true, data: { liked: false } });
    } else {
      // Like: add the like and increment count
      await supabaseAdmin.from('post_likes').insert({
        id: uuidv4(),
        post_id: postId,
        user_id: userId,
      });

      // Increment likes_count
      const { data: post } = await supabaseAdmin
        .from('social_posts')
        .select('likes_count, user_id')
        .eq('id', postId)
        .single();

      if (post) {
        await supabaseAdmin
          .from('social_posts')
          .update({ likes_count: (post.likes_count ?? 0) + 1 })
          .eq('id', postId);

        // Notify post author (if not self)
        if (post.user_id !== userId) {
          const { data: liker } = await supabaseAdmin
            .from('user_profiles')
            .select('full_name')
            .eq('id', userId)
            .single();

          await supabaseAdmin.from('notifications').insert({
            id: uuidv4(),
            user_id: post.user_id,
            type: 'like',
            title: `${liker?.full_name ?? 'Someone'} liked your outfit`,
            body: '',
            data: { post_id: postId },
            read: false,
          });
        }
      }

      return c.json({ success: true, data: { liked: true } });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Like Error]:', err);
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── GET /social/posts/:id/comments ─────────────────────────────────────────
// Get comments for a post (paginated).
social.get('/posts/:id/comments', async (c) => {
  try {
    const postId = c.req.param('id');
    const page = parseInt(c.req.query('page') ?? '1', 10);
    const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 100);
    const offset = (page - 1) * limit;

    const { data, error, count } = await supabaseAdmin
      .from('post_comments')
      .select('*, user:user_profiles!user_id(full_name, avatar_url)', { count: 'exact' })
      .eq('post_id', postId)
      .order('created_at', { ascending: true })
      .range(offset, offset + limit - 1);

    if (error) {
      return c.json({ success: false, error: error.message }, 500);
    }

    return c.json({
      success: true,
      data: data ?? [],
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

// ─── POST /social/posts/:id/comments ────────────────────────────────────────
// Add comment to a post.
social.post('/posts/:id/comments', async (c) => {
  try {
    const userId = c.get('userId');
    const postId = c.req.param('id');
    const body = await c.req.json<{ content: string }>();

    if (!body.content?.trim()) {
      return c.json({ success: false, error: 'content is required' }, 400);
    }

    if (body.content.length > 500) {
      return c.json({ success: false, error: 'Comment must be 500 characters or less' }, 400);
    }

    // Sanitize: strip HTML tags
    const sanitizedContent = body.content.trim().replace(/<[^>]*>/g, '');

    const { data: comment, error } = await supabaseAdmin
      .from('post_comments')
      .insert({
        id: uuidv4(),
        post_id: postId,
        user_id: userId,
        content: sanitizedContent,
      })
      .select('*, user:user_profiles!user_id(full_name, avatar_url)')
      .single();

    if (error) {
      return c.json({ success: false, error: error.message }, 500);
    }

    // Increment comments_count on the post
    const { data: post } = await supabaseAdmin
      .from('social_posts')
      .select('comments_count, user_id')
      .eq('id', postId)
      .single();

    if (post) {
      await supabaseAdmin
        .from('social_posts')
        .update({ comments_count: (post.comments_count ?? 0) + 1 })
        .eq('id', postId);

      // Notify post author (if not self)
      if (post.user_id !== userId) {
        const { data: commenter } = await supabaseAdmin
          .from('user_profiles')
          .select('full_name')
          .eq('id', userId)
          .single();

        await supabaseAdmin.from('notifications').insert({
          id: uuidv4(),
          user_id: post.user_id,
          type: 'comment',
          title: `${commenter?.full_name ?? 'Someone'} commented on your outfit`,
          body: body.content.trim().substring(0, 100),
          data: { post_id: postId, comment_id: comment.id },
          read: false,
        });
      }
    }

    return c.json({ success: true, data: comment }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Comment Error]:', err);
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── DELETE /social/posts/:id ───────────────────────────────────────────────
// Delete own post (cascades to likes and comments).
social.delete('/posts/:id', async (c) => {
  try {
    const userId = c.get('userId');
    const postId = c.req.param('id');

    // Verify ownership
    const { data: post } = await supabaseAdmin
      .from('social_posts')
      .select('id, user_id')
      .eq('id', postId)
      .single();

    if (!post) {
      return c.json({ success: false, error: 'Post not found' }, 404);
    }

    if (post.user_id !== userId) {
      return c.json({ success: false, error: 'You can only delete your own posts' }, 403);
    }

    // Delete associated data first
    await supabaseAdmin.from('post_comments').delete().eq('post_id', postId);
    await supabaseAdmin.from('post_likes').delete().eq('post_id', postId);

    // Delete the post
    const { error } = await supabaseAdmin
      .from('social_posts')
      .delete()
      .eq('id', postId);

    if (error) {
      return c.json({ success: false, error: error.message }, 500);
    }

    return c.json({ success: true, data: { message: 'Post deleted successfully' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── POST /social/stories ───────────────────────────────────────────────────
// Create a story (expires after 24 hours).
social.post('/stories', async (c) => {
  try {
    const userId = c.get('userId');
    const body = await c.req.json<{
      image_url: string;
      caption?: string;
      outfit_data?: Record<string, unknown>;
    }>();

    if (!body.image_url) {
      return c.json({ success: false, error: 'image_url is required' }, 400);
    }

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    const { data: story, error } = await supabaseAdmin
      .from('stories')
      .insert({
        id: uuidv4(),
        user_id: userId,
        image_url: body.image_url,
        caption: body.caption ?? null,
        outfit_data: body.outfit_data ?? null,
        views_count: 0,
        expires_at: expiresAt.toISOString(),
      })
      .select('*, user:user_profiles!user_id(full_name, avatar_url)')
      .single();

    if (error) {
      return c.json({ success: false, error: error.message }, 500);
    }

    return c.json({ success: true, data: story }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Create Story Error]:', err);
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── GET /social/stories ────────────────────────────────────────────────────
// Get active stories from friends (grouped by user).
social.get('/stories', async (c) => {
  try {
    const userId = c.get('userId');

    const friendIds = await getFriendIds(userId);
    const allIds = [userId, ...friendIds];

    // Get active (non-expired) stories
    const { data: stories, error } = await supabaseAdmin
      .from('stories')
      .select('*, user:user_profiles!user_id(full_name, avatar_url)')
      .in('user_id', allIds)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });

    if (error) {
      return c.json({ success: false, error: error.message }, 500);
    }

    // Check which stories the user has viewed
    const storyIds = (stories ?? []).map((s) => s.id);
    let viewedIds = new Set<string>();

    if (storyIds.length > 0) {
      const { data: views } = await supabaseAdmin
        .from('story_views')
        .select('story_id')
        .eq('user_id', userId)
        .in('story_id', storyIds);

      viewedIds = new Set((views ?? []).map((v) => v.story_id));
    }

    // Group by user
    const grouped: Record<string, {
      user_id: string;
      user: { name: string; avatar_url: string | null };
      stories: Array<Record<string, unknown>>;
      has_unviewed: boolean;
    }> = {};

    for (const story of stories ?? []) {
      const uid = story.user_id;
      if (!grouped[uid]) {
        grouped[uid] = {
          user_id: uid,
          user: story.user,
          stories: [],
          has_unviewed: false,
        };
      }
      const isViewed = viewedIds.has(story.id);
      grouped[uid]!.stories.push({ ...story, is_viewed: isViewed });
      if (!isViewed) grouped[uid]!.has_unviewed = true;
    }

    // Sort: own stories first, then unviewed, then viewed
    const sorted = Object.values(grouped).sort((a, b) => {
      if (a.user_id === userId) return -1;
      if (b.user_id === userId) return 1;
      if (a.has_unviewed && !b.has_unviewed) return -1;
      if (!a.has_unviewed && b.has_unviewed) return 1;
      return 0;
    });

    return c.json({ success: true, data: sorted });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Stories Error]:', err);
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── POST /social/stories/:id/view ──────────────────────────────────────────
// Mark story as viewed.
social.post('/stories/:id/view', async (c) => {
  try {
    const userId = c.get('userId');
    const storyId = c.req.param('id');

    // Upsert view (ignore duplicate)
    await supabaseAdmin
      .from('story_views')
      .upsert(
        { story_id: storyId, user_id: userId },
        { onConflict: 'story_id,user_id' }
      );

    // Increment views_count on the story
    const { data: story } = await supabaseAdmin
      .from('stories')
      .select('views_count')
      .eq('id', storyId)
      .single();

    if (story) {
      await supabaseAdmin
        .from('stories')
        .update({ views_count: (story.views_count ?? 0) + 1 })
        .eq('id', storyId);
    }

    return c.json({ success: true, data: { message: 'Story viewed' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── GET /social/rankings ───────────────────────────────────────────────────
// Get outfit ratings rankings (friends leaderboard).
social.get('/rankings', async (c) => {
  try {
    const userId = c.get('userId');

    const friendIds = await getFriendIds(userId);
    const allIds = [userId, ...friendIds];

    // For each user, calculate average outfit score from daily_outfits
    const { data: profiles } = await supabaseAdmin
      .from('user_profiles')
      .select('id, full_name, avatar_url')
      .in('id', allIds);

    if (!profiles || profiles.length === 0) {
      return c.json({ success: true, data: [] });
    }

    // Get scored outfits for all relevant users
    const { data: allOutfits } = await supabaseAdmin
      .from('daily_outfits')
      .select('user_id, score')
      .in('user_id', allIds)
      .not('score', 'is', null);

    // Calculate per-user stats
    const userStats: Record<string, { totalScore: number; count: number }> = {};
    for (const outfit of allOutfits ?? []) {
      if (!userStats[outfit.user_id]) {
        userStats[outfit.user_id] = { totalScore: 0, count: 0 };
      }
      userStats[outfit.user_id]!.totalScore += outfit.score ?? 0;
      userStats[outfit.user_id]!.count += 1;
    }

    // Get streak data
    const { data: streakData } = await supabaseAdmin
      .from('daily_outfits')
      .select('user_id, date')
      .in('user_id', allIds)
      .order('date', { ascending: false });

    // Calculate streaks per user
    const userStreaks: Record<string, number> = {};
    const streaksByUser: Record<string, string[]> = {};
    for (const entry of streakData ?? []) {
      if (!streaksByUser[entry.user_id]) {
        streaksByUser[entry.user_id] = [];
      }
      streaksByUser[entry.user_id]!.push(entry.date);
    }

    for (const [uid, dates] of Object.entries(streaksByUser)) {
      let streak = 0;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      let checkDate = new Date(today);

      for (const dateStr of dates) {
        const entryDate = new Date(dateStr);
        entryDate.setHours(0, 0, 0, 0);
        if (entryDate.getTime() === checkDate.getTime()) {
          streak++;
          checkDate.setDate(checkDate.getDate() - 1);
        } else if (streak === 0 && entryDate.getTime() === checkDate.getTime() - 86400000) {
          checkDate.setDate(checkDate.getDate() - 1);
          if (entryDate.getTime() === checkDate.getTime()) {
            streak++;
            checkDate.setDate(checkDate.getDate() - 1);
          } else {
            break;
          }
        } else {
          break;
        }
      }
      userStreaks[uid] = streak;
    }

    // Build rankings
    const rankings = profiles
      .map((profile) => {
        const stats = userStats[profile.id];
        const avgScore = stats && stats.count > 0
          ? Math.round((stats.totalScore / stats.count) * 10) / 10
          : 0;

        return {
          user_id: profile.id,
          name: profile.full_name,
          avatar_url: profile.avatar_url,
          average_score: avgScore,
          outfits_rated: stats?.count ?? 0,
          streak: userStreaks[profile.id] ?? 0,
          is_current_user: profile.id === userId,
        };
      })
      .sort((a, b) => b.average_score - a.average_score)
      .map((entry, index) => ({ rank: index + 1, ...entry }));

    return c.json({ success: true, data: rankings });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

export { social as socialRoutes };
