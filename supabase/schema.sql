-- Virtual Waitress — initial schema
-- Run this in the Supabase SQL Editor (Project → SQL Editor → New query)

-- 1. Restaurants — one row per tenant on the SaaS
create table restaurants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,        -- used in URLs, e.g. ?r=nnewi-buka
  whatsapp    text,                        -- kept for now as a fallback contact method
  accent_color text default '#E8893A',
  created_at  timestamptz not null default now()
);

-- 2. Tables — physical tables inside a restaurant
create table tables (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  number        int not null,
  created_at    timestamptz not null default now(),
  unique (restaurant_id, number)            -- no duplicate "Table 4" within the same restaurant
);

-- 3. Orders — one row per "Place Order" tap
create table orders (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  table_number  int not null,
  status        text not null default 'pending'
                check (status in ('pending', 'preparing', 'served', 'cancelled')),
  total         int not null,               -- stored in kobo/naira as a whole number, no floats
  created_at    timestamptz not null default now()
);

-- 4. Order items — the dishes inside each order
create table order_items (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references orders(id) on delete cascade,
  item_name  text not null,
  quantity   int not null check (quantity > 0),
  price      int not null                  -- price per unit at time of order, in case menu prices change later
);

-- 5. Waiter calls — "Call Waiter" taps, separate from orders
create table waiter_calls (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  table_number  int not null,
  status        text not null default 'pending'
                check (status in ('pending', 'acknowledged')),
  created_at    timestamptz not null default now()
);

-- Helpful indexes for the waiter dashboard's "show me what's new" queries
create index idx_orders_restaurant_status on orders(restaurant_id, status);
create index idx_calls_restaurant_status on waiter_calls(restaurant_id, status);

-- 6. Push subscriptions — one row per staff device subscribed to Web Push
create table push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  endpoint      text not null unique,
  p256dh        text not null,
  auth          text not null,
  created_at    timestamptz not null default now()
);

alter table push_subscriptions enable row level security;

create policy "Staff can manage their own subscriptions"
  on push_subscriptions for all
  to authenticated
  using (true)
  with check (true);

-- 7. Staff — one row per login, links a Supabase Auth user to a restaurant + role
create table staff (
  id            uuid primary key references auth.users(id) on delete cascade,
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  name          text,
  role          text not null default 'waiter' check (role in ('waiter', 'manager')),
  created_at    timestamptz not null default now()
);

-- Helper functions — security definer so they bypass RLS when checking the
-- current user's own role/restaurant (avoids recursive-policy issues).
create or replace function public.current_staff_role()
returns text
language sql
security definer
stable
as $$
  select role from staff where id = auth.uid();
$$;

create or replace function public.current_staff_restaurant()
returns uuid
language sql
security definer
stable
as $$
  select restaurant_id from staff where id = auth.uid();
$$;

alter table staff enable row level security;

create policy "Staff can view their own row"
  on staff for select
  to authenticated
  using (id = auth.uid());

create policy "Managers can view staff in their restaurant"
  on staff for select
  to authenticated
  using (current_staff_role() = 'manager' and restaurant_id = current_staff_restaurant());

create policy "Managers can add staff in their restaurant"
  on staff for insert
  to authenticated
  with check (current_staff_role() = 'manager' and restaurant_id = current_staff_restaurant());

create policy "Managers can update staff in their restaurant"
  on staff for update
  to authenticated
  using (current_staff_role() = 'manager' and restaurant_id = current_staff_restaurant());

create policy "Managers can remove staff in their restaurant"
  on staff for delete
  to authenticated
  using (current_staff_role() = 'manager' and restaurant_id = current_staff_restaurant());

-- 8. Menu categories + items — replaces the hardcoded MENU_DATA in app.js
create table menu_categories (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  slug          text not null,
  name          text not null,
  emoji         text,
  ada_message   text,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  unique (restaurant_id, slug)
);

create table menu_items (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  category_id   uuid not null references menu_categories(id) on delete cascade,
  name          text not null,
  price         int not null,
  description   text,
  ada_message   text,
  available     boolean not null default true,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);

