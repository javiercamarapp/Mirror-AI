import { Hono } from 'hono';
import { supabaseAdmin } from '../services/supabase.js';
import { authMiddleware } from '../middleware/auth.js';
import type { AppVariables } from '../types/index.js';
import { v4 as uuidv4 } from 'uuid';

const subscriptions = new Hono<{ Variables: AppVariables }>();

// All subscription routes require authentication
subscriptions.use('*', authMiddleware);

// Plan limits
const PLAN_LIMITS: Record<string, { wardrobe_limit: number; vton_credits_monthly: number; ai_chats_daily: number }> = {
  free: { wardrobe_limit: 50, vton_credits_monthly: 3, ai_chats_daily: 10 },
  basic: { wardrobe_limit: 200, vton_credits_monthly: 15, ai_chats_daily: 50 },
  premium: { wardrobe_limit: -1, vton_credits_monthly: 50, ai_chats_daily: -1 },
};

// Product ID to plan mapping
const PRODUCT_TO_PLAN: Record<string, string> = {
  'com.mirrorai.pro.monthly': 'basic',
  'com.mirrorai.premium.monthly': 'premium',
};

// Credits by plan
const CREDITS_BY_PLAN: Record<string, number> = {
  free: 3,
  basic: 15,
  premium: 50,
};

