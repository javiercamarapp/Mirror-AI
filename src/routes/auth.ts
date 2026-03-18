import { Hono } from 'hono';
import { supabaseAdmin } from '../services/supabase.js';
import { authMiddleware } from '../middleware/auth.js';
import type { AppVariables } from '../types/index.js';

const auth = new Hono<{ Variables: AppVariables }>();

// Rate limiting for /auth/ routes is handled by the global rate limiter middleware
// in index.ts (10 requests per 15 minutes for /api/auth/ paths).

// ─── POST /auth/signup ────────────────────────────────────────────────────────
// After Supabase Auth signup on the client, this creates the user profile row.
auth.post('/signup', async (c) => {
  try {
    const body = await c.req.json<{
      id: string;
      email: string;
      name: string;
      avatar_url?: string;
    }>();

    if (!body.id || !body.email || !body.name) {
      return c.json({ success: false, error: 'id, email, and name are required' }, 400);
    }

    const { data: existing } = await supabaseAdmin
      .from('user_profiles')
      .select('id')
      .eq('id', body.id)
      .single();

    if (existing) {
      return c.json({ success: true, data: { message: 'Profile already exists' } });
    }

    const { data, error } = await supabaseAdmin
      .from('user_profiles')
      .insert({
        id: body.id,
        email: body.email,
        full_name: body.name,
        avatar_url: body.avatar_url ?? null,
        style_preferences: [],
        subscription_plan: 'free',
        onboarding_completed: false,
        vton_credits: 3,
      })
      .select()
      .single();

    if (error) {
      return c.json({ success: false, error: error.message }, 500);
    }

    return c.json({ success: true, data }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── POST /auth/callback ─────────────────────────────────────────────────────
// Handle OAuth callback — exchange code for session, ensure profile exists.
auth.post('/callback', async (c) => {
  try {
    const { code } = await c.req.json<{ code: string }>();

    if (!code) {
      return c.json({ success: false, error: 'Authorization code is required' }, 400);
    }

    const { data: sessionData, error: exchangeError } =
      await supabaseAdmin.auth.exchangeCodeForSession(code);

    if (exchangeError || !sessionData.user) {
      return c.json(
        { success: false, error: exchangeError?.message ?? 'Failed to exchange code' },
        401
      );
    }

    const user = sessionData.user;

    // Ensure profile exists
    const { data: profile } = await supabaseAdmin
      .from('user_profiles')
      .select('id')
      .eq('id', user.id)
      .single();

    if (!profile) {
      await supabaseAdmin.from('user_profiles').insert({
        id: user.id,
        email: user.email ?? '',
        full_name: user.user_metadata?.full_name ?? user.email?.split('@')[0] ?? 'User',
        avatar_url: user.user_metadata?.avatar_url ?? null,
        style_preferences: [],
        subscription_plan: 'free',
        onboarding_completed: false,
        vton_credits: 3,
      });
    }

    return c.json({
      success: true,
      data: {
        access_token: sessionData.session.access_token,
        refresh_token: sessionData.session.refresh_token,
        expires_at: sessionData.session.expires_at,
        user: {
          id: user.id,
          email: user.email,
          name: user.user_metadata?.full_name ?? null,
        },
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── POST /auth/refresh ──────────────────────────────────────────────────────
// Refresh the access token using a refresh token.
auth.post('/refresh', async (c) => {
  try {
    const { refresh_token } = await c.req.json<{ refresh_token: string }>();

    if (!refresh_token) {
      return c.json({ success: false, error: 'refresh_token is required' }, 400);
    }

    const { data, error } = await supabaseAdmin.auth.refreshSession({
      refresh_token,
    });

    if (error || !data.session) {
      return c.json(
        { success: false, error: error?.message ?? 'Failed to refresh session' },
        401
      );
    }

    return c.json({
      success: true,
      data: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at: data.session.expires_at,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── DELETE /auth/account ────────────────────────────────────────────────────
// Delete user account and all associated data.
auth.delete('/account', authMiddleware, async (c) => {
  try {
    const userId = c.get('userId');

    // Delete user data in order (respecting foreign keys)
    const tables = [
      'story_views',
      'stories',
      'post_comments',
      'post_likes',
      'social_posts',
      'daily_outfits',
      'outfits',
      'vton_usage',
      'avatar_renders',
      'user_avatars',
      'notifications',
      'friendships',
      'wardrobe_items',
      'user_avatar_data',
      'onboarding_data',
      'user_profiles',
    ];

    for (const table of tables) {
      if (table === 'friendships') {
        await supabaseAdmin
          .from(table)
          .delete()
          .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`);
      } else {
        await supabaseAdmin.from(table).delete().eq('user_id', userId);
      }
    }

    // Delete storage files
    const buckets = ['wardrobe', 'avatars', 'outfits', 'social'] as const;
    for (const bucket of buckets) {
      const { data: files } = await supabaseAdmin.storage.from(bucket).list(userId);
      if (files && files.length > 0) {
        const paths = files.map((f) => `${userId}/${f.name}`);
        await supabaseAdmin.storage.from(bucket).remove(paths);
      }
    }

    // Delete the auth user
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) {
      return c.json({ success: false, error: error.message }, 500);
    }

    return c.json({ success: true, data: { message: 'Account deleted successfully' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

export { auth as authRoutes };