create index idx_menu_items_category on menu_items(category_id);

alter table menu_categories enable row level security;
alter table menu_items enable row level security;

-- Menu is public — customers (anon) need to read it to see the menu at all.
create policy "Anyone can view menu categories"
  on menu_categories for select
  using (true);

create policy "Anyone can view menu items"
  on menu_items for select
  using (true);

-- Only managers can add/remove categories, or change anything beyond availability on items.
create policy "Managers can manage categories"
  on menu_categories for all
  to authenticated
  using (current_staff_role() = 'manager' and restaurant_id = current_staff_restaurant())
  with check (current_staff_role() = 'manager' and restaurant_id = current_staff_restaurant());

create policy "Managers can insert items"
  on menu_items for insert
  to authenticated
  with check (current_staff_role() = 'manager' and restaurant_id = current_staff_restaurant());

create policy "Managers can delete items"
  on menu_items for delete
  to authenticated
  using (current_staff_role() = 'manager' and restaurant_id = current_staff_restaurant());

-- Both roles can attempt an update — the trigger below restricts what a waiter
-- is actually allowed to change to just the `available` column.
create policy "Staff can update items in their restaurant"
  on menu_items for update
  to authenticated
  using (restaurant_id = current_staff_restaurant())
  with check (restaurant_id = current_staff_restaurant());

create or replace function public.enforce_waiter_menu_update()
returns trigger
language plpgsql
as $$
begin
  if current_staff_role() = 'waiter' then
    if new.name is distinct from old.name
       or new.price is distinct from old.price
       or new.description is distinct from old.description
       or new.ada_message is distinct from old.ada_message
       or new.category_id is distinct from old.category_id
       or new.sort_order is distinct from old.sort_order then
      raise exception 'Waiters can only mark items available/sold out';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_enforce_waiter_menu_update
  before update on menu_items
  for each row execute function public.enforce_waiter_menu_update();

-- 9. Ada's messages move from app.js into the restaurant row
alter table restaurants add column if not exists ada_name text default 'Ada';
alter table restaurants add column if not exists ada_emoji text default '👩🏾‍🍳';
alter table restaurants add column if not exists ada_welcome text;
alter table restaurants add column if not exists ada_idle text;

update restaurants set
  ada_name = 'Ada',
  ada_emoji = '👩🏾‍🍳',
  ada_welcome = 'Welcome to Nnewi Buka! 👋🏾 I''m Ada, your virtual waitress. Browse the menu and tap any dish to learn more!',
  ada_idle = 'Take your time! When you''re ready, tap ''Call Waiter'' and I''ll send someone to your table right away 😊'
where id = '78698609-5135-4d35-8eb3-7f33dd828ecc';

-- 10. Seed the menu for Nnewi Buka (migrated from the old hardcoded MENU_DATA)
insert into menu_categories (restaurant_id, slug, name, emoji, ada_message, sort_order) values
('78698609-5135-4d35-8eb3-7f33dd828ecc', 'soups', 'Soups', '🥣', 'Our soups are made fresh every morning! 🥣 Tap any soup to learn more about it.', 1),
('78698609-5135-4d35-8eb3-7f33dd828ecc', 'swallows', 'Swallows', '🫓', 'Pounded yam is our most popular swallow! 😋 It pairs perfectly with any soup on our menu.', 2),
('78698609-5135-4d35-8eb3-7f33dd828ecc', 'rice', 'Rice Dishes', '🍚', 'Our Jollof Rice is smoky and cooked the party way 🍚 — the real deal, I promise!', 3),
('78698609-5135-4d35-8eb3-7f33dd828ecc', 'grills', 'Grills & Peppered', '🍗', 'Everything here is grilled fresh to order 🔥 The suya is an absolute must-try!', 4),
('78698609-5135-4d35-8eb3-7f33dd828ecc', 'small-chops', 'Small Chops', '🫔', 'Perfect for sharing or a light snack! Our puff puff is made fresh every morning 🤤', 5),
('78698609-5135-4d35-8eb3-7f33dd828ecc', 'drinks', 'Drinks', '🥤', '⭐ Special today: Buy 1 Guinness Stout, get 1 absolutely FREE! Don''t miss it 🍺', 6);

