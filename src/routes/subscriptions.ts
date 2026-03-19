import { Hono } from 'hono';
import { supabaseAdmin } from '../services/supabase.js';
import { authMiddleware } from '../middleware/auth.js';
import { logger } from '../services/logger.js';
import type { AppVariables } from '../types/index.js';
import { v4 as uuidv4 } from 'uuid';
import { verifyTransaction, verifySignedPayload } from '../services/appstore.js';

const subscriptions = new Hono<{ Variables: AppVariables }>();

// ─── POST /subscriptions/webhooks/appstore ───────────────────────────────────
// Apple App Store Server-to-Server notification v2 webhook (no auth needed).
// The body contains a `signedPayload` JWS that must be cryptographically verified.
subscriptions.post('/webhooks/appstore', async (c) => {
  try {
    const body = await c.req.json<{
      signedPayload?: string;
    }>();

    // Step 1: Require the signedPayload field
    if (!body.signedPayload) {
      logger.warn('App Store Webhook rejected: missing signedPayload');
      return c.json({ success: false, error: 'Missing signedPayload' }, 400);
    }

    // Step 2: Verify the JWS signature against Apple's certificate chain
    const notification = await verifySignedPayload(body.signedPayload);
    if (!notification) {
      logger.warn('App Store Webhook rejected: signature verification failed');
      return c.json({ success: false, error: 'Invalid webhook signature' }, 403);
    }

    const { notificationType, data: notificationData } = notification;

    logger.info({ notificationType }, 'App Store Webhook: verified notification');

    // Step 3: Verify the nested signedTransactionInfo if present
    let transactionData: Awaited<ReturnType<typeof verifyTransaction>> | null = null;
    if (notificationData?.signedTransactionInfo) {
      transactionData = await verifyTransaction(notificationData.signedTransactionInfo);
      if (!transactionData.isValid) {
        logger.warn('App Store Webhook rejected: nested transaction verification failed');
        return c.json({ success: false, error: 'Invalid transaction in notification' }, 400);
      }
    }

    switch (notificationType) {
      case 'DID_RENEW': {
        if (!transactionData?.originalTransactionId) break;

        // Find subscription by original transaction id
        const { data: sub } = await supabaseAdmin
          .from('subscription_history')
          .select('*')
          .eq('transaction_id', transactionData.originalTransactionId)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (sub) {
          const newExpiry = transactionData.expiresDate ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

          // Insert new subscription record for the renewal
          await supabaseAdmin.from('subscription_history').insert({
            id: uuidv4(),
            user_id: sub.user_id,
            product_id: sub.product_id,
            plan: sub.plan,
            status: 'active',
            transaction_id: transactionData.transactionId,
            platform: 'ios',
            expires_at: newExpiry,
          });

          // Reset credits
          const plan = sub.plan ?? 'free';
          const credits = CREDITS_BY_PLAN[plan] ?? 3;
          await supabaseAdmin
            .from('user_profiles')
            .update({ subscription_plan: plan, vton_credits: credits })
            .eq('id', sub.user_id);
        }
        break;
      }

      case 'DID_FAIL_TO_RENEW': {
        if (!transactionData?.originalTransactionId) break;

        const { data: sub } = await supabaseAdmin
          .from('subscription_history')
          .select('*')
          .eq('transaction_id', transactionData.originalTransactionId)
          .eq('status', 'active')
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (sub) {
          await supabaseAdmin
            .from('subscription_history')
            .update({ status: 'billing_retry' })
            .eq('id', sub.id);
        }
        break;
      }

      case 'EXPIRED': {
        if (!transactionData?.originalTransactionId) break;

        const { data: sub } = await supabaseAdmin
          .from('subscription_history')
          .select('*')
          .eq('transaction_id', transactionData.originalTransactionId)
          .in('status', ['active', 'billing_retry'])
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (sub) {
          await supabaseAdmin
            .from('subscription_history')
            .update({ status: 'expired' })
            .eq('id', sub.id);

          // Downgrade user to free
          await supabaseAdmin
            .from('user_profiles')
            .update({ subscription_plan: 'free', vton_credits: 3 })
            .eq('id', sub.user_id);
        }
        break;
      }

      case 'REFUND': {
        if (!transactionData?.transactionId) break;

        const { data: sub } = await supabaseAdmin
          .from('subscription_history')
          .select('*')
          .eq('transaction_id', transactionData.transactionId)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (sub) {
          await supabaseAdmin
            .from('subscription_history')
            .update({ status: 'refunded' })
            .eq('id', sub.id);

          // Downgrade user to free
          await supabaseAdmin
            .from('user_profiles')
            .update({ subscription_plan: 'free', vton_credits: 3 })
            .eq('id', sub.user_id);
        }
        break;
      }

      default:
        // Unknown notification type — acknowledge receipt
        break;
    }

    return c.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error({ err }, 'App Store Webhook error');
    return c.json({ success: false, error: message }, 500);
  }
});

