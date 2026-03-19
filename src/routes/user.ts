import { Hono } from 'hono';
import sharp from 'sharp';
import { supabaseAdmin } from '../services/supabase.js';
import { authMiddleware } from '../middleware/auth.js';
import { uploadImage } from '../services/storage.js';
import type { AppVariables } from '../types/index.js';
import { v4 as uuidv4 } from 'uuid';

const user = new Hono<{ Variables: AppVariables }>();

// All user routes require authentication
user.use('*', authMiddleware);

// ─── GET /user/profile ───────────────────────────────────────────────────────
user.get('/profile', async (c) => {
  try {
    const userId = c.get('userId');

    const { data, error } = await supabaseAdmin
      .from('user_profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error || !data) {
      return c.json({ success: false, error: 'Profile not found' }, 404);
    }

    return c.json({ success: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── PATCH /user/profile ─────────────────────────────────────────────────────
user.patch('/profile', async (c) => {
  try {
    const userId = c.get('userId');
    const updates = await c.req.json();

    // Only allow specific fields to be updated
    const allowedFields = [
      'full_name',
      'avatar_url',
      'gender',
      'age_range',
      'body_shape',
      'height',
      'weight',
      'skin_tone',
      'style_preferences',
      'onboarding_completed',
    ];

    const sanitized: Record<string, unknown> = {};
    for (const key of allowedFields) {
      if (key in updates) {
        sanitized[key] = updates[key];
      }
    }

    if (Object.keys(sanitized).length === 0) {
      return c.json({ success: false, error: 'No valid fields to update' }, 400);
    }

    const { data, error } = await supabaseAdmin
      .from('user_profiles')
      .update(sanitized)
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      return c.json({ success: false, error: error.message }, 500);
    }

    return c.json({ success: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── POST /user/onboarding ──────────────────────────────────────────────────
user.post('/onboarding', async (c) => {
  try {
    const userId = c.get('userId');
    const body = await c.req.json<{
      name?: string;
      gender?: string;
      age_range?: string;
      body_shape?: string;
      height?: number;
      weight?: number;
      skin_tone?: string;
      style_preferences?: string[];
      color_season?: string;
    }>();

    const profileUpdate: Record<string, unknown> = {
      onboarding_completed: true,
    };

    if (body.name) profileUpdate.full_name = body.name;
    if (body.gender) profileUpdate.gender = body.gender;
    if (body.age_range) profileUpdate.age_range = body.age_range;
    if (body.body_shape) profileUpdate.body_shape = body.body_shape;
    if (body.height) profileUpdate.height = body.height;
    if (body.weight) profileUpdate.weight = body.weight;
    if (body.skin_tone) profileUpdate.skin_tone = body.skin_tone;
    if (body.style_preferences) profileUpdate.style_preferences = body.style_preferences;
    if (body.color_season) profileUpdate.color_season = body.color_season;

    const { data, error } = await supabaseAdmin
      .from('user_profiles')
      .update(profileUpdate)
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      return c.json({ success: false, error: error.message }, 500);
    }

    return c.json({ success: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── GET /user/subscription ─────────────────────────────────────────────────
user.get('/subscription', async (c) => {
  try {
    const userId = c.get('userId');

    const { data: profile, error } = await supabaseAdmin
      .from('user_profiles')
      .select('subscription_plan, vton_credits')
      .eq('id', userId)
      .single();

    if (error || !profile) {
      return c.json({ success: false, error: 'Profile not found' }, 404);
    }

    const planLimits: Record<string, { wardrobe_limit: number; vton_credits_monthly: number; ai_chats_daily: number }> = {
      free: { wardrobe_limit: 50, vton_credits_monthly: 3, ai_chats_daily: 10 },
      basic: { wardrobe_limit: 200, vton_credits_monthly: 15, ai_chats_daily: 50 },
      premium: { wardrobe_limit: -1, vton_credits_monthly: 50, ai_chats_daily: -1 },
    };

    return c.json({
      success: true,
      data: {
        plan: profile.subscription_plan,
        limits: planLimits[profile.subscription_plan] ?? planLimits.free,
        vton_credits_remaining: profile.vton_credits ?? 0,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── POST /user/avatar ──────────────────────────────────────────────────────
// Upload body photo and/or selfie for the user's avatar / VTON model image.
user.post('/avatar', async (c) => {
  try {
    const userId = c.get('userId');
    const body = await c.req.json<{
      body_photo?: string; // base64
      selfie?: string; // base64
    }>();

    if (!body.body_photo && !body.selfie) {
      return c.json({ success: false, error: 'At least one of body_photo or selfie is required' }, 400);
    }

    const maxBase64Size = 10 * 1024 * 1024 * 4 / 3;
    if (body.body_photo && body.body_photo.length > maxBase64Size) {
      return c.json({ success: false, error: 'Image exceeds maximum size of 10MB' }, 400);
    }
    if (body.selfie && body.selfie.length > maxBase64Size) {
      return c.json({ success: false, error: 'Image exceeds maximum size of 10MB' }, 400);
    }

    const updates: Record<string, string> = {};

    if (body.body_photo) {
      const rawBuffer = Buffer.from(body.body_photo, 'base64');
      // Strip EXIF/GPS metadata and normalize to JPEG
      const buffer = await sharp(rawBuffer)
        .withMetadata(false)
        .jpeg()
        .toBuffer();
      const path = `${userId}/body_${uuidv4()}.jpg`;
      const url = await uploadImage('avatars', path, buffer, 'image/jpeg');
      updates.body_photo_url = url;
    }

    if (body.selfie) {
      const rawBuffer = Buffer.from(body.selfie, 'base64');
      // Strip EXIF/GPS metadata and normalize to JPEG
      const buffer = await sharp(rawBuffer)
        .withMetadata(false)
        .jpeg()
        .toBuffer();
      const path = `${userId}/selfie_${uuidv4()}.jpg`;
      const url = await uploadImage('avatars', path, buffer, 'image/jpeg');
      updates.avatar_url = url;
    }

    const { data, error } = await supabaseAdmin
      .from('user_profiles')
      .update(updates)
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      return c.json({ success: false, error: error.message }, 500);
    }

    return c.json({ success: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── GET /user/stats ────────────────────────────────────────────────────────
user.get('/stats', async (c) => {
  try {
    const userId = c.get('userId');

    // Fetch counts in parallel
    const [wardrobeRes, outfitsRes, streakRes, postsRes] = await Promise.all([
      supabaseAdmin
        .from('wardrobe_items')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId),
      supabaseAdmin
        .from('outfits')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId),
      supabaseAdmin
        .from('daily_outfits')
        .select('date')
        .eq('user_id', userId)
        .order('date', { ascending: false })
        .limit(60),
      supabaseAdmin
        .from('social_posts')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId),
    ]);

    // Calculate streak from daily outfits
    let streak = 0;
    if (streakRes.data && streakRes.data.length > 0) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      let checkDate = new Date(today);

      for (const entry of streakRes.data) {
        const entryDate = new Date(entry.date);
        entryDate.setHours(0, 0, 0, 0);

        if (entryDate.getTime() === checkDate.getTime()) {
          streak++;
          checkDate.setDate(checkDate.getDate() - 1);
        } else if (entryDate.getTime() < checkDate.getTime()) {
          // Allow gap of 1 day (today might not have an outfit yet)
          if (streak === 0) {
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
      }
    }

    // Average outfit score
    const { data: scoredOutfits } = await supabaseAdmin
      .from('daily_outfits')
      .select('score')
      .eq('user_id', userId)
      .not('score', 'is', null);

    let avgScore = 0;
    if (scoredOutfits && scoredOutfits.length > 0) {
      const total = scoredOutfits.reduce((sum, o) => sum + (o.score ?? 0), 0);
      avgScore = Math.round((total / scoredOutfits.length) * 10) / 10;
    }

    return c.json({
      success: true,
      data: {
        wardrobe_count: wardrobeRes.count ?? 0,
        outfits_count: outfitsRes.count ?? 0,
        posts_count: postsRes.count ?? 0,
        streak,
        average_score: avgScore,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── GET /user/notifications ────────────────────────────────────────────────
user.get('/notifications', async (c) => {
  try {
    const userId = c.get('userId');
    const page = parseInt(c.req.query('page') ?? '1', 10);
    const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10), 50);
    const offset = (page - 1) * limit;

    const { data, error, count } = await supabaseAdmin
      .from('notifications')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
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

// ─── PATCH /user/notifications/:id ──────────────────────────────────────────
user.patch('/notifications/:id', async (c) => {
  try {
    const userId = c.get('userId');
    const notificationId = c.req.param('id');

    const { data, error } = await supabaseAdmin
      .from('notifications')
      .update({ read: true })
      .eq('id', notificationId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      return c.json({ success: false, error: 'Notification not found' }, 404);
    }

    return c.json({ success: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── POST /user/notifications/read-all ──────────────────────────────────────
user.post('/notifications/read-all', async (c) => {
  try {
    const userId = c.get('userId');

    const { error } = await supabaseAdmin
      .from('notifications')
      .update({ read: true })
      .eq('user_id', userId)
      .eq('read', false);

    if (error) {
      return c.json({ success: false, error: error.message }, 500);
    }

    return c.json({ success: true, data: { message: 'All notifications marked as read' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── GET /user/notification-preferences ──────────────────────────────────────
user.get('/notification-preferences', async (c) => {
  try {
    const userId = c.get('userId');

    const { data, error } = await supabaseAdmin
      .from('user_profiles')
      .select('notification_preferences')
      .eq('id', userId)
      .single();

    if (error || !data) {
      return c.json({ success: false, error: 'Profile not found' }, 404);
    }

    // Return stored preferences or defaults
    const defaults = {
      likes: true,
      comments: true,
      friend_requests: true,
      new_posts: true,
    };

    const preferences = data.notification_preferences
      ? { ...defaults, ...(data.notification_preferences as Record<string, boolean>) }
      : defaults;

    return c.json({ success: true, data: preferences });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── PUT /user/notification-preferences ─────────────────────────────────────
user.put('/notification-preferences', async (c) => {
  try {
    const userId = c.get('userId');
    const body = await c.req.json<{
      likes?: boolean;
      comments?: boolean;
      friend_requests?: boolean;
      new_posts?: boolean;
    }>();

    // Validate: only allow known boolean preference keys
    const allowedKeys = ['likes', 'comments', 'friend_requests', 'new_posts'];
    const preferences: Record<string, boolean> = {};

    for (const key of allowedKeys) {
      if (key in body) {
        const value = (body as Record<string, unknown>)[key];
        if (typeof value !== 'boolean') {
          return c.json(
            { success: false, error: `Preference "${key}" must be a boolean` },
            400
          );
        }
        preferences[key] = value;
      }
    }

    if (Object.keys(preferences).length === 0) {
      return c.json(
        { success: false, error: 'At least one preference must be provided (likes, comments, friend_requests, new_posts)' },
        400
      );
    }

    // Merge with existing preferences
    const { data: existing } = await supabaseAdmin
      .from('user_profiles')
      .select('notification_preferences')
      .eq('id', userId)
      .single();

    const defaults = { likes: true, comments: true, friend_requests: true, new_posts: true };
    const merged = {
      ...defaults,
      ...((existing?.notification_preferences as Record<string, boolean>) ?? {}),
      ...preferences,
    };

    const { data, error } = await supabaseAdmin
      .from('user_profiles')
      .update({ notification_preferences: merged })
      .eq('id', userId)
      .select('notification_preferences')
      .single();

    if (error) {
      return c.json({ success: false, error: error.message }, 500);
    }

    return c.json({ success: true, data: data?.notification_preferences ?? merged });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── GET /user/export-data ─────────────────────────────────────────────────
// Export all user data (GDPR/CCPA compliance).
user.get('/export-data', async (c) => {
  try {
    const userId = c.get('userId');

    const [
      { data: profile },
      { data: wardrobe },
      { data: outfits },
      { data: posts },
      { data: stories },
      { data: friends },
      { data: notifications },
    ] = await Promise.all([
      supabaseAdmin.from('user_profiles').select('*').eq('id', userId).single(),
      supabaseAdmin.from('wardrobe_items').select('*').eq('user_id', userId),
      supabaseAdmin.from('daily_outfits').select('*').eq('user_id', userId),
      supabaseAdmin.from('social_posts').select('*').eq('user_id', userId),
      supabaseAdmin.from('stories').select('*').eq('user_id', userId),
      supabaseAdmin.from('friendships').select('*').or(`requester_id.eq.${userId},addressee_id.eq.${userId}`),
      supabaseAdmin.from('notifications').select('*').eq('user_id', userId),
    ]);

    return c.json({
      success: true,
      data: {
        exported_at: new Date().toISOString(),
        profile,
        wardrobe_items: wardrobe ?? [],
        daily_outfits: outfits ?? [],
        social_posts: posts ?? [],
        stories: stories ?? [],
        friendships: friends ?? [],
        notifications: notifications ?? [],
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

export { user as userRoutes };
