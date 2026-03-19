import { Hono } from 'hono';
import { supabaseAdmin } from '../services/supabase.js';
import { authMiddleware } from '../middleware/auth.js';
import { validateBody, schemas } from '../middleware/validate.js';
import { tryOn } from '../services/fashn.js';
import { uploadImage } from '../services/storage.js';
import { logger } from '../services/logger.js';
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
// Supports X-Idempotency-Key header for safe retries.
vton.post('/generate', validateBody(schemas.vtonGenerate), async (c) => {
  try {
    const userId = c.get('userId');
    const idempotencyKey = c.req.header('X-Idempotency-Key') ?? null;
    const body = c.get('validatedBody') as {
      garment_image_url: string;
      category: 'tops' | 'bottoms' | 'one-pieces';
    };

    // Idempotency: if this request was already processed, return the cached result
    if (idempotencyKey) {
      const { data: existingUsage } = await supabaseAdmin
        .from('vton_usage')
        .select('result_image_url')
        .eq('request_id', idempotencyKey)
        .eq('user_id', userId)
        .maybeSingle();

      if (existingUsage) {
        const { data: profile } = await supabaseAdmin
          .from('user_profiles')
          .select('vton_credits')
          .eq('id', userId)
          .single();

        return c.json({
          success: true,
          data: {
            result_image_url: existingUsage.result_image_url,
            credits_remaining: profile?.vton_credits ?? 0,
            idempotent_replay: true,
          },
        });
      }
    }

    // Check user credits and get body photo
    const { data: profile } = await supabaseAdmin
      .from('user_profiles')
      .select('vton_credits, body_photo_url')
      .eq('id', userId)
      .single();

    if (!profile || (profile.vton_credits ?? 0) <= 0) {
      return c.json({
        success: false,
        error: 'No virtual try-on credits remaining. Upgrade your plan for more credits.',
        data: { credits_remaining: 0 },
      }, 403);
    }

    if (!profile?.body_photo_url) {
      return c.json({
        success: false,
        error: 'You need to upload a full body photo first. Go to Settings > Avatar to upload one.',
      }, 400);
    }

    // Decrement credit atomically BEFORE calling external API to prevent over-spending
    const { data: decrementResult, error: creditError } = await supabaseAdmin
      .rpc('decrement_credits', {
        p_user_id: userId,
        p_amount: 1,
        p_request_id: idempotencyKey,
      });

    if (creditError) {
      logger.error({ err: creditError }, 'Credit decrement failed');
      return c.json({ success: false, error: 'Failed to decrement credits. Please retry.' }, 409);
    }

    if (decrementResult === null || decrementResult === undefined || decrementResult < 0) {
      return c.json({ success: false, error: 'Insufficient credits.' }, 403);
    }

    const newCredits = decrementResult as number;

    // Call Fashn.ai for virtual try-on
    let resultUrl: string;
    try {
      resultUrl = await tryOn(
        profile.body_photo_url,
        body.garment_image_url,
        body.category
      );
    } catch (tryOnErr) {
      // Refund the credit on try-on failure
      logger.error({ err: tryOnErr }, 'VTON try-on failed, refunding credit');
      await supabaseAdmin.rpc('increment_credits_atomic', {
        p_user_id: userId,
        p_amount: 1,
        p_request_id: null,
      }).catch((refundErr: unknown) => {
        logger.error({ err: refundErr }, 'Failed to refund credit after try-on failure');
      });
      throw tryOnErr;
    }

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
      logger.warn({ err: storageErr }, 'Failed to persist VTON result to storage, using original URL');
    }

    // Log usage in history (with request_id for idempotency tracking)
    await supabaseAdmin.from('vton_usage').insert({
      id: uuidv4(),
      user_id: userId,
      garment_item_id: null,
      result_image_url: storedUrl,
      credits_used: 1,
      request_id: idempotencyKey,
    });

    return c.json({
      success: true,
      data: {
        result_image_url: storedUrl,
        credits_remaining: newCredits,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error({ err }, 'VTON generation failed');
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── GET /vton/credits ──────────────────────────────────────────────────────
// Get remaining VTON credits.
vton.get('/credits', async (c) => {
  try {
    const userId = c.get('userId');

    const { data: profileData } = await supabaseAdmin
      .from('user_profiles')
      .select('subscription_plan, vton_credits')
      .eq('id', userId)
      .single();

    const plan = profileData?.subscription_plan ?? 'free';
    const maxCredits = CREDITS_BY_PLAN[plan] ?? 3;

    return c.json({
      success: true,
      data: {
        credits_remaining: profileData?.vton_credits ?? 0,
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
      .from('vton_usage')
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
