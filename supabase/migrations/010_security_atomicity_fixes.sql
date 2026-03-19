-- 010_security_atomicity_fixes.sql
-- RLS for audit_log and referrals, atomic like/comment RPCs, admin role check

-- ============================================
-- 1. ENABLE RLS ON audit_log (admin-only access)
-- ============================================
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS audit_log_admin_read ON audit_log;
DROP POLICY IF EXISTS audit_log_system_insert ON audit_log;

-- Admin-only read access using a robust check via user_profiles or ADMIN_USER_IDS
-- Since audit_log inserts come from triggers (SECURITY DEFINER), we allow trigger inserts
-- but restrict SELECT to admins only.
CREATE POLICY audit_log_admin_read ON audit_log
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
        AND user_profiles.role = 'admin'
    )
  );

-- Allow inserts from trigger functions (they run as SECURITY DEFINER)
-- No insert policy needed since the trigger function is SECURITY DEFINER
-- But we need to ensure the trigger can still write:
CREATE POLICY audit_log_system_insert ON audit_log
  FOR INSERT
  WITH CHECK (true);

-- ============================================
-- 2. ENABLE RLS ON referrals
-- ============================================
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS referrals_user_read ON referrals;
DROP POLICY IF EXISTS referrals_user_insert ON referrals;

-- Users can read their own referrals (as referrer or referred)
CREATE POLICY referrals_user_read ON referrals
  FOR SELECT
  USING (
    referrer_id = auth.uid() OR referred_id = auth.uid()
  );

-- Users can create referrals where they are the referrer
CREATE POLICY referrals_user_insert ON referrals
  FOR INSERT
  WITH CHECK (referrer_id = auth.uid());

-- Admin can read all referrals
CREATE POLICY referrals_admin_read ON referrals
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
        AND user_profiles.role = 'admin'
    )
  );

-- ============================================
-- 3. Add role column to user_profiles if not exists
-- ============================================
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user'
  CHECK (role IN ('user', 'admin', 'moderator'));

-- ============================================
-- 4. ATOMIC LIKE/UNLIKE RPC FUNCTIONS
-- ============================================

-- Atomic like: insert like + increment counter in one transaction
CREATE OR REPLACE FUNCTION atomic_like_post(
  p_like_id UUID,
  p_post_id UUID,
  p_user_id UUID
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO post_likes (id, post_id, user_id)
  VALUES (p_like_id, p_post_id, p_user_id);

  UPDATE social_posts
  SET likes_count = COALESCE(likes_count, 0) + 1
  WHERE id = p_post_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Atomic unlike: delete like + decrement counter in one transaction
CREATE OR REPLACE FUNCTION atomic_unlike_post(
  p_like_id UUID,
  p_post_id UUID
)
RETURNS VOID AS $$
BEGIN
  DELETE FROM post_likes WHERE id = p_like_id;

  UPDATE social_posts
  SET likes_count = GREATEST(COALESCE(likes_count, 0) - 1, 0)
  WHERE id = p_post_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Atomic comment + increment: insert comment and increment counter
CREATE OR REPLACE FUNCTION atomic_add_comment(
  p_comment_id UUID,
  p_post_id UUID,
  p_user_id UUID,
  p_content TEXT
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO post_comments (id, post_id, user_id, content)
  VALUES (p_comment_id, p_post_id, p_user_id, p_content);

  UPDATE social_posts
  SET comments_count = COALESCE(comments_count, 0) + 1
  WHERE id = p_post_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