// ─── POST /subscriptions/verify ───────────────────────────────────────────────
// Verify receipt and activate subscription.
subscriptions.post('/verify', async (c) => {
  try {
    const userId = c.get('userId');
    const body = await c.req.json<{
      receipt_data: string;
      product_id: string;
      platform?: string;
    }>();

    if (!body.receipt_data || !body.product_id) {
      return c.json({ success: false, error: 'receipt_data and product_id are required' }, 400);
    }

    const plan = PRODUCT_TO_PLAN[body.product_id];
    if (!plan) {
      return c.json({ success: false, error: 'Invalid product_id' }, 400);
    }

    const newCredits = CREDITS_BY_PLAN[plan] ?? 3;

    // Create subscription history record
    const subscriptionId = uuidv4();
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + 1);

    const { error: historyError } = await supabaseAdmin
      .from('subscription_history')
      .insert({
        id: subscriptionId,
        user_id: userId,
        product_id: body.product_id,
        plan,
        status: 'active',
        receipt_data: body.receipt_data,
        platform: body.platform ?? null,
        expires_at: expiresAt.toISOString(),
      });

    if (historyError) {
      console.error('Failed to create subscription history:', historyError);
    }

    // Update user subscription plan and reset credits
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .update({
        subscription_plan: plan,
        vton_credits: newCredits,
      })
      .eq('id', userId)
      .select()
      .single();

    if (profileError) {
      return c.json({ success: false, error: profileError.message }, 500);
    }

    return c.json({
      success: true,
      data: {
        plan,
        limits: PLAN_LIMITS[plan] ?? PLAN_LIMITS.free,
        vton_credits: newCredits,
        expires_at: expiresAt.toISOString(),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── GET /subscriptions/status ────────────────────────────────────────────────
// Get current subscription status.
subscriptions.get('/status', async (c) => {
  try {
    const userId = c.get('userId');

    const { data: profile, error } = await supabaseAdmin
      .from('user_profiles')
      .select('subscription_plan, vton_credits')
      .eq('id', userId)
      .single();

    if (error || !profile) {
      return c.json({ success: false, error: 'Profile not found' }, 404);
    }

    const plan = profile.subscription_plan ?? 'free';

    // Get active subscription details including expiry
    const { data: activeSub } = await supabaseAdmin
      .from('subscription_history')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    // Check if subscription has expired
    if (activeSub?.expires_at && new Date(activeSub.expires_at) < new Date()) {
      // Subscription expired - downgrade
      await supabaseAdmin.from('user_profiles').update({ subscription_plan: 'free', vton_credits: 3 }).eq('id', userId);
      await supabaseAdmin.from('subscription_history').update({ status: 'expired' }).eq('id', activeSub.id);
      return c.json({
        success: true,
        data: {
          plan: 'free',
          limits: PLAN_LIMITS.free,
          vton_credits_remaining: 3,
          expires_at: null,
          active_subscription: null,
        },
      });
    }

    return c.json({
      success: true,
      data: {
        plan,
        limits: PLAN_LIMITS[plan] ?? PLAN_LIMITS.free,
        vton_credits_remaining: profile.vton_credits ?? 0,
        expires_at: activeSub?.expires_at ?? null,
        active_subscription: activeSub ?? null,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── POST /subscriptions/restore ──────────────────────────────────────────────
// Restore subscription from receipt.
subscriptions.post('/restore', async (c) => {
  try {
    const userId = c.get('userId');
    const body = await c.req.json<{
      receipt_data: string;
    }>();

    if (!body.receipt_data) {
      return c.json({ success: false, error: 'receipt_data is required' }, 400);
    }

    // Check subscription_history for an active subscription matching this receipt
    const { data: activeSub, error: subError } = await supabaseAdmin
      .from('subscription_history')
      .select('*')
      .eq('user_id', userId)
      .eq('receipt_data', body.receipt_data)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (subError || !activeSub) {
      return c.json({ success: false, error: 'No active subscription found for this receipt' }, 404);
    }

    // Check if subscription has expired
    if (activeSub.expires_at && new Date(activeSub.expires_at) < new Date()) {
      return c.json({ success: false, error: 'Subscription has expired' }, 400);
    }

    const plan = activeSub.plan ?? 'free';
    const newCredits = CREDITS_BY_PLAN[plan] ?? 3;

    // Restore the plan on user_profiles
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .update({
        subscription_plan: plan,
        vton_credits: newCredits,
      })
      .eq('id', userId)
      .select()
      .single();

    if (profileError) {
      return c.json({ success: false, error: profileError.message }, 500);
    }

    return c.json({
      success: true,
      data: {
        plan,
        limits: PLAN_LIMITS[plan] ?? PLAN_LIMITS.free,
        vton_credits: newCredits,
        expires_at: activeSub.expires_at,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── POST /subscriptions/purchases/credits ────────────────────────────────────
// Buy credit pack.
subscriptions.post('/purchases/credits', async (c) => {
  try {
    const userId = c.get('userId');
    const body = await c.req.json<{
      product_id: string;
      receipt_data: string;
      transaction_id: string;
    }>();

    if (!body.product_id || !body.receipt_data || !body.transaction_id) {
      return c.json({ success: false, error: 'product_id, receipt_data, and transaction_id are required' }, 400);
    }

    // Validate product_id exists in credit_packs table
    const { data: pack, error: packError } = await supabaseAdmin
      .from('credit_packs')
      .select('*')
      .eq('product_id', body.product_id)
      .eq('active', true)
      .single();

    if (packError || !pack) {
      return c.json({ success: false, error: 'Invalid or inactive credit pack' }, 400);
    }

    // Get current credits
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('vton_credits')
      .eq('id', userId)
      .single();

    if (profileError || !profile) {
      return c.json({ success: false, error: 'Profile not found' }, 404);
    }

    // Add credits to user
    const updatedCredits = (profile.vton_credits ?? 0) + (pack.credits ?? 0);
    const { error: updateError } = await supabaseAdmin
      .from('user_profiles')
      .update({ vton_credits: updatedCredits })
      .eq('id', userId);

    if (updateError) {
      return c.json({ success: false, error: updateError.message }, 500);
    }

    // Insert purchase record
    const { error: purchaseError } = await supabaseAdmin
      .from('purchases')
      .insert({
        id: uuidv4(),
        user_id: userId,
        product_id: body.product_id,
        transaction_id: body.transaction_id,
        type: 'credit_pack',
        receipt_data: body.receipt_data,
      });

    if (purchaseError) {
      console.error('Failed to create purchase record:', purchaseError);
    }

    return c.json({
      success: true,
      data: {
        credits_added: pack.credits,
        credits_total: updatedCredits,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── GET /subscriptions/purchases/packs ───────────────────────────────────────
// List available credit packs.
subscriptions.get('/purchases/packs', async (c) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('credit_packs')
      .select('*')
      .eq('active', true)
      .order('credits', { ascending: true });

    if (error) {
      return c.json({ success: false, error: error.message }, 500);
    }

    return c.json({
      success: true,
      data: data ?? [],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

export { subscriptions as subscriptionRoutes };
