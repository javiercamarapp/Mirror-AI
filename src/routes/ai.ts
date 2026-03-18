import { Hono } from 'hono';
import { supabaseAdmin } from '../services/supabase.js';
import { authMiddleware } from '../middleware/auth.js';
import { generateText, generateJSON, analyzeImageJSON } from '../services/gemini.js';
import type { AppVariables } from '../types/index.js';

const ai = new Hono<{ Variables: AppVariables }>();

// Per-user AI rate limiting
const aiRateLimits = new Map<string, { count: number; resetAt: number }>();
const AI_MAX_REQUESTS = 20;
const AI_WINDOW_MS = 15 * 60 * 1000;

function checkAIRateLimit(userId: string): boolean {
  const now = Date.now();
  const entry = aiRateLimits.get(userId);
  if (!entry || now > entry.resetAt) {
    aiRateLimits.set(userId, { count: 1, resetAt: now + AI_WINDOW_MS });
    return true;
  }
  if (entry.count >= AI_MAX_REQUESTS) return false;
  entry.count++;
  return true;
}

// All AI routes require authentication
ai.use('*', authMiddleware);

const STYLIST_SYSTEM_PROMPT = `You are Mirror AI, a friendly and knowledgeable personal fashion stylist. You help users build their wardrobe, create outfits, and develop their personal style.

Key traits:
- Encouraging and positive, but honest when something doesn't work
- Knowledgeable about fashion trends, color theory, and body proportions
- Practical — suggest items at reasonable price points unless asked otherwise
- Inclusive and body-positive
- Consider the user's existing wardrobe, preferences, and lifestyle

When giving advice:
- Be specific (mention colors, patterns, cuts, materials)
- Explain WHY something works or doesn't
- Suggest alternatives when something isn't ideal
- Consider the user's climate, culture, and comfort
- Keep responses conversational but informative`;

