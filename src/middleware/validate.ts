import type { Context, Next } from 'hono';
import { z, type ZodSchema } from 'zod';

/**
 * Hono middleware factory that validates the request body against a Zod schema.
 * Strips unknown fields and returns 400 with specific error messages on failure.
 */
export function validateBody<T extends ZodSchema>(schema: T) {
  return async (c: Context, next: Next) => {
    try {
      const body = await c.req.json();
      const parsed = schema.parse(body);
      c.set('validatedBody', parsed);
      await next();
    } catch (err) {
      if (err instanceof z.ZodError) {
        const messages = err.issues.map(
          (e: z.ZodIssue) => `${e.path.join('.')}: ${e.message}`
        );
        return c.json(
          {
            success: false,
            error: 'Validation failed',
            details: messages,
          },
          400
        );
      }
      return c.json({ success: false, error: 'Invalid request body' }, 400);
    }
  };
}

// Common validation schemas
export const schemas = {
  // Auth
  appleAuth: z.object({
    id_token: z.string().min(1),
    full_name: z.string().max(100).optional(),
  }),
  googleAuth: z.object({
    id_token: z.string().min(1),
  }),
  magicLink: z.object({
    email: z.string().email('Invalid email address'),
  }),

  // Social
  createPost: z.object({
    type: z.enum(['outfit', 'story', 'rating']),
    image_url: z.string().url(),
    caption: z.string().max(500).optional(),
    occasion: z.string().max(50).optional(),
    outfit_id: z.string().uuid().optional(),
    outfit_data: z.record(z.string(), z.unknown()).optional(),
    score: z.number().min(0).max(10).optional(),
  }),
  createComment: z.object({
    content: z.string().min(1, 'Comment cannot be empty').max(500),
  }),
  createStory: z.object({
    image_url: z.string().url(),
    caption: z.string().max(500).optional(),
    outfit_data: z.record(z.string(), z.unknown()).optional(),
  }),

  // Wardrobe
  addWardrobeItem: z.object({
    name: z.string().min(1).max(100).optional(),
    category: z.enum([
      'tops', 'bottoms', 'dresses', 'outerwear', 'shoes',
      'accessories', 'bags', 'activewear', 'swimwear', 'formal',
    ]).optional(),
    color: z.string().max(50).optional(),
    brand: z.string().max(100).optional(),
    season: z.array(z.enum(['spring', 'summer', 'fall', 'winter', 'all'])).optional(),
    occasions: z.array(z.enum([
      'casual', 'work', 'formal', 'date', 'party', 'sport', 'travel', 'beach',
    ])).optional(),
  }),

  // Subscriptions
  verifySubscription: z.object({
    receipt_data: z.string().min(1),
    product_id: z.enum([
      'com.mirrorai.pro.monthly',
      'com.mirrorai.premium.monthly',
    ]),
    platform: z.string().optional(),
  }),

  // Image upload
  imageUpload: z.object({
    image: z.string().min(1),
    bucket: z.enum(['wardrobe', 'avatars', 'outfits', 'social']),
  }),

  // Friends
  friendRequest: z.object({
    user_id: z.string().uuid().optional(),
    username: z.string().min(2).max(50).optional(),
  }).refine(
    (data) => data.user_id || data.username,
    { message: 'Either user_id or username must be provided' }
  ),

  // Report
  report: z.object({
    content_type: z.enum(['post', 'comment', 'story', 'user']),
    content_id: z.string().min(1),
    reason: z.string().min(1).max(500),
    description: z.string().max(1000).optional(),
  }),

  // Block
  blockUser: z.object({
    blocked_user_id: z.string().uuid(),
  }),

  // AI
  aiChat: z.object({
    message: z.string().min(1, 'Message is required').max(2000),
    history: z.array(z.object({
      role: z.string(),
      content: z.string(),
    })).optional(),
  }),
  analyzeOutfit: z.object({
    image: z.string().min(1, 'image (base64) is required'),
    occasion: z.string().max(100).optional(),
  }),
  analyzeColors: z.object({
    image: z.string().min(1, 'image (base64) is required'),
  }),
  identifyGarment: z.object({
    image: z.string().min(1, 'image (base64) is required'),
  }),
  shoppingRecs: z.object({
    gaps: z.array(z.string().max(200)).max(20).optional(),
    budget: z.string().max(100).optional(),
    occasion: z.string().max(100).optional(),
  }),

  // VTON
  vtonGenerate: z.object({
    garment_image_url: z.string().url(),
    category: z.enum(['tops', 'bottoms', 'one-pieces']),
  }),

  // Wardrobe
  addWardrobeItemWithImage: z.object({
    image: z.string().min(1, 'image (base64) is required'),
    name: z.string().min(1).max(100).optional(),
    category: z.enum([
      'tops', 'bottoms', 'dresses', 'outerwear', 'shoes',
      'accessories', 'bags', 'activewear', 'swimwear', 'formal',
    ]).optional(),
    subcategory: z.string().max(50).optional(),
    color: z.string().max(50).optional(),
    brand: z.string().max(100).optional(),
    season: z.array(z.enum(['spring', 'summer', 'fall', 'winter', 'all'])).optional(),
    occasions: z.array(z.enum([
      'casual', 'work', 'formal', 'date', 'party', 'sport', 'travel', 'beach',
    ])).optional(),
  }),
  updateWardrobeItem: z.object({
    name: z.string().min(1).max(100).optional(),
    category: z.enum([
      'tops', 'bottoms', 'dresses', 'outerwear', 'shoes',
      'accessories', 'bags', 'activewear', 'swimwear', 'formal',
    ]).optional(),
    subcategory: z.string().max(50).optional(),
    color: z.string().max(50).optional(),
    brand: z.string().max(100).optional(),
    season: z.array(z.enum(['spring', 'summer', 'fall', 'winter', 'all'])).optional(),
    occasions: z.array(z.enum([
      'casual', 'work', 'formal', 'date', 'party', 'sport', 'travel', 'beach',
    ])).optional(),
    is_favorite: z.boolean().optional(),
  }),
};
