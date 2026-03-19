import { Hono } from 'hono';
import { supabaseAdmin } from '../services/supabase.js';
import { authMiddleware } from '../middleware/auth.js';
import { logger } from '../services/logger.js';
import type { AppVariables } from '../types/index.js';
import { v4 as uuidv4 } from 'uuid';
import { verifyTransaction, verifySignedPayload } from '../services/appstore.js';
import { PLAN_LIMITS, CREDITS_BY_PLAN, PRODUCT_TO_PLAN, invalidateSubscriptionCache } from '../services/subscriptionService.js';

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
      case 'SUBSCRIBED': {
        // Initial subscription purchase via webhook (e.g. family sharing or promo)
        if (!transactionData?.originalTransactionId) break;

        // Idempotency check
        if (transactionData.transactionId) {
          const { data: existingTxn } = await supabaseAdmin
            .from('subscription_history')
            .select('id')
            .eq('transaction_id', transactionData.transactionId)
            .maybeSingle();

          if (existingTxn) {
            logger.info({ transactionId: transactionData.transactionId }, 'SUBSCRIBED already processed, skipping');
            break;
          }
        }

        // Determine plan from product ID
        const productId = transactionData.productId;
        const plan = productId ? (PRODUCT_TO_PLAN[productId] ?? 'basic') : 'basic';
        const newExpiry = transactionData.expiresDate ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

        // We need to find the user by original transaction — look up any existing record
        const { data: existingSub } = await supabaseAdmin
          .from('subscription_history')
          .select('user_id')
          .eq('transaction_id', transactionData.originalTransactionId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (existingSub) {
          const { error: insertError } = await supabaseAdmin.from('subscription_history').insert({
            id: uuidv4(),
            user_id: existingSub.user_id,
            product_id: productId ?? null,
            plan,
            status: 'active',
            transaction_id: transactionData.transactionId,
            platform: 'ios',
            expires_at: newExpiry,
            auto_renew_status: true,
          });

          if (!insertError) {
            const credits = CREDITS_BY_PLAN[plan] ?? 3;
            await supabaseAdmin.rpc('increment_credits_atomic', {
              p_user_id: existingSub.user_id,
              p_amount: credits,
              p_request_id: transactionData.transactionId ?? uuidv4(),
            });

            await supabaseAdmin
              .from('user_profiles')
              .update({ subscription_plan: plan })
              .eq('id', existingSub.user_id);

            invalidateSubscriptionCache(existingSub.user_id);
          }
        }
        break;
      }

      case 'DID_RENEW': {
        if (!transactionData?.originalTransactionId) break;

        // Idempotency: check if this transaction was already processed
        if (transactionData.transactionId) {
          const { data: existingTxn } = await supabaseAdmin
            .from('subscription_history')
            .select('id')
            .eq('transaction_id', transactionData.transactionId)
            .maybeSingle();

          if (existingTxn) {
            logger.info({ transactionId: transactionData.transactionId }, 'DID_RENEW already processed, skipping');
            break;
          }
        }

        // Find subscription by original transaction id
        const { data: sub } = await supabaseAdmin
          .from('subscription_history')
          .select('*')
          .eq('transaction_id', transactionData.originalTransactionId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (sub) {
          const newExpiry = transactionData.expiresDate ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

          // Insert new subscription record for the renewal
          const { error: insertError } = await supabaseAdmin.from('subscription_history').insert({
            id: uuidv4(),
            user_id: sub.user_id,
            product_id: sub.product_id,
            plan: sub.plan,
            status: 'active',
            transaction_id: transactionData.transactionId,
            platform: 'ios',
            expires_at: newExpiry,
            auto_renew_status: true,
          });

          if (insertError) {
            logger.error({ err: insertError }, 'DID_RENEW: Failed to insert subscription history');
            break;
          }

          // Reset credits atomically — no fallback to direct update
          const renewPlan = sub.plan ?? 'free';
          const credits = CREDITS_BY_PLAN[renewPlan] ?? 3;
          await supabaseAdmin.rpc('increment_credits_atomic', {
            p_user_id: sub.user_id,
            p_amount: credits,
            p_request_id: transactionData.transactionId ?? uuidv4(),
          });

          await supabaseAdmin
            .from('user_profiles')
            .update({ subscription_plan: renewPlan })
            .eq('id', sub.user_id);

          invalidateSubscriptionCache(sub.user_id);
        }
        break;
      }

      case 'DID_CHANGE_RENEWAL_PREF': {
        // User changed their auto-renewal preference (product change)
        if (!transactionData?.originalTransactionId) break;

        const { data: sub } = await supabaseAdmin
          .from('subscription_history')
          .select('*')
          .eq('transaction_id', transactionData.originalTransactionId)
          .in('status', ['active', 'billing_retry'])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (sub) {
          // The auto-renewal product may have changed; log it
          logger.info({
            userId: sub.user_id,
            originalTransactionId: transactionData.originalTransactionId,
            autoRenewProductId: transactionData.autoRenewProductId,
          }, 'DID_CHANGE_RENEWAL_PREF received');

          await supabaseAdmin
            .from('subscription_history')
            .update({
              auto_renew_status: transactionData.autoRenewStatus ?? true,
            })
            .eq('id', sub.id);
        }
        break;
      }

      case 'DID_CHANGE_RENEWAL_STATUS': {
        // User enabled/disabled auto-renewal
        if (!transactionData?.originalTransactionId) break;

        const { data: sub } = await supabaseAdmin
          .from('subscription_history')
          .select('*')
          .eq('transaction_id', transactionData.originalTransactionId)
          .in('status', ['active', 'billing_retry'])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (sub) {
          const autoRenew = transactionData.autoRenewStatus ?? false;
          logger.info({
            userId: sub.user_id,
            autoRenew,
          }, 'DID_CHANGE_RENEWAL_STATUS received');

          await supabaseAdmin
            .from('subscription_history')
            .update({ auto_renew_status: autoRenew })
            .eq('id', sub.id);
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
          .maybeSingle();

        if (sub) {
          await supabaseAdmin
            .from('subscription_history')
            .update({ status: 'billing_retry' })
            .eq('id', sub.id);
        }
        break;
      }

      case 'GRACE_PERIOD_EXPIRED': {
        // Billing grace period has expired — downgrade the user
        if (!transactionData?.originalTransactionId) break;

        const { data: sub } = await supabaseAdmin
          .from('subscription_history')
          .select('*')
          .eq('transaction_id', transactionData.originalTransactionId)
          .in('status', ['active', 'billing_retry'])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (sub) {
          await supabaseAdmin
            .from('subscription_history')
            .update({ status: 'expired', grace_period_expires_at: new Date().toISOString() })
            .eq('id', sub.id);

          // Downgrade user to free
          await supabaseAdmin
            .from('user_profiles')
            .update({ subscription_plan: 'free', vton_credits: CREDITS_BY_PLAN['free'] ?? 3 })
            .eq('id', sub.user_id);

          invalidateSubscriptionCache(sub.user_id);
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
          .maybeSingle();

        if (sub) {
          await supabaseAdmin
            .from('subscription_history')
            .update({ status: 'expired' })
            .eq('id', sub.id);

          // Downgrade user to free
          await supabaseAdmin
            .from('user_profiles')
            .update({ subscription_plan: 'free', vton_credits: CREDITS_BY_PLAN['free'] ?? 3 })
            .eq('id', sub.user_id);

          invalidateSubscriptionCache(sub.user_id);
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
          .maybeSingle();

        if (sub) {
          await supabaseAdmin
            .from('subscription_history')
            .update({ status: 'refunded' })
            .eq('id', sub.id);

          // Downgrade user to free
          await supabaseAdmin
            .from('user_profiles')
            .update({ subscription_plan: 'free', vton_credits: CREDITS_BY_PLAN['free'] ?? 3 })
            .eq('id', sub.user_id);

          invalidateSubscriptionCache(sub.user_id);
        }
        break;
      }

      default:
        logger.info({ notificationType }, 'App Store Webhook: unhandled notification type');
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

// Plan limits, credits, and product mapping imported from subscriptionService (single source of truth)

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
        .maybeSingle();

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
      logger.error({ err: historyError }, 'Failed to create subscription history');
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
      .maybeSingle();

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
      .maybeSingle();

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

    // Idempotency: check if this transaction was already processed
    const { data: existingPurchase } = await supabaseAdmin
      .from('purchases')
      .select('id')
      .eq('transaction_id', body.transaction_id)
      .maybeSingle();

    if (existingPurchase) {
      return c.json({ success: false, error: 'Transaction already processed' }, 409);
    }

    // Insert purchase record first (acts as idempotency lock via transaction_id)
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
      logger.error({ err: purchaseError }, 'Failed to create purchase record');
      return c.json({ success: false, error: 'Failed to record purchase' }, 500);
    }

    // Add credits atomically using RPC — no fallback to preserve atomicity
    const { data: newCredits, error: creditError } = await supabaseAdmin
      .rpc('increment_credits_atomic', {
        p_user_id: userId,
        p_amount: pack.credits ?? 0,
        p_request_id: body.transaction_id,
      });

    if (creditError) {
      logger.error({ err: creditError }, 'Atomic credit increment failed');
      return c.json({ success: false, error: 'Failed to add credits' }, 500);
    }
    const updatedCredits: number = newCredits;
    invalidateSubscriptionCache(userId);

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