// ─── POST /ai/chat ──────────────────────────────────────────────────────────
// Stylist chat: accepts a message and optional history, returns AI response.
ai.post('/chat', async (c) => {
  try {
    const userId = c.get('userId');
    if (!checkAIRateLimit(userId)) {
      return c.json({ success: false, error: 'AI rate limit exceeded. Please try again later.' }, 429);
    }
    const body = await c.req.json<{
      message: string;
      history?: Array<{ role: string; content: string }>;
    }>();

    if (!body.message?.trim()) {
      return c.json({ success: false, error: 'message is required' }, 400);
    }

    if (body.message.length > 2000) {
      return c.json({ success: false, error: 'Message must be 2000 characters or less' }, 400);
    }

    // Fetch user profile for context
    const { data: profile } = await supabaseAdmin
      .from('user_profiles')
      .select('*')
      .eq('id', userId)
      .single();

    // Fetch wardrobe summary for context
    const { data: wardrobeItems } = await supabaseAdmin
      .from('wardrobe_items')
      .select('name, category, color, brand, season, occasions, is_favorite')
      .eq('user_id', userId)
      .limit(100);

    const wardrobeSummary = wardrobeItems && wardrobeItems.length > 0
      ? `\n\nUser's Wardrobe (${wardrobeItems.length} items):\n${wardrobeItems.map((i) => `- ${i.name} (${i.category}, ${i.color})`).join('\n')}`
      : '\n\nUser has not added any wardrobe items yet.';

    const userContext = `
User Profile:
- Name: ${profile?.full_name ?? 'Unknown'}
- Gender: ${profile?.gender ?? 'not specified'}
- Age Range: ${profile?.age_range ?? 'not specified'}
- Body Shape: ${profile?.body_shape ?? 'not specified'}
- Skin Tone: ${profile?.skin_tone ?? 'not specified'}
- Style Preferences: ${(profile?.style_preferences ?? []).join(', ') || 'not specified'}
${wardrobeSummary}`;

    const systemPrompt = STYLIST_SYSTEM_PROMPT + '\n' + userContext;

    // Build conversation prompt including history
    let fullPrompt = '';
    if (body.history && body.history.length > 0) {
      const recentHistory = body.history.slice(-10);
      for (const msg of recentHistory) {
        const role = msg.role === 'assistant' ? 'Stylist' : 'User';
        fullPrompt += `${role}: ${msg.content}\n\n`;
      }
    }
    fullPrompt += `User: ${body.message}\nStylist:`;

    const response = await generateText(fullPrompt, systemPrompt);

    return c.json({
      success: true,
      data: {
        message: response,
        role: 'assistant',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[AI Chat Error]:', err);
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── POST /ai/analyze-outfit ────────────────────────────────────────────────
// Analyze an outfit photo. Returns score, strengths, and improvements.
ai.post('/analyze-outfit', async (c) => {
  try {
    const userId = c.get('userId');
    if (!checkAIRateLimit(userId)) {
      return c.json({ success: false, error: 'AI rate limit exceeded. Please try again later.' }, 429);
    }
    const body = await c.req.json<{
      image: string; // base64
      occasion?: string;
    }>();

    if (!body.image) {
      return c.json({ success: false, error: 'image (base64) is required' }, 400);
    }

    // Strip data:image/... prefix if present
    const base64 = body.image.replace(/^data:image\/\w+;base64,/, '');

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
      style_coherence: number;
      occasion_appropriateness: number;
      items_identified: Array<{
        type: string;
        color: string;
        description: string;
      }>;
    }>(
      base64,
      `You are an expert fashion stylist analyzing an outfit photo. Provide a thorough assessment.

User Context:
- Gender: ${profile?.gender ?? 'not specified'}
- Body Shape: ${profile?.body_shape ?? 'not specified'}
- Skin Tone: ${profile?.skin_tone ?? 'not specified'}
- Style Preferences: ${(profile?.style_preferences ?? []).join(', ') || 'not specified'}
- Occasion: ${body.occasion ?? 'general/casual'}

Return JSON with:
- "score": overall outfit score from 1-10
- "overall_feedback": 2-3 sentence overall assessment
- "strengths": array of 2-4 positive observations
- "improvements": array of 1-3 constructive suggestions
- "color_harmony": score 1-10 for color coordination
- "style_coherence": score 1-10 for style consistency
- "occasion_appropriateness": score 1-10 for occasion fit
- "items_identified": array of identified clothing items, each with "type", "color", and "description"`
    );

    return c.json({
      success: true,
      data: {
        score: Math.max(1, Math.min(10, analysis.score ?? 5)),
        overall_feedback: analysis.overall_feedback ?? '',
        strengths: analysis.strengths ?? [],
        improvements: analysis.improvements ?? [],
        color_harmony: analysis.color_harmony ?? 5,
        style_coherence: analysis.style_coherence ?? 5,
        occasion_appropriateness: analysis.occasion_appropriateness ?? 5,
        items_identified: analysis.items_identified ?? [],
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[AI Analyze Outfit Error]:', err);
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── POST /ai/analyze-colors ────────────────────────────────────────────────
// Color season analysis from selfie. Returns color season, best colors, palette.
ai.post('/analyze-colors', async (c) => {
  try {
    const userId = c.get('userId');
    if (!checkAIRateLimit(userId)) {
      return c.json({ success: false, error: 'AI rate limit exceeded. Please try again later.' }, 429);
    }
    const body = await c.req.json<{
      image: string; // base64
    }>();

    if (!body.image) {
      return c.json({ success: false, error: 'image (base64) is required' }, 400);
    }

    const base64 = body.image.replace(/^data:image\/\w+;base64,/, '');

    const analysis = await analyzeImageJSON<{
      color_season: string;
      sub_season: string;
      skin_undertone: string;
      best_colors: string[];
      avoid_colors: string[];
      neutral_palette: string[];
      accent_colors: string[];
      metal_recommendation: string;
      description: string;
    }>(
      base64,
      `Analyze this selfie/portrait to determine the person's color season based on their natural coloring (skin tone, hair color, eye color).

Return JSON with:
- "color_season": one of "Spring", "Summer", "Autumn", "Winter"
- "sub_season": more specific (e.g. "Light Spring", "Deep Winter", "Soft Summer", "Warm Autumn")
- "skin_undertone": "warm", "cool", or "neutral"
- "best_colors": array of 8-12 specific color names that would look best (e.g. "coral", "navy blue", "sage green")
- "avoid_colors": array of 4-6 colors to avoid
- "neutral_palette": array of 4-5 neutral tones that suit them (for basics like pants, coats)
- "accent_colors": array of 3-4 bold colors for statement pieces
- "metal_recommendation": "gold", "silver", "rose gold", or "both"
- "description": 2-3 sentence explanation of their coloring and why these colors suit them`
    );

    // Save color season to user profile
    await supabaseAdmin
      .from('user_profiles')
      .update({
        skin_tone: analysis.skin_undertone,
      })
      .eq('id', userId);

    return c.json({ success: true, data: analysis });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[AI Color Analysis Error]:', err);
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── POST /ai/identify-garment ──────────────────────────────────────────────
// Identify garment from photo. Returns category, color, brand guess, style tags.
ai.post('/identify-garment', async (c) => {
  try {
    const userId = c.get('userId');
    if (!checkAIRateLimit(userId)) {
      return c.json({ success: false, error: 'AI rate limit exceeded. Please try again later.' }, 429);
    }
    const body = await c.req.json<{
      image: string; // base64
    }>();

    if (!body.image) {
      return c.json({ success: false, error: 'image (base64) is required' }, 400);
    }

    const base64 = body.image.replace(/^data:image\/\w+;base64,/, '');

    const analysis = await analyzeImageJSON<{
      name: string;
      category: string;
      subcategory: string;
      color: string;
      secondary_colors: string[];
      pattern: string;
      material: string;
      brand_guess: string | null;
      style_tags: string[];
      seasons: string[];
      occasions: string[];
      care_instructions: string;
      price_range_estimate: string;
    }>(
      base64,
      `Analyze this clothing item image in detail. Identify everything you can about the garment.

Return JSON with:
- "name": descriptive name (e.g. "Navy Blue Slim Fit Oxford Shirt")
- "category": one of: tops, bottoms, dresses, outerwear, shoes, accessories, bags, activewear, swimwear, formal
- "subcategory": specific type (e.g. "oxford shirt", "chinos", "ankle boots", "tote bag")
- "color": primary color
- "secondary_colors": array of other colors present
- "pattern": pattern type (e.g. "solid", "striped", "floral", "plaid", "checkered")
- "material": likely material (e.g. "cotton", "denim", "leather", "polyester", "wool blend")
- "brand_guess": brand name if visible or recognizable, otherwise null
- "style_tags": array of style tags (e.g. "casual", "preppy", "minimalist", "streetwear", "bohemian")
- "seasons": array of suitable seasons: spring, summer, fall, winter, all
- "occasions": array of suitable occasions: casual, work, formal, date, party, sport, travel, beach
- "care_instructions": brief care suggestion based on material
- "price_range_estimate": estimated price range (e.g. "$30-50", "$100-200")`
    );

    return c.json({ success: true, data: analysis });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[AI Identify Garment Error]:', err);
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── POST /ai/shopping-recs ────────────────────────────────────────────────
// Get shopping recommendations based on wardrobe gaps.
ai.post('/shopping-recs', async (c) => {
  try {
    const userId = c.get('userId');
    if (!checkAIRateLimit(userId)) {
      return c.json({ success: false, error: 'AI rate limit exceeded. Please try again later.' }, 429);
    }
    const body = await c.req.json<{
      gaps?: string[];
      budget?: string;
      occasion?: string;
    }>();

    // Fetch user profile
    const { data: profile } = await supabaseAdmin
      .from('user_profiles')
      .select('*')
      .eq('id', userId)
      .single();

    // Fetch wardrobe items
    const { data: items } = await supabaseAdmin
      .from('wardrobe_items')
      .select('name, category, subcategory, color, brand, season, occasions')
      .eq('user_id', userId);

    const wardrobeList = (items ?? [])
      .map((i) => `${i.name} (${i.category}, ${i.color})`)
      .join('\n');

    // Build category counts
    const categoryCounts: Record<string, number> = {};
    for (const item of items ?? []) {
      categoryCounts[item.category] = (categoryCounts[item.category] ?? 0) + 1;
    }

    const prompt = `You are an expert fashion stylist and personal shopper. Analyze this person's wardrobe and suggest items they should buy to improve their style.

User Profile:
- Gender: ${profile?.gender ?? 'not specified'}
- Body Shape: ${profile?.body_shape ?? 'not specified'}
- Skin Tone: ${profile?.skin_tone ?? 'not specified'}
- Style Preferences: ${(profile?.style_preferences ?? []).join(', ') || 'not specified'}
${body.budget ? `- Budget: ${body.budget}` : ''}
${body.occasion ? `- Focus Occasion: ${body.occasion}` : ''}

Current Wardrobe (${(items ?? []).length} items):
Category Breakdown: ${JSON.stringify(categoryCounts)}
Items:
${wardrobeList || 'Empty wardrobe'}

${body.gaps && body.gaps.length > 0 ? `User-identified gaps: ${body.gaps.join(', ')}` : ''}

Return JSON with:
- "wardrobe_analysis": brief assessment of wardrobe strengths and weaknesses
- "gaps": array of identified wardrobe gaps
- "recommendations": array of 5-8 shopping recommendations, each with:
  - "item": what to buy (specific description)
  - "category": wardrobe category
  - "reason": why they need it
  - "priority": "high", "medium", or "low"
  - "estimated_price": price range
  - "styling_tip": how to wear it with existing items
- "capsule_essentials": array of 3-5 timeless essentials they're missing`;

    const recommendations = await generateJSON<{
      wardrobe_analysis: string;
      gaps: string[];
      recommendations: Array<{
        item: string;
        category: string;
        reason: string;
        priority: string;
        estimated_price: string;
        styling_tip: string;
      }>;
      capsule_essentials: string[];
    }>(prompt);

    return c.json({ success: true, data: recommendations });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[AI Shopping Recs Error]:', err);
    return c.json({ success: false, error: message }, 500);
  }
});

export { ai as aiRoutes };
