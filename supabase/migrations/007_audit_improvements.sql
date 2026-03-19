-- ============================================================================
-- Migration 007: Audit Improvements
-- Soft deletes, audit logging, data retention, subscription uniqueness,
-- content moderation, push notification preferences, share tracking,
-- missing indexes, and additional constraints
-- ============================================================================

-- ============================================
-- 1. SOFT DELETES
-- Add deleted_at column to support soft deletion
-- ============================================
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE post_comments ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Partial indexes for efficient queries on non-deleted records
CREATE INDEX IF NOT EXISTS idx_posts_not_deleted ON social_posts(id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_comments_not_deleted ON post_comments(id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_purchases_not_deleted ON purchases(id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_profiles_not_deleted ON user_profiles(id) WHERE deleted_at IS NULL;

-- ============================================
-- Update RLS policies to exclude soft-deleted records
-- ============================================

-- social_posts: drop and recreate SELECT policies with deleted_at filter
DROP POLICY IF EXISTS "Users can view friends posts" ON social_posts;
CREATE POLICY "Users can view friends posts" ON social_posts FOR SELECT USING (
  deleted_at IS NULL AND (
    is_public = true OR
    auth.uid() = user_id OR
    EXISTS (
      SELECT 1 FROM friendships
      WHERE status = 'accepted'
      AND ((requester_id = auth.uid() AND addressee_id = social_posts.user_id)
        OR (addressee_id = auth.uid() AND requester_id = social_posts.user_id))
    )
  )
);

-- post_comments: drop and recreate SELECT policy with deleted_at filter
DROP POLICY IF EXISTS "Users can view comments" ON post_comments;
CREATE POLICY "Users can view comments" ON post_comments FOR SELECT USING (
  deleted_at IS NULL
);

-- user_profiles: drop and recreate SELECT policy with deleted_at filter
DROP POLICY IF EXISTS "Users can view own profile" ON user_profiles;
CREATE POLICY "Users can view own profile" ON user_profiles FOR SELECT USING (
  auth.uid() = id AND deleted_at IS NULL
);

-- ============================================
-- 2. AUDIT LOG TABLE
-- Tracks all changes to critical tables
-- ============================================
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name TEXT NOT NULL,
  record_id UUID NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  old_data JSONB,
  new_data JSONB,
  ip_address INET,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_table ON audit_log(table_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_record ON audit_log(record_id);

-- Audit trigger function: captures old/new data and the acting user
CREATE OR REPLACE FUNCTION audit_trigger_func()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_log (table_name, record_id, operation, user_id, new_data)
    VALUES (TG_TABLE_NAME, NEW.id, 'INSERT', auth.uid(), to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_log (table_name, record_id, operation, user_id, old_data, new_data)
    VALUES (TG_TABLE_NAME, NEW.id, 'UPDATE', auth.uid(), to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO audit_log (table_name, record_id, operation, user_id, old_data)
    VALUES (TG_TABLE_NAME, OLD.id, 'DELETE', auth.uid(), to_jsonb(OLD));
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Apply audit triggers to critical tables
DO $$ BEGIN
  CREATE TRIGGER audit_user_profiles
    AFTER INSERT OR UPDATE OR DELETE ON user_profiles
    FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER audit_purchases
    AFTER INSERT OR UPDATE OR DELETE ON purchases
    FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER audit_subscription_history
    AFTER INSERT OR UPDATE OR DELETE ON subscription_history
    FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER audit_social_posts
    AFTER INSERT OR UPDATE OR DELETE ON social_posts
    FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================
-- 3. DATA RETENTION
-- Function to clean old data on a schedule
-- ============================================
CREATE OR REPLACE FUNCTION cleanup_old_data()
RETURNS void AS $$
BEGIN
  -- Delete analytics events older than 90 days
  DELETE FROM analytics_events WHERE created_at < NOW() - INTERVAL '90 days';

  -- Delete expired stories and their views (older than 48h past expiry)
  DELETE FROM stories WHERE expires_at < NOW() - INTERVAL '48 hours';

  -- Clean old rate limit entries
  PERFORM clean_rate_limits();

  -- Delete soft-deleted records older than 30 days
  DELETE FROM social_posts WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '30 days';
  DELETE FROM post_comments WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '30 days';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 4. SUBSCRIPTION UNIQUENESS
-- Prevent multiple active subscriptions per user
-- ============================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_subscription
  ON subscription_history(user_id)
  WHERE status = 'active';

-- ============================================
-- 5. MISSING INDEXES
-- ============================================
-- Note: idx_friendships_status already exists in 002_social_schema.sql
CREATE INDEX IF NOT EXISTS idx_vton_usage_date ON vton_usage(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_posts_public ON social_posts(created_at DESC) WHERE is_public = true AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_comments_post_active ON post_comments(post_id, created_at) WHERE deleted_at IS NULL;

-- ============================================
-- 6. ADDITIONAL CHECK CONSTRAINTS
-- Expand valid subscription statuses
-- ============================================

-- Drop the existing check constraint before adding the expanded one
-- The status column was added in 004 with a narrower check
DO $$ BEGIN
  ALTER TABLE subscription_history DROP CONSTRAINT IF EXISTS subscription_history_status_check;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

ALTER TABLE subscription_history ADD CONSTRAINT chk_sub_status
  CHECK (status IN ('active', 'expired', 'cancelled', 'refunded', 'billing_retry', 'superseded'));

-- ============================================
-- 7. CONTENT MODERATION TABLES
-- ============================================
CREATE TABLE IF NOT EXISTS moderation_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('warn', 'suspend', 'ban', 'unsuspend')),
  reason TEXT,
  admin_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_moderation_user ON moderation_actions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_moderation_admin ON moderation_actions(admin_id, created_at DESC);

-- Add moderation status to user_profiles
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS moderation_status TEXT DEFAULT 'active'
  CHECK (moderation_status IN ('active', 'warned', 'suspended', 'banned'));
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS suspension_expires_at TIMESTAMPTZ;

-- ============================================
-- 8. PUSH NOTIFICATION IMPROVEMENTS
-- Add notification preferences to user_profiles
-- ============================================
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS notification_preferences JSONB
  DEFAULT '{"likes": true, "comments": true, "friend_requests": true, "mentions": true}'::jsonb;

-- ============================================
-- 9. SHARE TRACKING TABLE
-- Track when users share posts to external platforms
-- ============================================
CREATE TABLE IF NOT EXISTS post_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform TEXT, -- 'instagram', 'whatsapp', 'copy_link', etc.
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shares_post ON post_shares(post_id);
CREATE INDEX IF NOT EXISTS idx_shares_user ON post_shares(user_id);

ALTER TABLE post_shares ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own shares" ON post_shares FOR ALL USING (auth.uid() = user_id);
