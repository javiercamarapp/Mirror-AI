import { Hono } from 'hono';
import sharp from 'sharp';
import { supabaseAdmin } from '../services/supabase.js';
import { authMiddleware } from '../middleware/auth.js';
import { validateBody, schemas } from '../middleware/validate.js';
import { uploadImage, deleteImage, extractPathFromUrl } from '../services/storage.js';
import { removeBackground } from '../services/rembg.js';
import { analyzeImageJSON } from '../services/gemini.js';
import { logger } from '../services/logger.js';
import type { AppVariables, WardrobeCategory, Season, Occasion } from '../types/index.js';
import { v4 as uuidv4 } from 'uuid';

const wardrobe = new Hono<{ Variables: AppVariables }>();

// All wardrobe routes require authentication
wardrobe.use('*', authMiddleware);

// ─── GET /wardrobe ──────────────────────────────────────────────────────────
// List wardrobe items with optional filters.
wardrobe.get('/', async (c) => {
  try {
    const userId = c.get('userId');
    const category = c.req.query('category') as WardrobeCategory | undefined;
    const color = c.req.query('color');
    const season = c.req.query('season') as Season | undefined;
    const occasion = c.req.query('occasion') as Occasion | undefined;
    const favorite = c.req.query('favorite');
    const page = parseInt(c.req.query('page') ?? '1', 10);
    const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 100);
    const offset = (page - 1) * limit;

    let query = supabaseAdmin
      .from('wardrobe_items')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (category) {
      query = query.eq('category', category);
    }
    if (color) {
      if (color.length > 50) {
        return c.json({ success: false, error: 'Color filter must be 50 characters or less' }, 400);
      }
      query = query.ilike('color', `%${color}%`);
    }
    if (season) {
      query = query.contains('season', [season]);
    }
    if (occasion) {
      query = query.contains('occasions', [occasion]);
    }
    if (favorite === 'true') {
      query = query.eq('is_favorite', true);
    }

    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;

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

// ─── POST /wardrobe ─────────────────────────────────────────────────────────
// Add item: accepts image upload (base64), removes background, uses Gemini to
// identify/categorize, saves to DB + Storage.
wardrobe.post('/', validateBody(schemas.addWardrobeItemWithImage), async (c) => {
  try {
    const userId = c.get('userId');
    const body = c.get('validatedBody') as {
      image: string;
      name?: string;
      category?: WardrobeCategory;
      subcategory?: string;
      color?: string;
      brand?: string;
      season?: Season[];
      occasions?: Occasion[];
    };

    // Validate image size (max 10MB base64)
    const maxBase64Size = 10 * 1024 * 1024 * 4 / 3; // ~13.3MB base64 for 10MB binary
    if (body.image.length > maxBase64Size) {
      return c.json({ success: false, error: 'Image exceeds maximum size of 10MB' }, 400);
    }

    // Check wardrobe limit based on subscription
    const { data: profile } = await supabaseAdmin
      .from('user_profiles')
      .select('subscription_plan')
      .eq('id', userId)
      .single();

    const planLimits: Record<string, number> = {
      free: 50,
      basic: 200,
      premium: -1,
    };
    const maxItems = planLimits[profile?.subscription_plan ?? 'free'] ?? 50;

    if (maxItems > 0) {
      const { count } = await supabaseAdmin
        .from('wardrobe_items')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId);

      if ((count ?? 0) >= maxItems) {
        return c.json(
          { success: false, error: `Wardrobe limit reached (${maxItems} items). Upgrade your plan to add more.` },
          403
        );
      }
    }

    const rawImageBuffer = Buffer.from(body.image, 'base64');
    // Strip EXIF/GPS metadata before storing
    const imageBuffer = await sharp(rawImageBuffer)
      .withMetadata(false)
      .jpeg()
      .toBuffer();
    const itemId = uuidv4();

    // Upload original image (EXIF already stripped)
    const originalPath = `${userId}/${itemId}_original.jpg`;
    const imageUrl = await uploadImage('wardrobe', originalPath, imageBuffer, 'image/jpeg');

    // Remove background
    let imageNoBgUrl: string | null = null;
    try {
      const noBgBuffer = await removeBackground(imageBuffer);
      const noBgPath = `${userId}/${itemId}_nobg.png`;
      imageNoBgUrl = await uploadImage('wardrobe', noBgPath, noBgBuffer, 'image/png');
    } catch (bgErr) {
      logger.warn({ err: bgErr }, 'Background removal failed, continuing without');
    }

    // Use Gemini to analyze the garment
    let aiAnalysis: {
      name: string;
      category: WardrobeCategory;
      subcategory: string;
      color: string;
      brand: string | null;
      season: Season[];
      occasions: Occasion[];
    } | null = null;

    try {
      aiAnalysis = await analyzeImageJSON<{
        name: string;
        category: WardrobeCategory;
        subcategory: string;
        color: string;
        brand: string | null;
        season: Season[];
        occasions: Occasion[];
      }>(
        body.image,
        `Analyze this clothing item image and return JSON with these fields:
- "name": a descriptive name for the item (e.g. "Navy Blue Slim Fit Chinos")
- "category": one of: tops, bottoms, dresses, outerwear, shoes, accessories, bags, activewear, swimwear, formal
- "subcategory": more specific type (e.g. "t-shirt", "jeans", "sneakers", "blazer")
- "color": the primary color(s) of the item
- "brand": brand name if visible, otherwise null
- "season": array of seasons it's suitable for: spring, summer, fall, winter, all
- "occasions": array of occasions: casual, work, formal, date, party, sport, travel, beach

Return ONLY valid JSON.`
      );
    } catch (aiErr) {
      logger.warn({ err: aiErr }, 'AI garment analysis failed, using provided/default values');
    }

    // Merge user-provided values with AI analysis (user values take precedence)
    const itemData = {
      id: itemId,
      user_id: userId,
      name: body.name ?? aiAnalysis?.name ?? 'Unnamed Item',
      category: body.category ?? aiAnalysis?.category ?? 'tops',
      subcategory: body.subcategory ?? aiAnalysis?.subcategory ?? null,
      color: body.color ?? aiAnalysis?.color ?? 'unknown',
      brand: body.brand ?? aiAnalysis?.brand ?? null,
      image_url: imageUrl,
      image_no_bg_url: imageNoBgUrl,
      season: body.season ?? aiAnalysis?.season ?? ['all'],
      occasions: body.occasions ?? aiAnalysis?.occasions ?? ['casual'],
      wear_count: 0,
      is_favorite: false,
    };

    const { data, error } = await supabaseAdmin
      .from('wardrobe_items')
      .insert(itemData)
      .select()
      .single();

    if (error) {
      return c.json({ success: false, error: error.message }, 500);
    }

    // Refresh wardrobe stats materialized view asynchronously
    supabaseAdmin.rpc('refresh_wardrobe_user_stats').catch((err) => {
      logger.warn({ err }, 'Failed to refresh wardrobe_user_stats after item add');
    });

    return c.json({ success: true, data }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── GET /wardrobe/stats ────────────────────────────────────────────────────
// Wardrobe statistics: items per category, most worn, cost per wear, etc.
// NOTE: This must come before /:id to avoid matching "stats" as an id.
wardrobe.get('/stats', async (c) => {
  try {
    const userId = c.get('userId');

    // Try to use the wardrobe_user_stats materialized view for aggregate stats
    const { data: matStats } = await supabaseAdmin
      .from('wardrobe_user_stats')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    // Still need items for most/least worn and favorites (not in materialized view)
    const { data: items, error } = await supabaseAdmin
      .from('wardrobe_items')
      .select('id, name, category, wear_count, image_url, is_favorite, color, season')
      .eq('user_id', userId);

    if (error) {
      return c.json({ success: false, error: error.message }, 500);
    }

    const allItems = items ?? [];

    // Use materialized view data if available, otherwise compute from items
    let byCategory: Record<string, number>;
    let byColor: Record<string, number>;
    let bySeason: Record<string, number>;

    if (matStats) {
      byCategory = (matStats.category_counts as Record<string, number>) ?? {};
      byColor = (matStats.color_counts as Record<string, number>) ?? {};
      bySeason = (matStats.season_counts as Record<string, number>) ?? {};
    } else {
      // Fallback: compute from items
      byCategory = {};
      for (const item of allItems) {
        byCategory[item.category] = (byCategory[item.category] ?? 0) + 1;
      }
      byColor = {};
      for (const item of allItems) {
        const color = (item.color ?? 'unknown').toLowerCase();
        byColor[color] = (byColor[color] ?? 0) + 1;
      }
      bySeason = {};
      for (const item of allItems) {
        const seasons: string[] = item.season ?? [];
        for (const s of seasons) {
          bySeason[s] = (bySeason[s] ?? 0) + 1;
        }
      }
    }

    // Most worn items (top 5)
    const mostWorn = [...allItems]
      .sort((a, b) => (b.wear_count ?? 0) - (a.wear_count ?? 0))
      .slice(0, 5)
      .map((item) => ({
        id: item.id,
        name: item.name,
        category: item.category,
        wear_count: item.wear_count,
        image_url: item.image_url,
      }));

    // Least worn items (top 5, excluding never worn at 0)
    const leastWorn = [...allItems]
      .filter((item) => (item.wear_count ?? 0) > 0)
      .sort((a, b) => (a.wear_count ?? 0) - (b.wear_count ?? 0))
      .slice(0, 5)
      .map((item) => ({
        id: item.id,
        name: item.name,
        category: item.category,
        wear_count: item.wear_count,
        image_url: item.image_url,
      }));

    // Never worn items
    const neverWorn = allItems.filter((item) => (item.wear_count ?? 0) === 0);

    // Favorites count
    const favoritesCount = allItems.filter((item) => item.is_favorite).length;

    return c.json({
      success: true,
      data: {
        total_items: matStats?.total_items ?? allItems.length,
        by_category: byCategory,
        by_color: byColor,
        by_season: bySeason,
        most_worn: mostWorn,
        least_worn: leastWorn,
        never_worn_count: neverWorn.length,
        favorites_count: favoritesCount,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── GET /wardrobe/:id ──────────────────────────────────────────────────────
wardrobe.get('/:id', async (c) => {
  try {
    const userId = c.get('userId');
    const itemId = c.req.param('id');

    const { data, error } = await supabaseAdmin
      .from('wardrobe_items')
      .select('*')
      .eq('id', itemId)
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      return c.json({ success: false, error: 'Item not found' }, 404);
    }

    return c.json({ success: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── PATCH /wardrobe/:id ────────────────────────────────────────────────────
wardrobe.patch('/:id', validateBody(schemas.updateWardrobeItem), async (c) => {
  try {
    const userId = c.get('userId');
    const itemId = c.req.param('id');
    const updates = c.get('validatedBody') as Record<string, unknown>;

    if (Object.keys(updates).length === 0) {
      return c.json({ success: false, error: 'No valid fields to update' }, 400);
    }

    const { data, error } = await supabaseAdmin
      .from('wardrobe_items')
      .update(updates)
      .eq('id', itemId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      return c.json({ success: false, error: 'Item not found or update failed' }, 404);
    }

    return c.json({ success: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── DELETE /wardrobe/:id ───────────────────────────────────────────────────
wardrobe.delete('/:id', async (c) => {
  try {
    const userId = c.get('userId');
    const itemId = c.req.param('id');

    // Fetch the item first to get image paths for cleanup
    const { data: item, error: fetchError } = await supabaseAdmin
      .from('wardrobe_items')
      .select('*')
      .eq('id', itemId)
      .eq('user_id', userId)
      .single();

    if (fetchError || !item) {
      return c.json({ success: false, error: 'Item not found' }, 404);
    }

    // Delete from database
    const { error: deleteError } = await supabaseAdmin
      .from('wardrobe_items')
      .delete()
      .eq('id', itemId)
      .eq('user_id', userId);

    if (deleteError) {
      return c.json({ success: false, error: deleteError.message }, 500);
    }

    // Refresh wardrobe stats materialized view asynchronously
    supabaseAdmin.rpc('refresh_wardrobe_user_stats').catch((err) => {
      logger.warn({ err }, 'Failed to refresh wardrobe_user_stats after item delete');
    });

    // Clean up storage files
    if (item.image_url) {
      const path = extractPathFromUrl('wardrobe', item.image_url);
      if (path) {
        try {
          await deleteImage('wardrobe', path);
        } catch {
          logger.error('Failed to delete original image from storage');
        }
      }
    }

    if (item.image_no_bg_url) {
      const path = extractPathFromUrl('wardrobe', item.image_no_bg_url);
      if (path) {
        try {
          await deleteImage('wardrobe', path);
        } catch {
          logger.error('Failed to delete no-bg image from storage');
        }
      }
    }

    return c.json({ success: true, data: { message: 'Item deleted successfully' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── POST /wardrobe/:id/wear ────────────────────────────────────────────────
// Log wearing this item: increment wear_count and set last_worn.
wardrobe.post('/:id/wear', async (c) => {
  try {
    const userId = c.get('userId');
    const itemId = c.req.param('id');

    // Fetch current wear_count
    const { data: item, error: fetchError } = await supabaseAdmin
      .from('wardrobe_items')
      .select('wear_count')
      .eq('id', itemId)
      .eq('user_id', userId)
      .single();

    if (fetchError || !item) {
      return c.json({ success: false, error: 'Item not found' }, 404);
    }

    const { data, error } = await supabaseAdmin
      .from('wardrobe_items')
      .update({
        wear_count: (item.wear_count ?? 0) + 1,
        last_worn: new Date().toISOString(),
      })
      .eq('id', itemId)
      .eq('user_id', userId)
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

// ─── POST /wardrobe/:id/favorite ─────────────────────────────────────────────
// Toggle is_favorite on a wardrobe item.
wardrobe.post('/:id/favorite', async (c) => {
  try {
    const userId = c.get('userId');
    const itemId = c.req.param('id');

    // Fetch current is_favorite
    const { data: item, error: fetchError } = await supabaseAdmin
      .from('wardrobe_items')
      .select('is_favorite')
      .eq('id', itemId)
      .eq('user_id', userId)
      .single();

    if (fetchError || !item) {
      return c.json({ success: false, error: 'Item not found' }, 404);
    }

    const { data, error } = await supabaseAdmin
      .from('wardrobe_items')
      .update({ is_favorite: !item.is_favorite })
      .eq('id', itemId)
      .eq('user_id', userId)
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

export { wardrobe as wardrobeRoutes };
