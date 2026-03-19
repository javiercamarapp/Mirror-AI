import type { Context, Next } from 'hono';
import { supabaseAdmin } from '../services/supabase.js';
import { PLAN_LIMITS, PLAN_RANK } from '../services/subscriptionService.js';
import type { AppVariables, SubscriptionPlan } from '../types/index.js';

/**
 * Middleware factory that requires the user to have at least the specified
 * subscription tier. Fetches the user's current plan from the database
 * and rejects the request if the plan is insufficient.
 *
 * Must be applied AFTER authMiddleware so that userId is available.
 */
export function requireSubscription(minimumTier: 'basic' | 'premium') {
  return async (c: Context<{ Variables: AppVariables }>, next: Next): Promise<Response | void> => {
    const userId = c.get('userId');

    const { data: profile, error } = await supabaseAdmin
      .from('user_profiles')
      .select('subscription_plan, trial_end_date')
      .eq('id', userId)
      .single();

    if (error || !profile) {
      return c.json({ success: false, error: 'User profile not found' }, 404);
    }

    let effectivePlan: string = profile.subscription_plan ?? 'free';

    // Check if user is on an active trial
    if (effectivePlan !== 'premium' && profile.trial_end_date) {
      const trialEnd = new Date(profile.trial_end_date);
      if (trialEnd > new Date()) {
        // Trial is active -- treat as basic plan
        if ((PLAN_RANK[effectivePlan] ?? 0) < (PLAN_RANK['basic'] ?? 0)) {
          effectivePlan = 'basic';
        }
      }
    }

    const userRank = PLAN_RANK[effectivePlan] ?? 0;
    const requiredRank = PLAN_RANK[minimumTier] ?? 0;

    if (userRank < requiredRank) {
      return c.json(
        {
          success: false,
          error: `This feature requires a ${minimumTier} subscription or higher. Current plan: ${effectivePlan}.`,
        },
        403
      );
    }

    // Store the effective plan on context for downstream handlers
    c.set('subscriptionPlan', effectivePlan as SubscriptionPlan);
    await next();
  };
}

/**
 * Wardrobe item limits by plan — derived from the centralized PLAN_LIMITS.
 */
export const WARDROBE_LIMITS: Record<string, number> = {
  free: PLAN_LIMITS.free.wardrobe_limit,
  basic: PLAN_LIMITS.basic.wardrobe_limit,
  premium: PLAN_LIMITS.premium.wardrobe_limit,
};

/**
 * Daily AI chat limits by plan — derived from the centralized PLAN_LIMITS.
 */
export const AI_CHAT_DAILY_LIMITS: Record<string, number> = {
  free: PLAN_LIMITS.free.ai_chats_daily,
  basic: PLAN_LIMITS.basic.ai_chats_daily,
  premium: PLAN_LIMITS.premium.ai_chats_daily,
};

/**
 * Helper to get the user's current subscription plan from the database.
 * Returns the effective plan accounting for trial status.
 */
export async function getUserPlan(userId: string): Promise<SubscriptionPlan> {
  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('subscription_plan, trial_end_date')
    .eq('id', userId)
    .single();

  if (!profile) return 'free';

  let plan: SubscriptionPlan = (profile.subscription_plan as SubscriptionPlan) ?? 'free';

  // Check trial
  if (plan === 'free' && profile.trial_end_date) {
    const trialEnd = new Date(profile.trial_end_date);
    if (trialEnd > new Date()) {
      plan = 'basic';
    }
  }

  return plan;
}

/**
 * Check wardrobe item count against the user's plan limit.
 * Returns { allowed: true } or { allowed: false, limit, current }.
 */
export async function checkWardrobeLimit(userId: string): Promise<{
  allowed: boolean;
  limit: number;
  current: number;
}> {
  const plan = await getUserPlan(userId);
  const limit = WARDROBE_LIMITS[plan] ?? 50;

  // Unlimited
  if (limit < 0) {
    return { allowed: true, limit: -1, current: 0 };
  }

  const { count } = await supabaseAdmin
    .from('wardrobe_items')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);

  const current = count ?? 0;
  return { allowed: current < limit, limit, current };
}

/**
 * Check AI chat daily usage against the user's plan limit.
 * Uses an in-memory tracker for the current process. In production,
 * this should be backed by Redis or a database counter.
 */
const aiDailyUsage = new Map<string, { count: number; date: string }>();

/**
 * Periodic cleanup of stale entries in the aiDailyUsage Map.
 * Removes entries older than 1 day to prevent memory leaks.
 */
const AI_USAGE_CLEANUP_INTERVAL_MS = 60_000; // 60 seconds

setInterval(() => {
  const today = new Date().toISOString().slice(0, 10);
  for (const [key, entry] of aiDailyUsage) {
    if (entry.date !== today) {
      aiDailyUsage.delete(key);
    }
  }
}, AI_USAGE_CLEANUP_INTERVAL_MS).unref();

export function checkAIChatLimit(userId: string, plan: SubscriptionPlan): {
  allowed: boolean;
  limit: number;
  used: number;
} {
  const limit = AI_CHAT_DAILY_LIMITS[plan] ?? 10;

  // Unlimited
  if (limit < 0) {
    return { allowed: true, limit: -1, used: 0 };
  }

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const key = `${userId}:${today}`;
  const entry = aiDailyUsage.get(key);

  if (!entry || entry.date !== today) {
    aiDailyUsage.set(key, { count: 1, date: today });
    return { allowed: true, limit, used: 1 };
  }

  if (entry.count >= limit) {
    return { allowed: false, limit, used: entry.count };
  }

  entry.count++;
  return { allowed: true, limit, used: entry.count };
}