insert into menu_items (restaurant_id, category_id, name, price, description, ada_message, sort_order)
select '78698609-5135-4d35-8eb3-7f33dd828ecc', id, v.name, v.price, v.description, v.ada_message, v.sort_order
from menu_categories, (values
  ('Egusi Soup', 1500, 'Rich in protein and healthy fats, cooked with assorted meat', 'Egusi is loaded with protein and healthy fats — gives you real energy! Great with pounded yam 💪', 1),
  ('Ofe Onugbu', 1500, 'Bitterleaf soup with assorted meat and stockfish — a true Igbo classic', 'A true Igbo classic! The slight bitterness is what makes it special. Cooked just like mama would 😋', 2),
  ('Oha Soup', 1800, 'Seasonal delicacy with cocoyam thickener and oha leaves', 'Oha leaves are packed with vitamins A and C — very nutritious and only available seasonally! 🌿', 3),
  ('Ogbono Soup', 1500, 'Draw soup with assorted meat — smooth and filling', 'Ogbono is great for digestion and keeps you full for hours. A real comfort soup 👌', 4),
  ('Nsala Soup', 2000, 'White soup with fresh catfish — light and fragrant', 'Light and fresh! The catfish in this soup is delivered same morning. Very popular with our guests 🐟', 5),
  ('Ofe Akwu', 1500, 'Palm fruit soup — a true Eastern Nigerian classic', 'Rich in vitamin E and antioxidants — good for your skin and heart too! A real Eastern classic ✨', 6)
) as v(name, price, description, ada_message, sort_order)
where menu_categories.restaurant_id = '78698609-5135-4d35-8eb3-7f33dd828ecc' and menu_categories.slug = 'soups';

insert into menu_items (restaurant_id, category_id, name, price, description, ada_message, sort_order)
select '78698609-5135-4d35-8eb3-7f33dd828ecc', id, v.name, v.price, v.description, v.ada_message, v.sort_order
from menu_categories, (values
  ('Pounded Yam', 800, 'Smooth and satisfying — our most popular swallow', 'Our number one! Freshly pounded, smooth and stretchy — pairs with literally any soup on this menu 🤩', 1),
  ('Eba (Garri)', 400, 'Light and quick — perfect everyday meal', 'Eba is light on the stomach, very filling, and quick to prepare. A Nigerian staple for a reason!', 2),
  ('Fufu', 500, 'Traditional and filling — the original swallow', 'High in resistant starch which feeds the good bacteria in your gut — keeps you healthy inside out! 💚', 3),
  ('Semolina', 600, 'Smooth texture, easy on the stomach', 'Super smooth and easy to swallow — popular with our older guests and those with sensitive stomachs 😊', 4),
  ('Wheat', 600, 'High in fibre — the healthy swallow choice', 'The healthiest swallow we offer! High in fibre and nutrients — great for managing weight too 🌾', 5)
) as v(name, price, description, ada_message, sort_order)
where menu_categories.restaurant_id = '78698609-5135-4d35-8eb3-7f33dd828ecc' and menu_categories.slug = 'swallows';

insert into menu_items (restaurant_id, category_id, name, price, description, ada_message, sort_order)
select '78698609-5135-4d35-8eb3-7f33dd828ecc', id, v.name, v.price, v.description, v.ada_message, v.sort_order
from menu_categories, (values
  ('Jollof Rice', 1500, 'Smoky party-style jollof — cooked over firewood', 'This is the real deal! Smoky bottom-pot jollof cooked over firewood 🍚🔥 You will not regret it!', 1),
  ('Fried Rice', 1500, 'Colourful and flavourful with mixed vegetables and proteins', 'Colourful, flavourful, and loaded with vegetables — great for kids and adults alike! 🥕', 2),
  ('White Rice & Stew', 1200, 'Classic comfort food with rich tomato stew', 'Classic Nigerian comfort food — rich tomato stew, perfectly seasoned. Sometimes simple is best 🍅', 3),
  ('Coconut Rice', 1800, 'Fragrant and creamy — our weekend special', 'Our weekend special! Fragrant coconut rice that sells out fast — if you see it, grab it! 🥥', 4)
) as v(name, price, description, ada_message, sort_order)
where menu_categories.restaurant_id = '78698609-5135-4d35-8eb3-7f33dd828ecc' and menu_categories.slug = 'rice';

