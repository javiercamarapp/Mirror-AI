import { Hono } from 'hono';
import { supabaseAdmin } from '../services/supabase.js';
import { authMiddleware } from '../middleware/auth.js';
import { getRedisClient } from '../services/redis.js';
import { logger } from '../services/logger.js';
import type { AppVariables } from '../types/index.js';

const auth = new Hono<{ Variables: AppVariables }>();

// Rate limiting for /auth/ routes is handled by the global rate limiter middleware
// in index.ts (10 requests per 15 minutes for /api/auth/ paths).

// ─── Per-user/per-email rate limiting on auth endpoints (10 req/hour) ────────
const authRateLimitMap = new Map<string, { count: number; resetAt: number }>();

async function checkAuthRateLimit(identifier: string): Promise<{ allowed: boolean; retryAfter: number }> {
  const windowMs = 3_600_000; // 1 hour
  const limit = 10;
  const now = Date.now();

  // Try Redis first
  const redis = getRedisClient();
  if (redis) {
    try {
      const key = `rl:auth:${identifier}`;
      const windowStart = now - windowMs;
      const member = `${now}:${Math.random().toString(36).slice(2, 8)}`;

      const pipeline = redis.pipeline();
      pipeline.zremrangebyscore(key, 0, windowStart);
      pipeline.zadd(key, now, member);
      pipeline.zcard(key);
      pipeline.pexpire(key, windowMs);

      const results = await pipeline.exec();
      const count = (results?.[2]?.[1] as number) ?? 0;
      const retryAfter = Math.ceil(windowMs / 1000);
      return { allowed: count <= limit, retryAfter };
    } catch {
      // Fall through to in-memory
    }
  }

  // In-memory fallback
  const entry = authRateLimitMap.get(identifier);
  if (!entry || now > entry.resetAt) {
    authRateLimitMap.set(identifier, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfter: 0 };
  }
  entry.count++;
  const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
  return { allowed: entry.count <= limit, retryAfter };
}

// Periodic cleanup of expired in-memory auth rate limit entries
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of authRateLimitMap) {
    if (now > entry.resetAt) authRateLimitMap.delete(key);
  }
}, 60_000);

// ─── Token format validation ─────────────────────────────────────────────────
function isValidJWTFormat(token: string): boolean {
  // JWTs have 3 base64url-encoded segments separated by dots
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  // Each part should be valid base64url (alphanumeric, -, _, =)
  const base64urlRegex = /^[A-Za-z0-9_-]+=*$/;
  return parts.every((part) => part.length > 0 && base64urlRegex.test(part));
}

// ─── Dedicated rate limit for token refresh (5 req/hour per user) ────────────
const refreshRateLimitMap = new Map<string, { count: number; resetAt: number }>();

async function checkRefreshRateLimit(identifier: string): Promise<{ allowed: boolean; retryAfter: number }> {
  const windowMs = 3_600_000; // 1 hour
  const limit = 5;
  const now = Date.now();

  // Try Redis first
  const redis = getRedisClient();
  if (redis) {
    try {
      const key = `rl:refresh:${identifier}`;
      const windowStart = now - windowMs;
      const member = `${now}:${Math.random().toString(36).slice(2, 8)}`;

      const pipeline = redis.pipeline();
      pipeline.zremrangebyscore(key, 0, windowStart);
      pipeline.zadd(key, now, member);
      pipeline.zcard(key);
      pipeline.pexpire(key, windowMs);

      const results = await pipeline.exec();
      const count = (results?.[2]?.[1] as number) ?? 0;
      const retryAfter = Math.ceil(windowMs / 1000);
      return { allowed: count <= limit, retryAfter };
    } catch {
      // Fall through to in-memory
    }
  }

  // In-memory fallback
  const entry = refreshRateLimitMap.get(identifier);
  if (!entry || now > entry.resetAt) {
    refreshRateLimitMap.set(identifier, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfter: 0 };
  }
  entry.count++;
  const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
  return { allowed: entry.count <= limit, retryAfter };
}

// Periodic cleanup of expired in-memory refresh rate limit entries
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of refreshRateLimitMap) {
    if (now > entry.resetAt) refreshRateLimitMap.delete(key);
  }
}, 60_000);

