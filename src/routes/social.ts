import { Hono } from 'hono';
import { supabaseAdmin } from '../services/supabase.js';
import { authMiddleware } from '../middleware/auth.js';
import { moderationMiddleware } from '../middleware/moderation.js';
import { sendPushNotification } from '../services/pushNotifications.js';
import { processReports } from '../services/contentModeration.js';
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

    // Get blocked user IDs (both directions)
    const { data: blocks } = await supabaseAdmin
      .from('friendships')
      .select('requester_id, addressee_id')
      .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
      .eq('status', 'blocked');

    const blockedIds = new Set(
      (blocks ?? []).map((b) =>
        b.requester_id === userId ? b.addressee_id : b.requester_id
      )
    );

    // Filter out blocked users from feed
    const filteredIds = allIds.filter((id) => !blockedIds.has(id));

    const { data: posts, error, count } = await supabaseAdmin
      .from('social_posts')
      .select('*, user:user_profiles!user_id(full_name, avatar_url)', { count: 'exact' })
      .in('user_id', filteredIds)
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
// Create post (outfit share). Content moderation is applied to text fields.
social.post('/posts', moderationMiddleware, async (c) => {
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

          const likerName = liker?.full_name ?? 'Someone';

          await supabaseAdmin.from('notifications').insert({
            id: uuidv4(),
            user_id: post.user_id,
            type: 'like',
            title: `${likerName} liked your outfit`,
            body: '',
            data: { post_id: postId },
            read: false,
          });

          // Send push notification (block check happens inside sendPushNotification)
          sendPushNotification(
            post.user_id,
            `${likerName} liked your outfit`,
            'Check it out!',
            { type: 'like', post_id: postId }
          ).catch(() => {});
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
// Add comment to a post. Content moderation is applied to text fields.
social.post('/posts/:id/comments', moderationMiddleware, async (c) => {
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

        const commenterName = commenter?.full_name ?? 'Someone';
        const commentPreview = body.content.trim().substring(0, 100);

        await supabaseAdmin.from('notifications').insert({
          id: uuidv4(),
          user_id: post.user_id,
          type: 'comment',
          title: `${commenterName} commented on your outfit`,
          body: commentPreview,
          data: { post_id: postId, comment_id: comment.id },
          read: false,
        });

        // Send push notification (block check happens inside sendPushNotification)
        sendPushNotification(
          post.user_id,
          `${commenterName} commented on your outfit`,
          commentPreview,
          { type: 'comment', post_id: postId, comment_id: comment.id }
        ).catch(() => {});
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

    // Get blocked user IDs (both directions)
    const { data: blocks } = await supabaseAdmin
      .from('friendships')
      .select('requester_id, addressee_id')
      .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
      .eq('status', 'blocked');

    const blockedIds = new Set(
      (blocks ?? []).map((b) =>
        b.requester_id === userId ? b.addressee_id : b.requester_id
      )
    );

    // Filter out blocked users from stories
    const filteredIds = allIds.filter((id) => !blockedIds.has(id));

    // Get active (non-expired) stories
    const { data: stories, error } = await supabaseAdmin
      .from('stories')
      .select('*, user:user_profiles!user_id(full_name, avatar_url)')
      .in('user_id', filteredIds)
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

    // Get blocked user IDs (both directions)
    const { data: blocks } = await supabaseAdmin
      .from('friendships')
      .select('requester_id, addressee_id')
      .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
      .eq('status', 'blocked');

    const blockedIds = new Set(
      (blocks ?? []).map((b) =>
        b.requester_id === userId ? b.addressee_id : b.requester_id
      )
    );

    // Filter out blocked users from rankings
    const filteredIds = allIds.filter((id) => !blockedIds.has(id));

    // For each user, calculate average outfit score from daily_outfits
    const { data: profiles } = await supabaseAdmin
      .from('user_profiles')
      .select('id, full_name, avatar_url')
      .in('id', filteredIds);

    if (!profiles || profiles.length === 0) {
      return c.json({ success: true, data: [] });
    }

    // Get scored outfits for all relevant users
    const { data: allOutfits } = await supabaseAdmin
      .from('daily_outfits')
      .select('user_id, score')
      .in('user_id', filteredIds)
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
      .in('user_id', filteredIds)
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

// ─── POST /social/report ──────────────────────────────────────────────────
// Report content for moderation.
social.post('/report', async (c) => {
  try {
    const userId = c.get('userId');
    const body = await c.req.json<{
      content_type: string;
      content_id: string;
      reason: string;
      description?: string;
    }>();

    if (!body.content_type || !body.content_id || !body.reason) {
      return c.json({ success: false, error: 'content_type, content_id, and reason are required' }, 400);
    }

    const validTypes = ['post', 'comment', 'story', 'user'];
    if (!validTypes.includes(body.content_type)) {
      return c.json({ success: false, error: `content_type must be one of: ${validTypes.join(', ')}` }, 400);
    }

    const { data: report, error } = await supabaseAdmin
      .from('content_reports')
      .insert({
        id: uuidv4(),
        reporter_id: userId,
        content_type: body.content_type,
        content_id: body.content_id,
        reason: body.reason,
        description: body.description ?? null,
        status: 'pending',
      })
      .select()
      .single();

    if (error) {
      return c.json({ success: false, error: error.message }, 500);
    }

    // Process report thresholds (auto-flag, auto-hide, auto-suspend)
    processReports(body.content_type, body.content_id).catch((err) => {
      console.error('[Report] Failed to process report thresholds:', err);
    });

    return c.json({ success: true, data: report }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Report Error]:', err);
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── POST /social/block ──────────────────────────────────────────────────
// Block a user.
social.post('/block', async (c) => {
  try {
    const userId = c.get('userId');
    const body = await c.req.json<{
      blocked_user_id: string;
    }>();

    if (!body.blocked_user_id) {
      return c.json({ success: false, error: 'blocked_user_id is required' }, 400);
    }

    if (body.blocked_user_id === userId) {
      return c.json({ success: false, error: 'You cannot block yourself' }, 400);
    }

    // Remove any existing friendship between the two users
    await supabaseAdmin
      .from('friendships')
      .delete()
      .or(`and(requester_id.eq.${userId},addressee_id.eq.${body.blocked_user_id}),and(requester_id.eq.${body.blocked_user_id},addressee_id.eq.${userId})`);

    // Insert blocked relationship
    const { data: block, error } = await supabaseAdmin
      .from('friendships')
      .insert({
        id: uuidv4(),
        requester_id: userId,
        addressee_id: body.blocked_user_id,
        status: 'blocked',
      })
      .select()
      .single();

    if (error) {
      return c.json({ success: false, error: error.message }, 500);
    }

    return c.json({ success: true, data: { message: 'User blocked successfully' } }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Block Error]:', err);
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── POST /social/posts/:id/hide ─────────────────────────────────────────────
// Hide a post from your feed without reporting.
social.post('/posts/:id/hide', async (c) => {
  try {
    const userId = c.get('userId');
    const postId = c.req.param('id');

    const { error } = await supabaseAdmin
      .from('hidden_posts')
      .upsert(
        { user_id: userId, post_id: postId },
        { onConflict: 'user_id,post_id' }
      );

    if (error) {
      return c.json({ success: false, error: error.message }, 500);
    }

    return c.json({ success: true, data: { message: 'Post hidden from your feed' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── GET /social/posts/:id/share-url ──────────────────────────────────────────
// Generate a shareable deep link for a post.
social.get('/posts/:id/share-url', async (c) => {
  try {
    const postId = c.req.param('id');

    // Verify post exists and is public
    const { data: post, error } = await supabaseAdmin
      .from('social_posts')
      .select('id, is_public, user_id')
      .eq('id', postId)
      .single();

    if (error || !post) {
      return c.json({ success: false, error: 'Post not found' }, 404);
    }

    // Generate deep link URL
    const appScheme = process.env.APP_SCHEME ?? 'mirrorai';
    const webBaseUrl = process.env.WEB_BASE_URL ?? 'https://app.mirrorai.com';

    const deepLink = `${appScheme}://post/${postId}`;
    const webLink = `${webBaseUrl}/post/${postId}`;

    return c.json({
      success: true,
      data: {
        deep_link: deepLink,
        web_link: webLink,
        post_id: postId,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── POST /social/posts/:id/share ─────────────────────────────────────────────
// Track a share event for analytics.
social.post('/posts/:id/share', async (c) => {
  try {
    const userId = c.get('userId');
    const postId = c.req.param('id');
    const body = await c.req.json<{ platform?: string }>().catch(() => ({}));

    // Verify post exists
    const { data: post } = await supabaseAdmin
      .from('social_posts')
      .select('id')
      .eq('id', postId)
      .single();

    if (!post) {
      return c.json({ success: false, error: 'Post not found' }, 404);
    }

    // Record the share event
    const { data: share, error } = await supabaseAdmin
      .from('post_shares')
      .insert({
        id: uuidv4(),
        post_id: postId,
        user_id: userId,
        platform: body.platform ?? null,
      })
      .select()
      .single();

    if (error) {
      return c.json({ success: false, error: error.message }, 500);
    }

    return c.json({ success: true, data: share }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Share Error]:', err);
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── GET /social/admin/reports ─────────────────────────────────────────────────
// List pending content reports with pagination. Admin only.
social.get('/admin/reports', async (c) => {
  try {
    const userId = c.get('userId');

    // Admin check
    const adminIds = process.env.ADMIN_USER_IDS?.split(',').map((id) => id.trim()) ?? [];
    if (!adminIds.includes(userId)) {
      return c.json({ success: false, error: 'Admin access required' }, 403);
    }

    const page = parseInt(c.req.query('page') ?? '1', 10);
    const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10), 100);
    const offset = (page - 1) * limit;
    const status = c.req.query('status') ?? 'pending';

    let query = supabaseAdmin
      .from('content_reports')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status !== 'all') {
      query = query.eq('status', status);
    }

    const { data: reports, error, count } = await query;

    if (error) {
      return c.json({ success: false, error: error.message }, 500);
    }

    return c.json({
      success: true,
      data: reports ?? [],
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

// ─── POST /social/admin/reports/:id/resolve ────────────────────────────────────
// Mark a report as resolved or dismissed. Admin only.
social.post('/admin/reports/:id/resolve', async (c) => {
  try {
    const userId = c.get('userId');

    const adminIds = process.env.ADMIN_USER_IDS?.split(',').map((id) => id.trim()) ?? [];
    if (!adminIds.includes(userId)) {
      return c.json({ success: false, error: 'Admin access required' }, 403);
    }

    const reportId = c.req.param('id');
    const body = await c.req.json<{ resolution: 'dismissed' | 'action_taken' }>();

    if (!body.resolution || !['dismissed', 'action_taken'].includes(body.resolution)) {
      return c.json({ success: false, error: 'resolution must be "dismissed" or "action_taken"' }, 400);
    }

    const { data: report, error } = await supabaseAdmin
      .from('content_reports')
      .update({
        status: body.resolution,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', reportId)
      .eq('status', 'pending')
      .select()
      .single();

    if (error || !report) {
      return c.json({ success: false, error: 'Report not found or already resolved' }, 404);
    }

    return c.json({ success: true, data: report });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── POST /social/admin/reports/:id/action ─────────────────────────────────────
// Take moderation action on the reported user (warn/suspend/ban). Admin only.
social.post('/admin/reports/:id/action', async (c) => {
  try {
    const userId = c.get('userId');

    const adminIds = process.env.ADMIN_USER_IDS?.split(',').map((id) => id.trim()) ?? [];
    if (!adminIds.includes(userId)) {
      return c.json({ success: false, error: 'Admin access required' }, 403);
    }

    const reportId = c.req.param('id');
    const body = await c.req.json<{
      action: 'warn' | 'suspend' | 'ban';
      reason?: string;
      suspend_days?: number;
    }>();

    if (!body.action || !['warn', 'suspend', 'ban'].includes(body.action)) {
      return c.json({ success: false, error: 'action must be "warn", "suspend", or "ban"' }, 400);
    }

    // Get the report to find the reported content and user
    const { data: report } = await supabaseAdmin
      .from('content_reports')
      .select('*')
      .eq('id', reportId)
      .single();

    if (!report) {
      return c.json({ success: false, error: 'Report not found' }, 404);
    }

    // Determine the target user from the report
    let targetUserId: string | null = report.reported_user_id;

    if (!targetUserId) {
      // Look up the content owner
      if (report.content_type === 'post') {
        const { data: post } = await supabaseAdmin
          .from('social_posts')
          .select('user_id')
          .eq('id', report.content_id)
          .single();
        targetUserId = post?.user_id ?? null;
      } else if (report.content_type === 'comment') {
        const { data: comment } = await supabaseAdmin
          .from('post_comments')
          .select('user_id')
          .eq('id', report.content_id)
          .single();
        targetUserId = comment?.user_id ?? null;
      } else if (report.content_type === 'story') {
        const { data: story } = await supabaseAdmin
          .from('stories')
          .select('user_id')
          .eq('id', report.content_id)
          .single();
        targetUserId = story?.user_id ?? null;
      } else if (report.content_type === 'user') {
        targetUserId = report.content_id;
      }
    }

    if (!targetUserId) {
      return c.json({ success: false, error: 'Could not determine the reported user' }, 400);
    }

    // Calculate suspension expiry if applicable
    let expiresAt: string | null = null;
    if (body.action === 'suspend') {
      const days = body.suspend_days ?? 7;
      const expiry = new Date();
      expiry.setDate(expiry.getDate() + days);
      expiresAt = expiry.toISOString();
    }

    // Record the moderation action
    const { error: actionError } = await supabaseAdmin
      .from('moderation_actions')
      .insert({
        id: uuidv4(),
        user_id: targetUserId,
        action: body.action,
        reason: body.reason ?? null,
        admin_id: userId,
        expires_at: expiresAt,
      });

    if (actionError) {
      return c.json({ success: false, error: actionError.message }, 500);
    }

    // Update user moderation status
    const moderationStatus = body.action === 'warn' ? 'warned'
      : body.action === 'suspend' ? 'suspended'
      : 'banned';

    const profileUpdate: Record<string, unknown> = { moderation_status: moderationStatus };
    if (body.action === 'suspend' && expiresAt) {
      profileUpdate.suspension_expires_at = expiresAt;
    }

    await supabaseAdmin
      .from('user_profiles')
      .update(profileUpdate)
      .eq('id', targetUserId);

    // If banning or suspending, hide all their posts
    if (body.action === 'ban' || body.action === 'suspend') {
      await supabaseAdmin
        .from('social_posts')
        .update({ is_public: false })
        .eq('user_id', targetUserId);

      // Expire all their stories
      await supabaseAdmin
        .from('stories')
        .update({ expires_at: new Date().toISOString() })
        .eq('user_id', targetUserId)
        .gt('expires_at', new Date().toISOString());
    }

    // Mark the report as action_taken
    await supabaseAdmin
      .from('content_reports')
      .update({
        status: 'action_taken',
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', reportId);

    return c.json({
      success: true,
      data: {
        action: body.action,
        target_user_id: targetUserId,
        moderation_status: moderationStatus,
        expires_at: expiresAt,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Admin Action Error]:', err);
    return c.json({ success: false, error: message }, 500);
  }
});

export { social as socialRoutes };
