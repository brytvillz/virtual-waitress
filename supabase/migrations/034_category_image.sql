-- 034: Add image_url to menu_categories.
-- Nullable; existing rows are unaffected.
-- The customer menu falls back to the emoji when null.
ALTER TABLE public.menu_categories ADD COLUMN IF NOT EXISTS image_url TEXT;
