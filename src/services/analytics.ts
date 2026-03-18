import { supabaseAdmin } from './supabase.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Simple analytics event tracker.
 * Stores events in the analytics_events table for later analysis.
 */
export async function trackEvent(
  userId: string | null,
  event: string,
  properties: Record<string, unknown> = {}
): Promise<void> {
  try {
    await supabaseAdmin.from('analytics_events').insert({
      id: uuidv4(),
      user_id: userId,
      event,
      properties,
    });
  } catch (err) {
    // Analytics should never break the app — log and move on
    console.error('[Analytics] Failed to track event:', event, err);
  }
}

// Event name constants
export const AnalyticsEvents = {
  // Onboarding
  ONBOARDING_STARTED: 'onboarding_started',
  ONBOARDING_COMPLETED: 'onboarding_completed',
  ONBOARDING_STEP: 'onboarding_step',

  // Wardrobe
  WARDROBE_ITEM_ADDED: 'wardrobe_item_added',
  WARDROBE_ITEM_DELETED: 'wardrobe_item_deleted',
  WARDROBE_ITEM_FAVORITED: 'wardrobe_item_favorited',

  // Outfits
  OUTFIT_GENERATED: 'outfit_generated',
  OUTFIT_SAVED: 'outfit_saved',
  OUTFIT_SHARED: 'outfit_shared',
  OUTFIT_RATED: 'outfit_rated',

  // VTON
  VTON_USED: 'vton_used',
  VTON_FAILED: 'vton_failed',

  // Subscription
  SUBSCRIPTION_VIEWED: 'subscription_viewed',
  SUBSCRIPTION_STARTED: 'subscription_started',
  SUBSCRIPTION_CANCELLED: 'subscription_cancelled',
  CREDIT_PACK_PURCHASED: 'credit_pack_purchased',
  TRIAL_STARTED: 'trial_started',

  // Social
  POST_CREATED: 'post_created',
  POST_LIKED: 'post_liked',
  POST_COMMENTED: 'post_commented',
  STORY_CREATED: 'story_created',

  // Friends
  FRIEND_REQUEST_SENT: 'friend_request_sent',
  FRIEND_REQUEST_ACCEPTED: 'friend_request_accepted',

  // AI
  AI_CHAT_MESSAGE_SENT: 'ai_chat_message_sent',
  AI_COLOR_ANALYSIS: 'ai_color_analysis',

  // Auth
  USER_SIGNED_UP: 'user_signed_up',
  USER_SIGNED_IN: 'user_signed_in',
  USER_DELETED_ACCOUNT: 'user_deleted_account',
} as const;
