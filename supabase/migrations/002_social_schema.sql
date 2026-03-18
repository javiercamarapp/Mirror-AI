-- ============================================================================
-- Mirror-AI: Social & Interaction Schema Migration
-- Description: Social posts, stories, friendships, notifications, trips,
--              moodboards, VTON usage, and affiliate tracking
-- ============================================================================

-- ============================================================================
-- Social posts
-- ============================================================================
CREATE TABLE social_posts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('outfit', 'story', 'rating', 'challenge')),
  image_url TEXT,
  caption TEXT,
  occasion TEXT,
  outfit_id UUID REFERENCES outfits(id),
  outfit_data JSONB,
  score NUMERIC,
  likes_count INTEGER DEFAULT 0,
  comments_count INTEGER DEFAULT 0,
  is_public BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- Stories (24h ephemeral content)
-- ============================================================================
CREATE TABLE stories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  caption TEXT,
  outfit_data JSONB,
  views_count INTEGER DEFAULT 0,
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '24 hours'),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- Likes
-- ============================================================================
CREATE TABLE post_likes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id UUID REFERENCES social_posts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(post_id, user_id)
);

-- ============================================================================
-- Comments
-- ============================================================================
CREATE TABLE post_comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id UUID REFERENCES social_posts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- Story views
-- ============================================================================
CREATE TABLE story_views (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  story_id UUID REFERENCES stories(id) ON DELETE CASCADE,
  viewer_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(story_id, viewer_id)
);

-- ============================================================================
-- Friendships
-- ============================================================================
CREATE TABLE friendships (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  requester_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
  addressee_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'blocked')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(requester_id, addressee_id)
);

-- ============================================================================
-- Notifications
-- ============================================================================
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  data JSONB DEFAULT '{}'::jsonb,
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- Trips
-- ============================================================================
CREATE TABLE trips (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  destination TEXT,
  start_date DATE,
  end_date DATE,
  outfit_ids UUID[],
  packing_list JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- Moodboards
-- ============================================================================
CREATE TABLE moodboards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  items JSONB DEFAULT '[]'::jsonb,
  cover_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- VTON usage tracking
-- ============================================================================
CREATE TABLE vton_usage (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
  garment_item_id UUID REFERENCES wardrobe_items(id),
  result_image_url TEXT,
  credits_used INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- Affiliate tracking
-- ============================================================================
CREATE TABLE affiliate_clicks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
  store TEXT,
  product_name TEXT,
  product_url TEXT,
  clicked_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- Indexes
-- ============================================================================
CREATE INDEX idx_posts_user ON social_posts(user_id);
CREATE INDEX idx_posts_created ON social_posts(created_at DESC);
CREATE INDEX idx_posts_type ON social_posts(type);
CREATE INDEX idx_stories_user ON stories(user_id);
CREATE INDEX idx_stories_expires ON stories(expires_at);
CREATE INDEX idx_likes_post ON post_likes(post_id);
CREATE INDEX idx_comments_post ON post_comments(post_id);
CREATE INDEX idx_friendships_requester ON friendships(requester_id);
CREATE INDEX idx_friendships_addressee ON friendships(addressee_id);
CREATE INDEX idx_friendships_status ON friendships(status);
CREATE INDEX idx_notifications_user ON notifications(user_id, read);
CREATE INDEX idx_trips_user ON trips(user_id);
CREATE INDEX idx_vton_user ON vton_usage(user_id);

-- ============================================================================
-- Row Level Security
-- ============================================================================
ALTER TABLE social_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE stories ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE story_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE friendships ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE moodboards ENABLE ROW LEVEL SECURITY;
ALTER TABLE vton_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE affiliate_clicks ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- RLS Policies: Social posts (visible to friends or public)
-- ============================================================================
CREATE POLICY "Users manage own posts" ON social_posts FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can view friends posts" ON social_posts FOR SELECT USING (
  is_public = true OR
  auth.uid() = user_id OR
  EXISTS (
    SELECT 1 FROM friendships
    WHERE status = 'accepted'
    AND ((requester_id = auth.uid() AND addressee_id = social_posts.user_id)
      OR (addressee_id = auth.uid() AND requester_id = social_posts.user_id))
  )
);

-- ============================================================================
-- RLS Policies: Stories (visible to friends)
-- ============================================================================
CREATE POLICY "Users manage own stories" ON stories FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can view friends stories" ON stories FOR SELECT USING (
  auth.uid() = user_id OR
  EXISTS (
    SELECT 1 FROM friendships
    WHERE status = 'accepted'
    AND ((requester_id = auth.uid() AND addressee_id = stories.user_id)
      OR (addressee_id = auth.uid() AND requester_id = stories.user_id))
  )
);

-- ============================================================================
-- RLS Policies: Likes, comments, story views
-- ============================================================================
CREATE POLICY "Users manage own likes" ON post_likes FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can view likes" ON post_likes FOR SELECT USING (true);
CREATE POLICY "Users manage own comments" ON post_comments FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can view comments" ON post_comments FOR SELECT USING (true);
CREATE POLICY "Users manage own story views" ON story_views FOR ALL USING (auth.uid() = viewer_id);

