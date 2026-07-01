-- Add menu_layout column so managers can choose how their menu looks to customers
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS menu_layout TEXT DEFAULT 'magazine';