insert into menu_items (restaurant_id, category_id, name, price, description, ada_message, sort_order)
select '78698609-5135-4d35-8eb3-7f33dd828ecc', id, v.name, v.price, v.description, v.ada_message, v.sort_order
from menu_categories, (values
  ('Peppered Chicken', 2500, 'Spicy and tender — marinated and grilled to perfection', 'Marinated for hours before hitting the grill — the flavour goes all the way in! Seriously good 🔥', 1),
  ('Suya', 1500, 'Skewered beef with our secret spice blend', 'Our suya spice blend is a family secret — you will not find this flavour anywhere else in Nnewi! 🥩', 2),
  ('Peppered Gizzard', 1200, 'Crunchy, spicy, and completely addictive', 'High in protein, low in fat — and absolutely addictive! Most people order a second plate 😄', 3),
  ('Peppered Fish', 2000, 'Fresh catfish, heavily peppered and grilled', 'Fresh catfish delivered every morning, heavily peppered the Anambra way 🐟🔥 A real crowd favourite!', 4),
  ('Peppered Ponmo', 1000, 'Soft cow skin, peppered and stewed', 'A Nigerian favourite! Soft, chewy ponmo in our peppered sauce — great as a side or on its own 😋', 5)
) as v(name, price, description, ada_message, sort_order)
where menu_categories.restaurant_id = '78698609-5135-4d35-8eb3-7f33dd828ecc' and menu_categories.slug = 'grills';

insert into menu_items (restaurant_id, category_id, name, price, description, ada_message, sort_order)
select '78698609-5135-4d35-8eb3-7f33dd828ecc', id, v.name, v.price, v.description, v.ada_message, v.sort_order
from menu_categories, (values
  ('Puff Puff', 500, '6 pieces — soft, sweet, freshly fried every morning', 'Made fresh every single morning — soft, golden, and slightly sweet. The smell alone will get you! 🤤', 1),
  ('Meat Pie', 400, 'Flaky pastry filled with spiced minced meat', 'Baked fresh, never reheated! Flaky golden crust with perfectly spiced filling inside 🥧', 2),
  ('Moi Moi', 500, 'Steamed bean pudding — high in plant protein', 'Moi moi is loaded with plant protein — great for energy, muscle, and keeping you full 💪', 3),
  ('Spring Roll', 600, '4 pieces — crispy fried rolls with vegetable filling', 'Crispy on the outside, loaded with veggies inside — perfect for sharing with the table! 🥬', 4),
  ('Buns', 300, 'Sweet fried dough balls — a Nigerian childhood classic', 'A Nigerian childhood classic! Sweet, soft, and dangerously addictive. You have been warned 😄', 5)
) as v(name, price, description, ada_message, sort_order)
where menu_categories.restaurant_id = '78698609-5135-4d35-8eb3-7f33dd828ecc' and menu_categories.slug = 'small-chops';

