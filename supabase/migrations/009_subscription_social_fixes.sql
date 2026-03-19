-- 009_subscription_social_fixes.sql
-- Subscription and social feature gap fixes

-- A) Add platform column to subscription_history
ALTER TABLE subscription_history ADD COLUMN IF NOT EXISTS platform TEXT DEFAULT 'ios';

-- B) Add missing Apple webhook notification types handling support
-- Add grace_period_expires_at to subscription_history
ALTER TABLE subscription_history ADD COLUMN IF NOT EXISTS grace_period_expires_at TIMESTAMPTZ;
ALTER TABLE subscription_history ADD COLUMN IF NOT EXISTS auto_renew_status BOOLEAN DEFAULT true;

-- C) Add comment delete support
-- (soft_delete_comment already exists from 008, just need endpoint)

-- D) Add blocked_users list endpoint support (no schema change needed)

-- E) Add share URL block verification index
CREATE INDEX IF NOT EXISTS idx_user_blocks_both ON user_blocks(blocker_id, blocked_id);

-- F) Add notification types for moderation
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS notification_type TEXT DEFAULT 'general';

-- G) Fix hidden_posts usage - add index for feed exclusion
CREATE INDEX IF NOT EXISTS idx_hidden_posts_user ON hidden_posts(user_id, post_id);

-- H) Add rate limit for friend requests per target
CREATE INDEX IF NOT EXISTS idx_friendships_target_pending ON friendships(addressee_id, status, created_at) WHERE status = 'pending';
