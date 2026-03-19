import { supabaseAdmin } from './supabase.js';
import type { SubscriptionPlan } from '../types/index.js';

// ─── Plan Definitions (Single Source of Truth) ──────────────────────────────

export interface PlanLimits {
  wardrobe_limit: number;
  vton_credits_monthly: number;
  ai_chats_daily: number;
}

/** Canonical plan limits — import this from here, never redefine elsewhere. */
export const PLAN_LIMITS: Record<SubscriptionPlan, PlanLimits> = {
  free: { wardrobe_limit: 50, vton_credits_monthly: 3, ai_chats_daily: 10 },
  basic: { wardrobe_limit: 200, vton_credits_monthly: 15, ai_chats_daily: 50 },
  premium: { wardrobe_limit: -1, vton_credits_monthly: 50, ai_chats_daily: -1 },
};

/** Credits reset amount per plan (derived from PLAN_LIMITS). */
export const CREDITS_BY_PLAN: Record<string, number> = {
  free: PLAN_LIMITS.free.vton_credits_monthly,
  basic: PLAN_LIMITS.basic.vton_credits_monthly,
  premium: PLAN_LIMITS.premium.vton_credits_monthly,
};

/** Product ID → plan mapping. */
export const PRODUCT_TO_PLAN: Record<string, string> = {
  'com.mirrorai.pro.monthly': 'basic',
  'com.mirrorai.premium.monthly': 'premium',
};

export const PLAN_RANK: Record<string, number> = {
  free: 0,
  basic: 1,
  premium: 2,
};

// ─── Feature Access ─────────────────────────────────────────────────────────

export type Feature =
  | 'unlimited_wardrobe'
  | 'vton'
  | 'unlimited_ai_chats'
  | 'premium_avatars'
  | 'priority_support';

const FEATURE_MIN_PLAN: Record<Feature, SubscriptionPlan> = {
  unlimited_wardrobe: 'premium',
  vton: 'basic',
  unlimited_ai_chats: 'premium',
  premium_avatars: 'premium',
  priority_support: 'premium',
};

/**
 * Check whether a given plan can access a specific feature.
 */
export function canAccessFeature(plan: SubscriptionPlan, feature: Feature): boolean {
  const requiredRank = PLAN_RANK[FEATURE_MIN_PLAN[feature]] ?? 0;
  const userRank = PLAN_RANK[plan] ?? 0;
  return userRank >= requiredRank;
}

/**
 * Get remaining VTON credits for a user.
 */
export async function getRemainingCredits(userId: string): Promise<number> {
  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('vton_credits')
    .eq('id', userId)
    .single();

  return profile?.vton_credits ?? 0;
}

// ─── Subscription Status ─────────────────────────────────────────────────────

export type SubscriptionStatus = 'active' | 'trial' | 'expired' | 'free';

export interface SubscriptionInfo {
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  limits: PlanLimits;
  trialEndDate: string | null;
  isTrialActive: boolean;
}

// ─── In-Memory Cache (5-minute TTL) ──────────────────────────────────────────

interface CacheEntry {
  data: SubscriptionInfo;
  expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const subscriptionCache = new Map<string, CacheEntry>();

/**
 * Invalidate the cached subscription info for a specific user.
 * Call this whenever a subscription change occurs (upgrade, downgrade, trial start, etc.).
 */
export function invalidateSubscriptionCache(userId: string): void {
  subscriptionCache.delete(userId);
}

/**
 * Invalidate the entire subscription cache.
 */
export function invalidateAllSubscriptionCaches(): void {
  subscriptionCache.clear();
}

/**
 * Centralized subscription service.
 * Checks subscription status, returns current plan with all limits,
 * and handles trial expiry logic in one place.
 * Results are cached in-memory with a 5-minute TTL.
 */
export async function getSubscriptionInfo(userId: string): Promise<SubscriptionInfo> {
  // Check cache first
  const cached = subscriptionCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  // Cache miss or expired — remove stale entry
  subscriptionCache.delete(userId);

  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('subscription_plan, trial_end_date')
    .eq('id', userId)
    .single();

  if (!profile) {
    return {
      plan: 'free',
      status: 'free',
      limits: PLAN_LIMITS.free,
      trialEndDate: null,
      isTrialActive: false,
    };
  }

  const rawPlan: SubscriptionPlan = (profile.subscription_plan as SubscriptionPlan) ?? 'free';
  const trialEndDate: string | null = profile.trial_end_date ?? null;

  let effectivePlan: SubscriptionPlan = rawPlan;
  let status: SubscriptionStatus = rawPlan === 'free' ? 'free' : 'active';
  let isTrialActive = false;

  // Handle trial logic
  if (trialEndDate) {
    const trialEnd = new Date(trialEndDate);
    const now = new Date();

    if (trialEnd > now) {
      // Trial is active -- elevate plan if currently below basic
      isTrialActive = true;
      if ((PLAN_RANK[effectivePlan] ?? 0) < (PLAN_RANK['basic'] ?? 0)) {
        effectivePlan = 'basic';
      }
      status = 'trial';
    } else if (rawPlan === 'free') {
      // Trial has expired and user is on free plan
      status = 'expired';
    }
  }

  const result: SubscriptionInfo = {
    plan: effectivePlan,
    status,
    limits: PLAN_LIMITS[effectivePlan],
    trialEndDate,
    isTrialActive,
  };

  // Store in cache
  subscriptionCache.set(userId, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });

  return result;
}

/**
 * Get the effective plan for a user (convenience wrapper).
 */
export async function getEffectivePlan(userId: string): Promise<SubscriptionPlan> {
  const info = await getSubscriptionInfo(userId);
  return info.plan;
}

/**
 * Get plan limits for a given plan.
 */
export function getPlanLimits(plan: SubscriptionPlan): PlanLimits {
  return PLAN_LIMITS[plan];
}

/**
 * Check if a user meets the minimum tier requirement.
 */
export async function meetsMinimumTier(
  userId: string,
  minimumTier: SubscriptionPlan
): Promise<{ meets: boolean; effectivePlan: SubscriptionPlan }> {
  const info = await getSubscriptionInfo(userId);
  const userRank = PLAN_RANK[info.plan] ?? 0;
  const requiredRank = PLAN_RANK[minimumTier] ?? 0;
  return { meets: userRank >= requiredRank, effectivePlan: info.plan };
}