insert into menu_items (restaurant_id, category_id, name, price, description, ada_message, sort_order)
select '78698609-5135-4d35-8eb3-7f33dd828ecc', id, v.name, v.price, v.description, v.ada_message, v.sort_order
from menu_categories, (values
  ('Coca-Cola', 300, 'Ice cold', 'Nothing beats an ice cold Coke with your meal — especially with the spicy dishes! 🥤', 1),
  ('Fanta Orange', 300, 'Ice cold', 'Sweet and fizzy — great for cooling down after our peppered dishes! 🍊', 2),
  ('Sprite', 300, 'Ice cold', 'Light and refreshing — perfect to cleanse the palate between dishes 💚', 3),
  ('Maltina', 400, 'Rich in B vitamins — great energy boost', 'Maltina is loaded with B vitamins — gives you a natural energy boost without the alcohol! 🌟', 4),
  ('Water (50cl)', 200, 'Ice cold', 'Stay hydrated! Especially important if you are having the peppered or spicy dishes 💧', 5),
  ('Trophy Lager', 600, 'Ice cold', 'Ice cold Trophy — smooth, crisp, and refreshing. The Anambra man''s drink of choice! 🍺', 6),
  ('Star Lager', 600, 'Ice cold', 'Star Lager — Nigeria''s favourite! Smooth and refreshing. Best enjoyed ice cold 🌟🍺', 7),
  ('Guinness Stout', 700, '⭐ Special offer today: Buy 1 get 1 FREE!', '⭐ TODAY ONLY: Buy 1 Guinness Stout, get 1 completely FREE! Call your waiter now to grab this deal 🍺🎉', 8),
  ('Chivita Juice', 500, 'Assorted flavours — apple, orange, mango', '100% fruit juice — great for kids, non-drinkers, or anyone who wants something sweet and healthy 🧃', 9)
) as v(name, price, description, ada_message, sort_order)
where menu_categories.restaurant_id = '78698609-5135-4d35-8eb3-7f33dd828ecc' and menu_categories.slug = 'drinks';

-- 11. Make your existing staff login a manager (you already created this user earlier)
-- Replace the UUID below with the user's id from Authentication → Users if it differs.
insert into staff (id, restaurant_id, name, role) values
('7875627b-64b6-4728-8861-59378ff5fdc5', '78698609-5135-4d35-8eb3-7f33dd828ecc', 'Manager', 'manager');

-- 12. Tagline was never a column — it lived only in the old hardcoded MENU_DATA
alter table restaurants add column if not exists tagline text;

update restaurants set tagline = 'Authentic Igbo Home Cooking'
where id = '78698609-5135-4d35-8eb3-7f33dd828ecc';

-- 13. Shift management: per-waiter table assignments + waiter performance tracking

alter table restaurants
  add column if not exists max_tables_per_waiter int not null default 3;

-- Physical tables defined by the restaurant
create table if not exists tables (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  table_number  int  not null,
  label         text,
  created_at    timestamptz not null default now(),
  unique(restaurant_id, table_number)
);
alter table tables enable row level security;

create policy "staff_read_tables"     on tables for select to authenticated using (restaurant_id = current_staff_restaurant());
create policy "manager_insert_tables" on tables for insert to authenticated with check (current_staff_role()='manager' and restaurant_id=current_staff_restaurant());
create policy "manager_update_tables" on tables for update to authenticated using (current_staff_role()='manager' and restaurant_id=current_staff_restaurant()) with check (current_staff_role()='manager' and restaurant_id=current_staff_restaurant());
create policy "manager_delete_tables" on tables for delete to authenticated using (current_staff_role()='manager' and restaurant_id=current_staff_restaurant());

-- Seed 15 tables for Nnewi Buka
insert into tables (restaurant_id, table_number, label)
select '78698609-5135-4d35-8eb3-7f33dd828ecc', n, 'Table ' || n
from generate_series(1, 15) as n
on conflict do nothing;

-- Daily shift assignments: one waiter per table per day
create table if not exists shift_assignments (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  waiter_id     uuid not null references staff(id) on delete cascade,
  table_id      uuid not null references tables(id) on delete cascade,
  assigned_date date not null default current_date,
  created_at    timestamptz not null default now(),
  unique(restaurant_id, table_id, assigned_date)
);
alter table shift_assignments enable row level security;

create policy "staff_read_assignments"    on shift_assignments for select to authenticated using (restaurant_id=current_staff_restaurant());
create policy "manager_insert_assignments" on shift_assignments for insert to authenticated with check (current_staff_role()='manager' and restaurant_id=current_staff_restaurant());
create policy "manager_delete_assignments" on shift_assignments for delete to authenticated using (current_staff_role()='manager' and restaurant_id=current_staff_restaurant());

-- Track which waiter handled each order (stamped when waiter clicks "Start Preparing")
alter table orders add column if not exists handled_by uuid references staff(id);
