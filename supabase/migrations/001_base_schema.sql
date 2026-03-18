-- ============================================================================
-- Mirror-AI: Base Schema Migration
-- Description: Core tables for user profiles, wardrobe, outfits, and daily logs
-- ============================================================================

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- 1. user_profiles
-- ============================================================================
CREATE TABLE user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  username TEXT UNIQUE,
  avatar_url TEXT,
  gender TEXT CHECK (gender IN ('male', 'female', 'non-binary')),
  age_range TEXT,
  body_shape TEXT,
  height_cm NUMERIC,
  weight_kg NUMERIC,
  skin_tone TEXT,
  color_season TEXT,
  style_preferences JSONB DEFAULT '[]'::jsonb,
  favorite_colors JSONB DEFAULT '[]'::jsonb,
  budget_range TEXT,
  lifestyle_occasions JSONB DEFAULT '[]'::jsonb,
  subscription_plan TEXT DEFAULT 'free' CHECK (subscription_plan IN ('free', 'basic', 'premium')),
  vton_credits INTEGER DEFAULT 3,
  streak_count INTEGER DEFAULT 0,
  longest_streak INTEGER DEFAULT 0,
  style_score NUMERIC DEFAULT 0,
  onboarding_completed BOOLEAN DEFAULT false,
  language TEXT DEFAULT 'es',
  referral_code TEXT UNIQUE,
  referred_by UUID REFERENCES user_profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- 2. onboarding_data (stores partial onboarding progress)
-- ============================================================================
CREATE TABLE onboarding_data (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
  step INTEGER DEFAULT 0,
  data JSONB DEFAULT '{}'::jsonb,
  completed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- 3. user_avatar_data (body photo + selfie for VTON)
-- ============================================================================
CREATE TABLE user_avatar_data (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID UNIQUE REFERENCES user_profiles(id) ON DELETE CASCADE,
  body_photo_url TEXT,
  selfie_url TEXT,
  processed_avatar_url TEXT,
  body_measurements JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- 4. wardrobe_items
-- ============================================================================
CREATE TABLE wardrobe_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
  name TEXT,
  category TEXT NOT NULL,
  subcategory TEXT,
  color TEXT,
  secondary_colors JSONB DEFAULT '[]'::jsonb,
  brand TEXT,
  image_url TEXT NOT NULL,
  image_no_bg_url TEXT,
  season TEXT[],
  occasions TEXT[],
  tags TEXT[],
  wear_count INTEGER DEFAULT 0,
  last_worn DATE,
  is_favorite BOOLEAN DEFAULT false,
  ai_description TEXT,
  ai_style_tags JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- 5. outfits (saved outfit combinations)
-- ============================================================================
CREATE TABLE outfits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
  name TEXT,
  item_ids UUID[] NOT NULL,
  occasion TEXT,
  score NUMERIC,
  ai_feedback JSONB,
  collage_url TEXT,
  is_favorite BOOLEAN DEFAULT false,
  worn_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- 6. daily_outfits (outfit of the day log)
-- ============================================================================
CREATE TABLE daily_outfits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  outfit_id UUID REFERENCES outfits(id),
  outfit_data JSONB,
  image_url TEXT,
  selfie_url TEXT,
  score NUMERIC,
  occasion TEXT,
  mood TEXT,
  weather TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, date)
);

-- ============================================================================
-- Indexes
-- ============================================================================
CREATE INDEX idx_wardrobe_user ON wardrobe_items(user_id);
CREATE INDEX idx_wardrobe_category ON wardrobe_items(user_id, category);
CREATE INDEX idx_outfits_user ON outfits(user_id);
CREATE INDEX idx_daily_outfits_user_date ON daily_outfits(user_id, date);

-- ============================================================================
-- Row Level Security
-- ============================================================================
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_avatar_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE wardrobe_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE outfits ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_outfits ENABLE ROW LEVEL SECURITY;

-- Policies: users can only access their own data
CREATE POLICY "Users can view own profile" ON user_profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON user_profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON user_profiles FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Users manage own onboarding" ON onboarding_data FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users manage own avatar" ON user_avatar_data FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users manage own wardrobe" ON wardrobe_items FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users manage own outfits" ON outfits FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users manage own daily outfits" ON daily_outfits FOR ALL USING (auth.uid() = user_id);

-- ============================================================================
-- Triggers: auto-update updated_at
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at_profiles BEFORE UPDATE ON user_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at_wardrobe BEFORE UPDATE ON wardrobe_items FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at_avatar BEFORE UPDATE ON user_avatar_data FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at_onboarding BEFORE UPDATE ON onboarding_data FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- Function: create profile automatically on auth signup
-- ============================================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO user_profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
