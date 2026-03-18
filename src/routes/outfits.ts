import { Hono } from 'hono';
import { supabaseAdmin } from '../services/supabase.js';
import { authMiddleware } from '../middleware/auth.js';
import { generateJSON, analyzeImageJSON } from '../services/gemini.js';
import { uploadImage } from '../services/storage.js';
import type { AppVariables, Occasion, Season } from '../types/index.js';
import { v4 as uuidv4 } from 'uuid';

const outfits = new Hono<{ Variables: AppVariables }>();

// All outfit routes require authentication
outfits.use('*', authMiddleware);

// ─── POST /outfits/generate ─────────────────────────────────────────────────
// Generate outfit suggestions from the user's wardrobe using AI.
outfits.post('/generate', async (c) => {
  try {
    const userId = c.get('userId');
    const body = await c.req.json<{
      occasion: Occasion;
      season?: Season;
      item_ids?: string[];
      preferences?: string;
      count?: number;
    }>();

    if (!body.occasion) {
      return c.json({ success: false, error: 'occasion is required' }, 400);
    }

    // Fetch user profile for context
    const { data: profile } = await supabaseAdmin
      .from('user_profiles')
      .select('*')
      .eq('id', userId)
      .single();

    // Fetch wardrobe items
    let itemsQuery = supabaseAdmin
      .from('wardrobe_items')
      .select('*')
      .eq('user_id', userId);

    if (body.season && body.season !== 'all') {
      itemsQuery = itemsQuery.contains('season', [body.season]);
    }
    if (body.occasion) {
      itemsQuery = itemsQuery.contains('occasions', [body.occasion]);
    }

    const { data: items, error: itemsError } = await itemsQuery;

    if (itemsError) {
      return c.json({ success: false, error: itemsError.message }, 500);
    }

    if (!items || items.length === 0) {
      return c.json({ success: false, error: 'No wardrobe items found matching the criteria. Add more items to your wardrobe.' }, 400);
    }

    // If specific items are requested, include them
    const mustInclude = body.item_ids
      ? items.filter((item) => body.item_ids!.includes(item.id))
      : [];

    // Build the prompt
    const wardrobeSummary = items.map((item) => ({
      id: item.id,
      name: item.name,
      category: item.category,
      subcategory: item.subcategory,
      color: item.color,
      season: item.season,
      occasions: item.occasions,
    }));

    const numSuggestions = Math.min(body.count ?? 3, 5);

    const prompt = `You are an expert fashion stylist. Based on the user's wardrobe items, create ${numSuggestions} complete outfit suggestions.

User Profile:
- Gender: ${profile?.gender ?? 'not specified'}
- Body Shape: ${profile?.body_shape ?? 'not specified'}
- Style Preferences: ${(profile?.style_preferences ?? []).join(', ') || 'not specified'}
- Skin Tone: ${profile?.skin_tone ?? 'not specified'}

Occasion: ${body.occasion}
Season: ${body.season ?? 'any'}
${body.preferences ? `Additional Preferences: ${body.preferences}` : ''}
${mustInclude.length > 0 ? `Must include items: ${mustInclude.map((i) => i.name).join(', ')}` : ''}

Available Wardrobe Items:
${JSON.stringify(wardrobeSummary, null, 2)}

Return a JSON array of outfit suggestions. Each suggestion should be:
{
  "name": "Outfit name/description",
  "item_ids": ["id1", "id2", ...],
  "styling_tips": "Brief styling advice for this combination",
  "score": 1-10 rating for how well the pieces work together,
  "reasoning": "Why these pieces work well together"
}

IMPORTANT: Only use item IDs from the provided wardrobe. Each outfit should have at minimum a top and bottom (or a dress/one-piece). Try to create diverse combinations.`;

    const suggestions = await generateJSON<Array<{
      name: string;
      item_ids: string[];
      styling_tips: string;
      score: number;
      reasoning: string;
    }>>(prompt);

    // Enrich suggestions with full item data
    const enriched = suggestions.map((suggestion) => ({
      ...suggestion,
      items: suggestion.item_ids
        .map((id) => items.find((item) => item.id === id))
        .filter(Boolean),
    }));

    return c.json({ success: true, data: enriched });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── POST /outfits/daily ────────────────────────────────────────────────────
// Save outfit of the day.
outfits.post('/daily', async (c) => {
  try {
    const userId = c.get('userId');
    const body = await c.req.json<{
      outfit_data: Record<string, unknown>;
      image_url?: string;
      score?: number;
      occasion?: Occasion;
      item_ids?: string[];
    }>();

    if (!body.outfit_data) {
      return c.json({ success: false, error: 'outfit_data is required' }, 400);
    }

    const today = new Date().toISOString().split('T')[0];

    // Check if there's already an outfit for today (upsert)
    const { data: existing } = await supabaseAdmin
      .from('daily_outfits')
      .select('id')
      .eq('user_id', userId)
      .eq('date', today)
      .single();

    let data;
    let error;

    if (existing) {
      // Update existing daily outfit
      const result = await supabaseAdmin
        .from('daily_outfits')
        .update({
          outfit_data: body.outfit_data,
          image_url: body.image_url ?? null,
          score: body.score ?? null,
          occasion: body.occasion ?? 'casual',
        })
        .eq('id', existing.id)
        .select()
        .single();

      data = result.data;
      error = result.error;
    } else {
      // Create new daily outfit
      const result = await supabaseAdmin
        .from('daily_outfits')
        .insert({
          id: uuidv4(),
          user_id: userId,
          date: today,
          outfit_data: body.outfit_data,
          image_url: body.image_url ?? null,
          score: body.score ?? null,
          occasion: body.occasion ?? 'casual',
        })
        .select()
        .single();

      data = result.data;
      error = result.error;
    }

    if (error) {
      return c.json({ success: false, error: error.message }, 500);
    }

    // If item_ids are provided, log wear for each item
    if (body.item_ids && body.item_ids.length > 0) {
      for (const itemId of body.item_ids) {
        const { data: item } = await supabaseAdmin
          .from('wardrobe_items')
          .select('wear_count')
          .eq('id', itemId)
          .eq('user_id', userId)
          .single();

        if (item) {
          await supabaseAdmin
            .from('wardrobe_items')
            .update({
              wear_count: (item.wear_count ?? 0) + 1,
              last_worn: new Date().toISOString(),
            })
            .eq('id', itemId)
            .eq('user_id', userId);
        }
      }
    }

    return c.json({ success: true, data }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── GET /outfits/daily ─────────────────────────────────────────────────────
// Get today's outfit.
outfits.get('/daily', async (c) => {
  try {
    const userId = c.get('userId');
    const date = c.req.query('date') ?? new Date().toISOString().split('T')[0];

    const { data, error } = await supabaseAdmin
      .from('daily_outfits')
      .select('*')
      .eq('user_id', userId)
      .eq('date', date)
      .single();

    if (error || !data) {
      return c.json({ success: false, error: 'No outfit found for this date' }, 404);
    }

    return c.json({ success: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── GET /outfits/history ───────────────────────────────────────────────────
// Outfit history with calendar view (by month).
outfits.get('/history', async (c) => {
  try {
    const userId = c.get('userId');
    const month = c.req.query('month'); // e.g. "2026-03"
    const page = parseInt(c.req.query('page') ?? '1', 10);
    const limit = Math.min(parseInt(c.req.query('limit') ?? '31', 10), 60);
    const offset = (page - 1) * limit;

    let query = supabaseAdmin
      .from('daily_outfits')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .order('date', { ascending: false });

    if (month) {
      // Filter by month: "2026-03" -> dates between "2026-03-01" and "2026-03-31"
      const startDate = `${month}-01`;
      const [yearStr, monthStr] = month.split('-');
      const year = parseInt(yearStr!, 10);
      const mon = parseInt(monthStr!, 10);
      const lastDay = new Date(year, mon, 0).getDate();
      const endDate = `${month}-${String(lastDay).padStart(2, '0')}`;

      query = query.gte('date', startDate).lte('date', endDate);
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

// ─── GET /outfits/streak ────────────────────────────────────────────────────
// Get streak information.
outfits.get('/streak', async (c) => {
  try {
    const userId = c.get('userId');

    const { data: dailyOutfits, error } = await supabaseAdmin
      .from('daily_outfits')
      .select('date')
      .eq('user_id', userId)
      .order('date', { ascending: false })
      .limit(365);

    if (error) {
      return c.json({ success: false, error: error.message }, 500);
    }

    const entries = dailyOutfits ?? [];

    // Calculate current streak
    let currentStreak = 0;
    if (entries.length > 0) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      let checkDate = new Date(today);

      for (const entry of entries) {
        const entryDate = new Date(entry.date);
        entryDate.setHours(0, 0, 0, 0);

        if (entryDate.getTime() === checkDate.getTime()) {
          currentStreak++;
          checkDate.setDate(checkDate.getDate() - 1);
        } else if (entryDate.getTime() < checkDate.getTime()) {
          if (currentStreak === 0) {
            // Allow starting from yesterday
            checkDate.setDate(checkDate.getDate() - 1);
            if (entryDate.getTime() === checkDate.getTime()) {
              currentStreak++;
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

    // Calculate longest streak
    let longestStreak = 0;
    let tempStreak = 0;
    const sortedDates = entries
      .map((e) => e.date)
      .sort()
      .reverse();

    for (let i = 0; i < sortedDates.length; i++) {
      if (i === 0) {
        tempStreak = 1;
      } else {
        const current = new Date(sortedDates[i]!);
        const previous = new Date(sortedDates[i - 1]!);
        const diffDays = (previous.getTime() - current.getTime()) / (1000 * 60 * 60 * 24);

        if (Math.abs(diffDays - 1) < 0.01) {
          tempStreak++;
        } else {
          tempStreak = 1;
        }
      }
      longestStreak = Math.max(longestStreak, tempStreak);
    }

    return c.json({
      success: true,
      data: {
        current_streak: currentStreak,
        longest_streak: longestStreak,
        total_outfits: entries.length,
        has_today: entries.length > 0 && entries[0]!.date === new Date().toISOString().split('T')[0],
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── POST /outfits/save ─────────────────────────────────────────────────────
// Save a generated outfit combination.
outfits.post('/save', async (c) => {
  try {
    const userId = c.get('userId');
    const body = await c.req.json<{
      name?: string;
      item_ids: string[];
      occasion?: Occasion;
      score?: number;
      ai_feedback?: string;
      image_url?: string;
    }>();

    if (!body.item_ids || body.item_ids.length === 0) {
      return c.json({ success: false, error: 'item_ids array is required' }, 400);
    }

    // Verify all items belong to the user
    const { data: items, error: itemsError } = await supabaseAdmin
      .from('wardrobe_items')
      .select('id, name, category, color, image_url, image_no_bg_url')
      .eq('user_id', userId)
      .in('id', body.item_ids);

    if (itemsError) {
      return c.json({ success: false, error: itemsError.message }, 500);
    }

    if (!items || items.length !== body.item_ids.length) {
      return c.json({ success: false, error: 'One or more item_ids are invalid' }, 400);
    }

    const { data, error } = await supabaseAdmin
      .from('outfits')
      .insert({
        id: uuidv4(),
        user_id: userId,
        name: body.name ?? 'Saved Outfit',
        item_ids: body.item_ids,
        occasion: body.occasion ?? 'casual',
        score: body.score ?? null,
        ai_feedback: body.ai_feedback ? { feedback: body.ai_feedback } : null,
        collage_url: body.image_url ?? null,
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

// ─── GET /outfits/saved ─────────────────────────────────────────────────────
// List saved outfits.
outfits.get('/saved', async (c) => {
  try {
    const userId = c.get('userId');
    const page = parseInt(c.req.query('page') ?? '1', 10);
    const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10), 50);
    const offset = (page - 1) * limit;

    const { data, error, count } = await supabaseAdmin
      .from('outfits')
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

// ─── DELETE /outfits/:id ────────────────────────────────────────────────────
// Delete a saved outfit.
outfits.delete('/:id', async (c) => {
  try {
    const userId = c.get('userId');
    const outfitId = c.req.param('id');

    const { error } = await supabaseAdmin
      .from('outfits')
      .delete()
      .eq('id', outfitId)
      .eq('user_id', userId);

    if (error) {
      return c.json({ success: false, error: 'Outfit not found or delete failed' }, 404);
    }

    return c.json({ success: true, data: { message: 'Outfit deleted successfully' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── POST /outfits/rate ─────────────────────────────────────────────────────
// Rate an outfit photo: AI analysis returns score + feedback.
outfits.post('/rate', async (c) => {
  try {
    const userId = c.get('userId');
    const body = await c.req.json<{
      image: string; // base64
      occasion?: Occasion;
      item_ids?: string[];
    }>();

    if (!body.image) {
      return c.json({ success: false, error: 'image (base64) is required' }, 400);
    }

    // Fetch user profile for context
    const { data: profile } = await supabaseAdmin
      .from('user_profiles')
      .select('gender, body_shape, skin_tone, style_preferences')
      .eq('id', userId)
      .single();

    const analysis = await analyzeImageJSON<{
      score: number;
      overall_feedback: string;
      strengths: string[];
      improvements: string[];
      color_harmony: number;
      fit_assessment: string;
      style_coherence: number;
      occasion_appropriateness: number;
    }>(
      body.image,
      `You are an expert fashion stylist analyzing an outfit photo. Rate this outfit and provide detailed feedback.

User Context:
- Gender: ${profile?.gender ?? 'not specified'}
- Body Shape: ${profile?.body_shape ?? 'not specified'}
- Skin Tone: ${profile?.skin_tone ?? 'not specified'}
- Target Occasion: ${body.occasion ?? 'casual'}

Return JSON with:
- "score": overall score from 1-10 (be honest but encouraging)
- "overall_feedback": 2-3 sentence overall assessment
- "strengths": array of 2-4 things done well
- "improvements": array of 1-3 constructive suggestions
- "color_harmony": score 1-10 for how well colors work together
- "fit_assessment": brief note on how well the clothes fit
- "style_coherence": score 1-10 for how cohesive the style is
- "occasion_appropriateness": score 1-10 for how appropriate for the occasion`
    );

    return c.json({ success: true, data: analysis });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

export { outfits as outfitRoutes };
