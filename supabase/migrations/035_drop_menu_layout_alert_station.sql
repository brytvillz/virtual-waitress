-- 035: Drop columns orphaned by the Stage 8 menu redesign.
--
-- menu_layout: three layouts collapsed to one (accordion category screen).
-- alert_station_screen: toggle removed in commit a6251a0; nothing reads it.

ALTER TABLE public.restaurants DROP COLUMN IF EXISTS menu_layout;
ALTER TABLE public.restaurants DROP COLUMN IF EXISTS alert_station_screen;