// ─── POST /auth/apple ─────────────────────────────────────────────────────────
// Sign in with Apple ID token.
auth.post('/apple', async (c) => {
  try {
    const body = await c.req.json<{ id_token: string; full_name?: string }>();

    if (!body.id_token) {
      return c.json({ success: false, error: 'id_token is required' }, 400);
    }

    // Size limits: id_token max 10KB, full_name max 200 chars
    if (body.id_token.length > 10240) {
      return c.json({ success: false, error: 'id_token exceeds maximum allowed size' }, 400);
    }
    if (body.full_name && body.full_name.length > 200) {
      return c.json({ success: false, error: 'full_name must be 200 characters or less' }, 400);
    }

    // Validate token format before sending to Supabase
    if (!isValidJWTFormat(body.id_token)) {
      return c.json({ success: false, error: 'Invalid id_token format' }, 400);
    }

    // Per-user rate limit: extract email-like identifier from JWT payload for keying
    try {
      const payloadB64 = body.id_token.split('.')[1] ?? '';
      const payloadJson = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
      const identifier = payloadJson.email ?? payloadJson.sub ?? 'unknown';
      const rl = await checkAuthRateLimit(`apple:${identifier}`);
      if (!rl.allowed) {
        c.header('Retry-After', String(rl.retryAfter));
        return c.json({ success: false, error: 'Too many authentication attempts. Please try again later.' }, 429);
      }
    } catch {
      // If we can't parse the token for rate limiting, still allow through (format was validated above)
    }

    const { data: sessionData, error: signInError } =
      await supabaseAdmin.auth.signInWithIdToken({
        provider: 'apple',
        token: body.id_token,
      });

    if (signInError || !sessionData.user || !sessionData.session) {
      return c.json(
        { success: false, error: signInError?.message ?? 'Failed to sign in with Apple' },
        401
      );
    }

    const user = sessionData.user;
    const session = sessionData.session;

    // Check if profile already exists
    const { data: existingProfile } = await supabaseAdmin
      .from('user_profiles')
      .select('id')
      .eq('id', user.id)
      .single();

    const isNewUser = !existingProfile;

    if (isNewUser) {
      await supabaseAdmin.from('user_profiles').insert({
        id: user.id,
        email: user.email ?? '',
        full_name: body.full_name ?? user.user_metadata?.full_name ?? user.email?.split('@')[0] ?? 'User',
        avatar_url: user.user_metadata?.avatar_url ?? null,
        style_preferences: [],
        subscription_plan: 'free',
        onboarding_completed: false,
        vton_credits: 3,
      });
    } else if (body.full_name) {
      // Update name if provided on existing user
      await supabaseAdmin
        .from('user_profiles')
        .update({ full_name: body.full_name })
        .eq('id', user.id);
    }

    return c.json({
      success: true,
      data: {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_at: session.expires_at,
        user: {
          id: user.id,
          email: user.email,
          name: body.full_name ?? user.user_metadata?.full_name ?? null,
        },
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── POST /auth/google ────────────────────────────────────────────────────────
// Sign in with Google ID token.
auth.post('/google', async (c) => {
  try {
    const body = await c.req.json<{ id_token: string }>();

    if (!body.id_token) {
      return c.json({ success: false, error: 'id_token is required' }, 400);
    }

    // Size limit: id_token max 10KB
    if (body.id_token.length > 10240) {
      return c.json({ success: false, error: 'id_token exceeds maximum allowed size' }, 400);
    }

    // Validate token format before sending to Supabase
    if (!isValidJWTFormat(body.id_token)) {
      return c.json({ success: false, error: 'Invalid id_token format' }, 400);
    }

    // Per-user rate limit: extract email-like identifier from JWT payload for keying
    try {
      const payloadB64 = body.id_token.split('.')[1] ?? '';
      const payloadJson = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
      const identifier = payloadJson.email ?? payloadJson.sub ?? 'unknown';
      const rl = await checkAuthRateLimit(`google:${identifier}`);
      if (!rl.allowed) {
        c.header('Retry-After', String(rl.retryAfter));
        return c.json({ success: false, error: 'Too many authentication attempts. Please try again later.' }, 429);
      }
    } catch {
      // If we can't parse the token for rate limiting, still allow through (format was validated above)
    }

    const { data: sessionData, error: signInError } =
      await supabaseAdmin.auth.signInWithIdToken({
        provider: 'google',
        token: body.id_token,
      });

    if (signInError || !sessionData.user || !sessionData.session) {
      return c.json(
        { success: false, error: signInError?.message ?? 'Failed to sign in with Google' },
        401
      );
    }

    const user = sessionData.user;
    const session = sessionData.session;

    // Ensure profile exists
    const { data: existingProfile } = await supabaseAdmin
      .from('user_profiles')
      .select('id')
      .eq('id', user.id)
      .single();

    if (!existingProfile) {
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
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_at: session.expires_at,
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

// ─── POST /auth/magic-link ───────────────────────────────────────────────────
// Send a magic link to the user's email.
auth.post('/magic-link', async (c) => {
  try {
    const body = await c.req.json<{ email: string }>();

    if (!body.email) {
      return c.json({ success: false, error: 'email is required' }, 400);
    }

    // Per-email rate limit: 10 attempts per hour
    const mlRl = await checkAuthRateLimit(`magic-link:${body.email.toLowerCase().trim()}`);
    if (!mlRl.allowed) {
      c.header('Retry-After', String(mlRl.retryAfter));
      return c.json({ success: false, error: 'Too many magic link requests. Please try again later.' }, 429);
    }

    const { error } = await supabaseAdmin.auth.signInWithOtp({
      email: body.email,
    });

    if (error) {
      return c.json({ success: false, error: error.message }, 400);
    }

    return c.json({
      success: true,
      data: { message: 'Magic link sent to your email' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

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

    // Input length validation
    if (body.name.length > 200) {
      return c.json({ success: false, error: 'name must be 200 characters or less' }, 400);
    }

    // Per-email rate limit: 10 attempts per hour
    const suRl = await checkAuthRateLimit(`signup:${body.email.toLowerCase().trim()}`);
    if (!suRl.allowed) {
      c.header('Retry-After', String(suRl.retryAfter));
      return c.json({ success: false, error: 'Too many signup attempts. Please try again later.' }, 429);
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
// Stricter rate limit: 5 requests per hour per user/IP.
auth.post('/refresh', async (c) => {
  try {
    const { refresh_token } = await c.req.json<{ refresh_token: string }>();

    if (!refresh_token) {
      return c.json({ success: false, error: 'refresh_token is required' }, 400);
    }

    // Validate refresh token format (should be a valid JWT or opaque token, max 4KB)
    if (refresh_token.length > 4096) {
      return c.json({ success: false, error: 'refresh_token exceeds maximum allowed size' }, 400);
    }

    // Dedicated per-user rate limit for token refresh (5 req/hour)
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const rateLimitResult = await checkRefreshRateLimit(ip);

    if (!rateLimitResult.allowed) {
      c.header('Retry-After', String(rateLimitResult.retryAfter));
      return c.json(
        { success: false, error: 'Token refresh rate limit exceeded. Please try again later.' },
        429
      );
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
