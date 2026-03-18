// ─── Enums ───────────────────────────────────────────────────────────────────

export type SubscriptionPlan = 'free' | 'basic' | 'premium';

export type FriendshipStatus = 'pending' | 'accepted' | 'blocked';

export type SocialPostType = 'outfit' | 'story' | 'rating';

export type WardrobeCategory =
  | 'tops'
  | 'bottoms'
  | 'dresses'
  | 'outerwear'
  | 'shoes'
  | 'accessories'
  | 'bags'
  | 'activewear'
  | 'swimwear'
  | 'formal';

export type Season = 'spring' | 'summer' | 'fall' | 'winter' | 'all';

export type Occasion =
  | 'casual'
  | 'work'
  | 'formal'
  | 'date'
  | 'party'
  | 'sport'
  | 'travel'
  | 'beach';

// ─── Core Models ─────────────────────────────────────────────────────────────

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  avatar_url: string | null;
  gender: string | null;
  age_range: string | null;
  body_shape: string | null;
  height: number | null;
  weight: number | null;
  skin_tone: string | null;
  style_preferences: string[];
  subscription_plan: SubscriptionPlan;
  onboarding_completed: boolean;
  created_at: string;
}

export interface WardrobeItem {
  id: string;
  user_id: string;
  name: string;
  category: WardrobeCategory;
  subcategory: string | null;
  color: string;
  brand: string | null;
  image_url: string;
  image_no_bg_url: string | null;
  season: Season[];
  occasions: Occasion[];
  wear_count: number;
  is_favorite: boolean;
  created_at: string;
}

export interface Outfit {
  id: string;
  user_id: string;
  items: WardrobeItem[];
  occasion: Occasion;
  score: number | null;
  ai_feedback: string | null;
  image_url: string | null;
  created_at: string;
}

export interface SocialPost {
  id: string;
  user_id: string;
  type: SocialPostType;
  image_url: string;
  caption: string | null;
  outfit_data: Record<string, unknown> | null;
  likes_count: number;
  comments_count: number;
  created_at: string;
  user: { name: string; avatar_url: string | null };
}

export interface Story {
  id: string;
  user_id: string;
  image_url: string;
  outfit_data: Record<string, unknown> | null;
  views_count: number;
  expires_at: string;
  created_at: string;
  user: { name: string; avatar_url: string | null };
}

export interface Comment {
  id: string;
  post_id: string;
  user_id: string;
  content: string;
  created_at: string;
  user: { name: string; avatar_url: string | null };
}

export interface Friendship {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: FriendshipStatus;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  read: boolean;
  created_at: string;
}

export interface DailyOutfit {
  id: string;
  user_id: string;
  date: string;
  outfit_data: Record<string, unknown>;
  image_url: string | null;
  score: number | null;
  occasion: Occasion;
  created_at: string;
}

export interface Trip {
  id: string;
  user_id: string;
  name: string;
  destination: string;
  start_date: string;
  end_date: string;
  outfits: Record<string, unknown>[];
  created_at: string;
}

export interface VTONUsage {
  id: string;
  user_id: string;
  credits_used: number;
  result_image_url: string;
  created_at: string;
}

// ─── Request / Response Types ────────────────────────────────────────────────

export interface CreateWardrobeItemRequest {
  name: string;
  category: WardrobeCategory;
  subcategory?: string;
  color: string;
  brand?: string;
  season?: Season[];
  occasions?: Occasion[];
}

export interface UpdateWardrobeItemRequest {
  name?: string;
  category?: WardrobeCategory;
  subcategory?: string;
  color?: string;
  brand?: string;
  season?: Season[];
  occasions?: Occasion[];
  is_favorite?: boolean;
}

export interface GenerateOutfitRequest {
  occasion: Occasion;
  season?: Season;
  item_ids?: string[];
  preferences?: string;
}

export interface ScoreOutfitRequest {
  item_ids: string[];
  occasion: Occasion;
}

export interface CreatePostRequest {
  type: SocialPostType;
  image_url: string;
  caption?: string;
  outfit_data?: Record<string, unknown>;
}

export interface CreateCommentRequest {
  content: string;
}

export interface UpdateProfileRequest {
  name?: string;
  avatar_url?: string;
  gender?: string;
  age_range?: string;
  body_shape?: string;
  height?: number;
  weight?: number;
  skin_tone?: string;
  style_preferences?: string[];
  onboarding_completed?: boolean;
}

export interface CreateTripRequest {
  name: string;
  destination: string;
  start_date: string;
  end_date: string;
}

export interface VTONRequest {
  garment_image_url: string;
  model_image_url?: string;
}

export interface PaginationParams {
  page?: number;
  limit?: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    has_more: boolean;
  };
}

// ─── Hono Context Variables ──────────────────────────────────────────────────

export type AppVariables = {
  userId: string;
};