// All remaining subscription routes require authentication
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

    // Verify the signed transaction
    const verification = await verifyTransaction(body.receipt_data);
    if (!verification.isValid) {
      return c.json({ success: false, error: 'Transaction verification failed' }, 400);
    }

    const plan = PRODUCT_TO_PLAN[body.product_id];
    if (!plan) {
      return c.json({ success: false, error: 'Invalid product_id' }, 400);
    }

    // Check for duplicate transaction_id (idempotency)
    if (verification.transactionId) {
      const { data: existingSub } = await supabaseAdmin
        .from('subscription_history')
        .select('id')
        .eq('transaction_id', verification.transactionId)
        .limit(1)
        .single();

      if (existingSub) {
        return c.json({ success: false, error: 'Transaction already processed' }, 409);
      }
    }

    const newCredits = CREDITS_BY_PLAN[plan] ?? 3;

    // Create subscription history record
    const subscriptionId = uuidv4();
    const expiresAt = verification.expiresDate
      ? new Date(verification.expiresDate)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const { error: historyError } = await supabaseAdmin
      .from('subscription_history')
      .insert({
        id: subscriptionId,
        user_id: userId,
        product_id: body.product_id,
        plan,
        status: 'active',
        receipt_data: body.receipt_data,
        transaction_id: verification.transactionId,
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

// ─── GET /subscriptions/trial/status ──────────────────────────────────────────
// Get trial status for the current user.
subscriptions.get('/trial/status', async (c) => {
  try {
    const userId = c.get('userId');

    const { data: profile } = await supabaseAdmin
      .from('user_profiles')
      .select('trial_end_date, subscription_plan, created_at')
      .eq('id', userId)
      .single();

    if (!profile) {
      return c.json({ success: false, error: 'Profile not found' }, 404);
    }

    let isTrialActive = false;
    let trialDaysRemaining = 0;

    if (profile.trial_end_date) {
      const trialEnd = new Date(profile.trial_end_date);
      const now = new Date();
      if (trialEnd > now) {
        isTrialActive = true;
        trialDaysRemaining = Math.ceil((trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      }
    }

    return c.json({
      success: true,
      data: {
        is_trial_active: isTrialActive,
        trial_days_remaining: trialDaysRemaining,
        trial_end_date: profile.trial_end_date,
        plan: profile.subscription_plan,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── POST /subscriptions/trial/start ─────────────────────────────────────────
// Start a 7-day free trial.
subscriptions.post('/trial/start', async (c) => {
  try {
    const userId = c.get('userId');

    const { data: profile } = await supabaseAdmin
      .from('user_profiles')
      .select('trial_end_date')
      .eq('id', userId)
      .single();

    if (!profile) {
      return c.json({ success: false, error: 'Profile not found' }, 404);
    }

    // Don't allow trial if already used
    if (profile.trial_end_date) {
      return c.json({ success: false, error: 'Trial has already been used' }, 400);
    }

    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + 7);

    const { error } = await supabaseAdmin
      .from('user_profiles')
      .update({
        trial_end_date: trialEnd.toISOString(),
        subscription_plan: 'basic',
      })
      .eq('id', userId);

    if (error) {
      return c.json({ success: false, error: error.message }, 500);
    }

    return c.json({
      success: true,
      data: {
        is_trial_active: true,
        trial_days_remaining: 7,
        trial_end_date: trialEnd.toISOString(),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

export { subscriptions as subscriptionRoutes };