-- ============================================================================
-- RLS Policies: Friendships
-- ============================================================================
CREATE POLICY "Users can see own friendships" ON friendships FOR SELECT USING (
  auth.uid() = requester_id OR auth.uid() = addressee_id
);
CREATE POLICY "Users can create friend requests" ON friendships FOR INSERT WITH CHECK (auth.uid() = requester_id);
CREATE POLICY "Users can update friendships" ON friendships FOR UPDATE USING (
  auth.uid() = requester_id OR auth.uid() = addressee_id
);
CREATE POLICY "Users can delete friendships" ON friendships FOR DELETE USING (
  auth.uid() = requester_id OR auth.uid() = addressee_id
);

-- ============================================================================
-- RLS Policies: Private user data
-- ============================================================================
CREATE POLICY "Users manage own notifications" ON notifications FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users manage own trips" ON trips FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users manage own moodboards" ON moodboards FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users manage own vton" ON vton_usage FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users manage own affiliate" ON affiliate_clicks FOR ALL USING (auth.uid() = user_id);

-- ============================================================================
-- Triggers: auto-update updated_at
-- ============================================================================
CREATE TRIGGER set_updated_at_friendships BEFORE UPDATE ON friendships FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at_trips BEFORE UPDATE ON trips FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at_moodboards BEFORE UPDATE ON moodboards FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- Function: increment/decrement likes count
-- ============================================================================
CREATE OR REPLACE FUNCTION increment_likes_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE social_posts SET likes_count = likes_count + 1 WHERE id = NEW.post_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION decrement_likes_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE social_posts SET likes_count = GREATEST(likes_count - 1, 0) WHERE id = OLD.post_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_like_added AFTER INSERT ON post_likes FOR EACH ROW EXECUTE FUNCTION increment_likes_count();
CREATE TRIGGER on_like_removed AFTER DELETE ON post_likes FOR EACH ROW EXECUTE FUNCTION decrement_likes_count();

-- ============================================================================
-- Function: increment/decrement comments count
-- ============================================================================
CREATE OR REPLACE FUNCTION increment_comments_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE social_posts SET comments_count = comments_count + 1 WHERE id = NEW.post_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION decrement_comments_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE social_posts SET comments_count = GREATEST(comments_count - 1, 0) WHERE id = OLD.post_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_comment_added AFTER INSERT ON post_comments FOR EACH ROW EXECUTE FUNCTION increment_comments_count();
CREATE TRIGGER on_comment_removed AFTER DELETE ON post_comments FOR EACH ROW EXECUTE FUNCTION decrement_comments_count();

-- ============================================================================
-- Function: increment story views
-- ============================================================================
CREATE OR REPLACE FUNCTION increment_story_views()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE stories SET views_count = views_count + 1 WHERE id = NEW.story_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_story_viewed AFTER INSERT ON story_views FOR EACH ROW EXECUTE FUNCTION increment_story_views();

-- ============================================================================
-- Function: update streak on daily outfit save
-- ============================================================================
CREATE OR REPLACE FUNCTION update_streak()
RETURNS TRIGGER AS $$
DECLARE
  yesterday_exists BOOLEAN;
  current_streak INTEGER;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM daily_outfits
    WHERE user_id = NEW.user_id AND date = NEW.date - 1
  ) INTO yesterday_exists;

  IF yesterday_exists THEN
    UPDATE user_profiles
    SET streak_count = streak_count + 1,
        longest_streak = GREATEST(longest_streak, streak_count + 1)
    WHERE id = NEW.user_id;
  ELSE
    UPDATE user_profiles SET streak_count = 1 WHERE id = NEW.user_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_daily_outfit_saved AFTER INSERT ON daily_outfits FOR EACH ROW EXECUTE FUNCTION update_streak();

-- ============================================================================
-- Function: generate referral code on profile creation
-- ============================================================================
CREATE OR REPLACE FUNCTION generate_referral_code()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.referral_code IS NULL THEN
    NEW.referral_code = 'MIR-' || UPPER(SUBSTRING(MD5(NEW.id::TEXT) FROM 1 FOR 8));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_referral_code BEFORE INSERT ON user_profiles FOR EACH ROW EXECUTE FUNCTION generate_referral_code();

-- ============================================================================
-- Views for common queries
-- ============================================================================
CREATE OR REPLACE VIEW active_stories AS
SELECT s.*, up.full_name, up.username, up.avatar_url
FROM stories s
JOIN user_profiles up ON s.user_id = up.id
WHERE s.expires_at > NOW();

CREATE OR REPLACE VIEW friend_pairs AS
SELECT
  CASE WHEN requester_id < addressee_id THEN requester_id ELSE addressee_id END AS user_a,
  CASE WHEN requester_id < addressee_id THEN addressee_id ELSE requester_id END AS user_b
FROM friendships
WHERE status = 'accepted';
