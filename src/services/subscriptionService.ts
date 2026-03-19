import { supabaseAdmin } from './supabase.js';
import type { SubscriptionPlan } from '../types/index.js';

// ─── Plan Definitions ────────────────────────────────────────────────────────

export interface PlanLimits {
  wardrobe_limit: number;
  vton_credits_monthly: number;
  ai_chats_daily: number;
}

const PLAN_LIMITS: Record<SubscriptionPlan, PlanLimits> = {
  free: { wardrobe_limit: 50, vton_credits_monthly: 3, ai_chats_daily: 10 },
  basic: { wardrobe_limit: 200, vton_credits_monthly: 15, ai_chats_daily: 50 },
  premium: { wardrobe_limit: -1, vton_credits_monthly: 50, ai_chats_daily: -1 },
};

const PLAN_RANK: Record<string, number> = {
  free: 0,
  basic: 1,
  premium: 2,
};

// ─── Subscription Status ─────────────────────────────────────────────────────

export type SubscriptionStatus = 'active' | 'trial' | 'expired' | 'free';

export interface SubscriptionInfo {
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  limits: PlanLimits;
  trialEndDate: string | null;
  isTrialActive: boolean;
}

/**
 * Centralized subscription service.
 * Checks subscription status, returns current plan with all limits,
 * and handles trial expiry logic in one place.
 */
export async function getSubscriptionInfo(userId: string): Promise<SubscriptionInfo> {
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

  return {
    plan: effectivePlan,
    status,
    limits: PLAN_LIMITS[effectivePlan],
    trialEndDate,
    isTrialActive,
  };
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
