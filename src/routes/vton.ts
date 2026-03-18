import { Hono } from 'hono';
import { supabaseAdmin } from '../services/supabase.js';
import { authMiddleware } from '../middleware/auth.js';
import { tryOn } from '../services/fashn.js';
import { uploadImage } from '../services/storage.js';
import type { AppVariables } from '../types/index.js';
import { v4 as uuidv4 } from 'uuid';

const vton = new Hono<{ Variables: AppVariables }>();

// All VTON routes require authentication
vton.use('*', authMiddleware);

// Credit limits by plan
const CREDITS_BY_PLAN: Record<string, number> = {
  free: 3,
  basic: 15,
  premium: 50,
};

// ─── POST /vton/generate ────────────────────────────────────────────────────
// Start virtual try-on: uses user's avatar body photo + the garment.
// Checks & decrements VTON credits. Returns the try-on result image URL.
vton.post('/generate', async (c) => {
  try {
    const userId = c.get('userId');
    const body = await c.req.json<{
      garment_image_url: string;
      category: 'tops' | 'bottoms' | 'one-pieces';
    }>();

    if (!body.garment_image_url || !body.category) {
      return c.json({ success: false, error: 'garment_image_url and category are required' }, 400);
    }

    const validCategories = ['tops', 'bottoms', 'one-pieces'];
    if (!validCategories.includes(body.category)) {
      return c.json({ success: false, error: 'category must be one of: tops, bottoms, one-pieces' }, 400);
    }

    // Check user credits
    const { data: credits } = await supabaseAdmin
      .from('vton_credits')
      .select('credits_remaining')
      .eq('user_id', userId)
      .single();

    if (!credits || credits.credits_remaining <= 0) {
      return c.json({
        success: false,
        error: 'No virtual try-on credits remaining. Upgrade your plan for more credits.',
        data: { credits_remaining: 0 },
      }, 403);
    }

    // Get user's body photo
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('body_photo_url')
      .eq('id', userId)
      .single();

    if (!profile?.body_photo_url) {
      return c.json({
        success: false,
        error: 'You need to upload a full body photo first. Go to Settings > Avatar to upload one.',
      }, 400);
    }

    // Call Fashn.ai for virtual try-on
    const resultUrl = await tryOn(
      profile.body_photo_url,
      body.garment_image_url,
      body.category
    );

    // Download result and re-upload to our storage for persistence
    let storedUrl = resultUrl;
    try {
      const response = await fetch(resultUrl);
      if (response.ok) {
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const storagePath = `${userId}/vton_${uuidv4()}.png`;
        storedUrl = await uploadImage('outfits', storagePath, buffer, 'image/png');
      }
    } catch (storageErr) {
      console.error('Failed to persist VTON result to storage, using original URL:', storageErr);
    }

    // Decrement credit
    await supabaseAdmin
      .from('vton_credits')
      .update({ credits_remaining: credits.credits_remaining - 1 })
      .eq('user_id', userId);

    // Log usage in history
    await supabaseAdmin.from('vton_history').insert({
      id: uuidv4(),
      user_id: userId,
      garment_image_url: body.garment_image_url,
      result_image_url: storedUrl,
      category: body.category,
      credits_used: 1,
    });

    return c.json({
      success: true,
      data: {
        result_image_url: storedUrl,
        credits_remaining: credits.credits_remaining - 1,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[VTON Generate Error]:', err);
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── GET /vton/credits ──────────────────────────────────────────────────────
// Get remaining VTON credits.
vton.get('/credits', async (c) => {
  try {
    const userId = c.get('userId');

    const [creditsRes, profileRes] = await Promise.all([
      supabaseAdmin
        .from('vton_credits')
        .select('credits_remaining')
        .eq('user_id', userId)
        .single(),
      supabaseAdmin
        .from('profiles')
        .select('subscription_plan')
        .eq('id', userId)
        .single(),
    ]);

    const plan = profileRes.data?.subscription_plan ?? 'free';
    const maxCredits = CREDITS_BY_PLAN[plan] ?? 3;

    return c.json({
      success: true,
      data: {
        credits_remaining: creditsRes.data?.credits_remaining ?? 0,
        credits_total: maxCredits,
        plan,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── GET /vton/history ──────────────────────────────────────────────────────
// List past VTON results.
vton.get('/history', async (c) => {
  try {
    const userId = c.get('userId');
    const page = parseInt(c.req.query('page') ?? '1', 10);
    const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10), 50);
    const offset = (page - 1) * limit;

    const { data, error, count } = await supabaseAdmin
      .from('vton_history')
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

export { vton as vtonRoutes };
