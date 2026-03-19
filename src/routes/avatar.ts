import { Hono } from 'hono';
import { supabaseAdmin } from '../services/supabase.js';
import { authMiddleware } from '../middleware/auth.js';
import { requireSubscription } from '../middleware/subscription.js';
import { uploadImage, deleteImage, extractPathFromUrl } from '../services/storage.js';
import { tryOn } from '../services/fashn.js';
import { generateImage } from '../services/flux.js';
import { analyzeImageJSON } from '../services/gemini.js';
import { logger } from '../services/logger.js';
import type { AppVariables } from '../types/index.js';
import { v4 as uuidv4 } from 'uuid';

const avatar = new Hono<{ Variables: AppVariables }>();

// All avatar routes require authentication
avatar.use('*', authMiddleware);

// ─── POST /avatar/generate ────────────────────────────────────────────────────
// Generate a stylized full-body avatar from a selfie using Gemini + Flux.
// Requires at least a basic subscription.
avatar.post('/generate', requireSubscription('basic'), async (c) => {
  try {
    const userId = c.get('userId');
    const body = await c.req.json<{
      selfie: string; // base64
      style?: string;
    }>();

    if (!body.selfie) {
      return c.json({ success: false, error: 'selfie (base64) is required' }, 400);
    }

    if (body.selfie.length > 10 * 1024 * 1024 * 4 / 3) {
      return c.json({ success: false, error: 'Image exceeds maximum size of 10MB' }, 400);
    }

    // Use Gemini to analyze facial features from selfie
    let analysis: {
      skin_tone: string;
      hair_style: string;
      hair_color: string;
      face_shape: string;
      body_type: string;
      gender: string;
    } | null = null;

    try {
      analysis = await analyzeImageJSON<{
        skin_tone: string;
        hair_style: string;
        hair_color: string;
        face_shape: string;
        body_type: string;
        gender: string;
      }>(
        body.selfie,
        `Analyze this selfie and return JSON with these fields:
- "skin_tone": the person's skin tone (e.g. "fair", "light", "medium", "olive", "tan", "brown", "dark")
- "hair_style": the person's hair style (e.g. "short straight", "long curly", "medium wavy", "buzz cut", "bald", "braids")
- "hair_color": the person's hair color (e.g. "black", "brown", "blonde", "red", "gray")
- "face_shape": the person's face shape (e.g. "oval", "round", "square", "heart", "oblong")
- "body_type": the person's body type (e.g. "slim", "athletic", "average", "curvy", "plus-size")
- "gender": the person's apparent gender (e.g. "male", "female", "androgynous")

Return ONLY valid JSON.`
      );
    } catch (aiErr) {
      logger.warn({ err: aiErr }, 'AI selfie analysis failed, using defaults');
    }

    // Use Flux to generate a stylized full-body avatar based on the analysis
    const styleDesc = body.style ?? 'modern casual fashion illustration';
    const prompt = `Full-body fashion avatar portrait, ${styleDesc} style. ` +
      `Person with ${analysis?.skin_tone ?? 'medium'} skin tone, ` +
      `${analysis?.hair_style ?? 'medium'} ${analysis?.hair_color ?? 'dark'} hair, ` +
      `${analysis?.face_shape ?? 'oval'} face shape, ` +
      `${analysis?.body_type ?? 'average'} body type, ` +
      `${analysis?.gender ?? 'neutral'} presenting. ` +
      `Standing in a neutral pose against a clean white background. ` +
      `High quality, fashion illustration style.`;

    const avatarImageBuffer = await generateImage(prompt);

    // Upload result to 'avatars' bucket
    const avatarId = uuidv4();
    const avatarPath = `${userId}/avatar_${avatarId}.png`;
    const avatarImageUrl = await uploadImage('avatars', avatarPath, avatarImageBuffer, 'image/png');

    // Also upload the original selfie
    const selfieBuffer = Buffer.from(body.selfie, 'base64');
    const selfiePath = `${userId}/selfie_${avatarId}.jpg`;
    const selfieUrl = await uploadImage('avatars', selfiePath, selfieBuffer, 'image/jpeg');

    // Upsert into user_avatars table
    const avatarData = {
      user_id: userId,
      selfie_url: selfieUrl,
      base_image_url: avatarImageUrl,
      style: body.style ?? 'default',
      skin_tone: analysis?.skin_tone ?? 'medium',
      hair_style: analysis?.hair_style ?? 'unknown',
      body_type: analysis?.body_type ?? 'average',
      updated_at: new Date().toISOString(),
    };

    // Check if avatar already exists for this user
    const { data: existing } = await supabaseAdmin
      .from('user_avatars')
      .select('id')
      .eq('user_id', userId)
      .single();

    let data;
    let error;

    if (existing) {
      const result = await supabaseAdmin
        .from('user_avatars')
        .update(avatarData)
        .eq('user_id', userId)
        .select()
        .single();
      data = result.data;
      error = result.error;
    } else {
      const result = await supabaseAdmin
        .from('user_avatars')
        .insert({ id: uuidv4(), ...avatarData })
        .select()
        .single();
      data = result.data;
      error = result.error;
    }

    if (error) {
      return c.json({ success: false, error: error.message }, 500);
    }

    return c.json({ success: true, data }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error({ err }, 'Avatar generation failed');
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── GET /avatar ──────────────────────────────────────────────────────────────
// Get user's avatar.
avatar.get('/', async (c) => {
  try {
    const userId = c.get('userId');

    const { data: avatarData, error: avatarError } = await supabaseAdmin
      .from('user_avatars')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (avatarError || !avatarData) {
      return c.json({
        success: true,
        data: null,
        message: 'No avatar found. Generate one by uploading a selfie.',
      });
    }

    return c.json({
      success: true,
      data: avatarData,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── PATCH /avatar/customize ──────────────────────────────────────────────────
// Update avatar customizations.
avatar.patch('/customize', async (c) => {
  try {
    const userId = c.get('userId');
    const updates = await c.req.json();

    const allowedFields = ['style', 'hair_style', 'skin_tone', 'body_type', 'customizations'];

    const sanitized: Record<string, unknown> = {};
    for (const key of allowedFields) {
      if (key in updates) {
        sanitized[key] = updates[key];
      }
    }

    if (Object.keys(sanitized).length === 0) {
      return c.json({ success: false, error: 'No valid fields to update' }, 400);
    }

    sanitized.updated_at = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from('user_avatars')
      .update(sanitized)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      return c.json({ success: false, error: 'Avatar not found or update failed' }, 404);
    }

    return c.json({ success: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── POST /avatar/try-outfit ──────────────────────────────────────────────────
// Render avatar wearing wardrobe items using virtual try-on.
avatar.post('/try-outfit', async (c) => {
  try {
    const userId = c.get('userId');
    const body = await c.req.json<{
      item_ids: string[];
    }>();

    if (!body.item_ids || body.item_ids.length === 0) {
      return c.json({ success: false, error: 'item_ids array is required' }, 400);
    }

    // Check VTON credits
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('vton_credits')
      .eq('id', userId)
      .single();

    if (profileError || !profile) {
      return c.json({ success: false, error: 'Profile not found' }, 404);
    }

    if ((profile.vton_credits ?? 0) <= 0) {
      return c.json({
        success: false,
        error: 'No virtual try-on credits remaining. Upgrade your plan or purchase credits.',
        data: { credits_remaining: 0 },
      }, 403);
    }

    // Get user's avatar base_image_url
    const { data: userAvatar, error: avatarError } = await supabaseAdmin
      .from('user_avatars')
      .select('base_image_url')
      .eq('user_id', userId)
      .single();

    if (avatarError || !userAvatar || !userAvatar.base_image_url) {
      return c.json({
        success: false,
        error: 'No avatar found. Generate an avatar first before trying on outfits.',
      }, 400);
    }

    // Get garment images from wardrobe_items
    const { data: items, error: itemsError } = await supabaseAdmin
      .from('wardrobe_items')
      .select('id, category, image_url, image_no_bg_url')
      .eq('user_id', userId)
      .in('id', body.item_ids);

    if (itemsError) {
      return c.json({ success: false, error: itemsError.message }, 500);
    }

    if (!items || items.length === 0) {
      return c.json({ success: false, error: 'No matching wardrobe items found' }, 404);
    }

    // Use the first item for try-on
    const firstItem = items[0];
    const garmentUrl = firstItem.image_no_bg_url ?? firstItem.image_url;
    const category = ['bottoms'].includes(firstItem.category) ? 'bottoms'
      : ['dresses'].includes(firstItem.category) ? 'one-pieces'
      : 'tops';

    // Call tryOn with avatar image and garment
    const resultUrl = await tryOn(
      userAvatar.base_image_url,
      garmentUrl,
      category as 'tops' | 'bottoms' | 'one-pieces'
    );

    // Upload result to 'outfits' bucket
    let storedUrl = resultUrl;
    try {
      const response = await fetch(resultUrl);
      if (response.ok) {
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const storagePath = `${userId}/tryoutfit_${uuidv4()}.png`;
        storedUrl = await uploadImage('outfits', storagePath, buffer, 'image/png');
      }
    } catch (storageErr) {
      logger.warn({ err: storageErr }, 'Failed to persist try-outfit result to storage');
    }

    // Decrement vton_credits atomically using database function to prevent race conditions
    const { data: decrementResult, error: decrementError } = await supabaseAdmin
      .rpc('decrement_credits', { p_user_id: userId, p_amount: 1 });
    if (decrementError || decrementResult === null || decrementResult < 0) {
      return c.json({ success: false, error: 'Failed to decrement credits. Please retry.' }, 409);
    }
    const newCredits = decrementResult;

    // Cache in avatar_renders table
    const renderId = uuidv4();
    const { error: renderError } = await supabaseAdmin
      .from('avatar_renders')
      .insert({
        id: renderId,
        user_id: userId,
        item_ids: body.item_ids,
        result_image_url: storedUrl,
      });

    if (renderError) {
      logger.error({ err: renderError }, 'Failed to create avatar render record');
    }

    return c.json({
      success: true,
      data: {
        render_id: renderId,
        result_image_url: storedUrl,
        credits_remaining: newCredits,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error({ err }, 'Avatar try-outfit failed');
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── GET /avatar/renders ──────────────────────────────────────────────────────
// List avatar renders (paginated), ordered by created_at desc.
avatar.get('/renders', async (c) => {
  try {
    const userId = c.get('userId');
    const page = parseInt(c.req.query('page') ?? '1', 10);
    const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10), 50);
    const offset = (page - 1) * limit;

    const { data, error, count } = await supabaseAdmin
      .from('avatar_renders')
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

// ─── DELETE /avatar/renders/:id ───────────────────────────────────────────────
// Delete a specific render (verify user_id ownership).
avatar.delete('/renders/:id', async (c) => {
  try {
    const userId = c.get('userId');
    const renderId = c.req.param('id');

    // Fetch the render first to verify ownership
    const { data: render, error: fetchError } = await supabaseAdmin
      .from('avatar_renders')
      .select('*')
      .eq('id', renderId)
      .eq('user_id', userId)
      .single();

    if (fetchError || !render) {
      return c.json({ success: false, error: 'Render not found' }, 404);
    }

    // Delete from database
    const { error: deleteError } = await supabaseAdmin
      .from('avatar_renders')
      .delete()
      .eq('id', renderId)
      .eq('user_id', userId);

    if (deleteError) {
      return c.json({ success: false, error: deleteError.message }, 500);
    }

    // Clean up storage
    if (render.result_image_url) {
      const path = extractPathFromUrl('outfits', render.result_image_url);
      if (path) {
        try {
          await deleteImage('outfits', path);
        } catch {
          logger.error('Failed to delete render image from storage');
        }
      }
    }

    return c.json({ success: true, data: { message: 'Render deleted successfully' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

export { avatar as avatarRoutes };
