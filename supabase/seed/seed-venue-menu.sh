#!/usr/bin/env bash
# ============================================================
# seed-venue-menu.sh — seed menu categories and items for any venue
#
# USAGE
#   DATABASE_URL='postgresql://postgres:...' \
#     bash supabase/seed/seed-venue-menu.sh <slug> <csv-path>
#
# ARGUMENTS
#   slug      The restaurant slug (must already exist in the DB).
#   csv-path  Path to a CSV file with columns: group,item,price,station,confirm
#             "confirm" column is ignored.
#             station must be 'bar' or empty. Empty → NULL (no station).
#             'kitchen' is no longer a valid value; food items get no station.
#
# EXAMPLES
#   DATABASE_URL="$DB" bash supabase/seed/seed-venue-menu.sh test-bar supabase/seed/ichiban-menu.csv
#   DATABASE_URL="$DB" bash supabase/seed/seed-venue-menu.sh ichiban  supabase/seed/ichiban-menu.csv
#
# DATABASE_URL
#   Supabase Dashboard → Settings → Database
#   → Connection string → URI (direct connection, port 5432)
#   Format: postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres
#
# COUNTS REPORTED
#   total   = all rows in the CSV (bar + null-station combined)
#   bar     = rows with station='bar'
#   no-stn  = rows with empty station (food / vendor items)
#   The assertion checks all three against the DB after seeding.
#
# BEHAVIOUR
#   - Aborts loudly if the slug is not found.
#   - Skips categories if the venue already has any (idempotent).
#   - Skips items if the venue already has any (idempotent).
#   - Rolls back the whole transaction on any error.
#   - Does NOT touch billing, tables, or waiter accounts.
# ============================================================

set -euo pipefail

SLUG="${1:-}"
CSV_PATH="${2:-}"

# ── Validate args ─────────────────────────────────────────────────────────────

if [[ -z "$SLUG" || -z "$CSV_PATH" ]]; then
  echo "Usage: bash seed-venue-menu.sh <slug> <csv-path>"
  exit 1
fi

if [[ ! -f "$CSV_PATH" ]]; then
  echo "ERROR: CSV not found: $CSV_PATH"
  exit 1
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  cat >&2 <<'MSG'
ERROR: DATABASE_URL not set.

Get it from: Supabase Dashboard → Settings → Database
             → Connection string → URI (direct, port 5432)
Format:  postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres

Then run:
  export DATABASE_URL='postgresql://postgres:...'
  bash supabase/seed/seed-venue-menu.sh <slug> <csv-path>
MSG
  exit 1
fi

if ! command -v psql &>/dev/null; then
  echo "ERROR: psql not found. Install: brew install libpq && brew link libpq --force"
  exit 1
fi

if ! command -v python3 &>/dev/null; then
  echo "ERROR: python3 not found."
  exit 1
fi

# ── Parse CSV and generate SQL ────────────────────────────────────────────────

SQL=$(python3 - "$SLUG" "$CSV_PATH" <<'PYEOF'
import sys, csv

slug     = sys.argv[1]
csv_path = sys.argv[2]

categories        = {}   # name -> sort_order (first-appearance order)
items             = []
item_order_per_cat = {}
cat_order         = 1

with open(csv_path, newline='', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    for row in reader:
        group   = row['group'].strip()
        name    = row['item'].strip()
        price   = row['price'].strip()
        station = row['station'].strip()   # empty string → NULL in DB

        if not name or not price or not group:
            continue

        try:
            price_int = int(price)
        except ValueError:
            print(f"ERROR: non-integer price '{price}' for item '{name}'", file=sys.stderr)
            sys.exit(1)

        if station and station not in ('bar',):
            print(f"ERROR: invalid station '{station}' for item '{name}' — must be 'bar' or empty", file=sys.stderr)
            sys.exit(1)

        if group not in categories:
            categories[group] = cat_order
            cat_order += 1
            item_order_per_cat[group] = 1

        items.append({
            'group':      group,
            'name':       name,
            'price':      price_int,
            'station':    station,   # '' means NULL
            'sort_order': item_order_per_cat[group],
        })
        item_order_per_cat[group] += 1

if not items:
    print("ERROR: CSV produced no valid rows. Check the file.", file=sys.stderr)
    sys.exit(1)

bar_count     = sum(1 for i in items if i['station'] == 'bar')
nostn_count   = sum(1 for i in items if i['station'] == '')
total_count   = len(items)
cat_count     = len(categories)

def e(s):
    return str(s).replace("'", "''")

def cat_var(g):
    return 'v_cat_' + g.lower().replace(' ', '_').replace('-', '_')

def station_sql(s):
    return 'NULL' if not s else f"'{s}'"

lines = [
    "BEGIN;",
    "",
    "DO $$",
    "DECLARE",
    "  v_restaurant_id uuid;",
]
for g in categories:
    lines.append(f"  {cat_var(g)} uuid;")
lines += [
    "  v_bar_count   int;",
    "  v_nostn_count int;",
    "  v_total_count int;",
    "BEGIN",
    "",
    "  -- ── Resolve venue ──────────────────────────────────────────────────",
    f"  SELECT id INTO v_restaurant_id FROM public.restaurants WHERE slug = '{e(slug)}';",
    "  IF NOT FOUND THEN",
    f"    RAISE EXCEPTION 'No restaurant with slug=''{e(slug)}'' found. Create the venue first.';",
    "  END IF;",
    f"  RAISE NOTICE 'Venue found: %', v_restaurant_id;",
    "",
    "  -- ── Categories ─────────────────────────────────────────────────────",
    "  IF EXISTS (SELECT 1 FROM public.menu_categories WHERE restaurant_id = v_restaurant_id LIMIT 1) THEN",
    "    RAISE NOTICE 'Categories already exist — skipping.';",
    "  ELSE",
]
for g, sort in categories.items():
    slug_g = g.lower().replace(' ', '-').replace('_', '-')
    lines.append(f"    INSERT INTO public.menu_categories (restaurant_id, name, slug, emoji, ada_message, sort_order)")
    lines.append(f"      VALUES (v_restaurant_id, '{e(g)}', '{e(slug_g)}', '', '', {sort});")
lines += [
    f"    RAISE NOTICE '{cat_count} categories inserted.';",
    "  END IF;",
    "",
    "  -- ── Resolve category IDs ───────────────────────────────────────────",
]
for g in categories:
    var = cat_var(g)
    lines.append(f"  SELECT id INTO {var} FROM public.menu_categories WHERE restaurant_id = v_restaurant_id AND name = '{e(g)}';")
    lines.append(f"  IF {var} IS NULL THEN")
    lines.append(f"    RAISE EXCEPTION 'Category ''{e(g)}'' not found for this venue.';")
    lines.append("  END IF;")
lines += [
    "",
    "  -- ── Menu items ─────────────────────────────────────────────────────",
    "  IF EXISTS (SELECT 1 FROM public.menu_items WHERE restaurant_id = v_restaurant_id LIMIT 1) THEN",
    "    RAISE NOTICE 'Menu items already exist — skipping.';",
    "  ELSE",
]
for item in items:
    cv  = cat_var(item['group'])
    stn = station_sql(item['station'])
    lines.append(
        f"    INSERT INTO public.menu_items "
        f"(restaurant_id, category_id, name, price, description, ada_message, available, sort_order, station)"
    )
    lines.append(
        f"      VALUES (v_restaurant_id, {cv}, '{e(item['name'])}', {item['price']}, '', '', true, {item['sort_order']}, {stn});"
    )
lines += [
    f"    RAISE NOTICE '{total_count} items inserted.';",
    "  END IF;",
    "",
    "  -- ── Count assertion ────────────────────────────────────────────────",
    "  SELECT COUNT(*) INTO v_bar_count   FROM public.menu_items WHERE restaurant_id = v_restaurant_id AND station = 'bar';",
    "  SELECT COUNT(*) INTO v_nostn_count FROM public.menu_items WHERE restaurant_id = v_restaurant_id AND station IS NULL;",
    "  v_total_count := v_bar_count + v_nostn_count;",
    "  RAISE NOTICE 'Count: total=%, bar=%, no-station=%', v_total_count, v_bar_count, v_nostn_count;",
    f"  IF v_total_count <> {total_count} OR v_bar_count <> {bar_count} OR v_nostn_count <> {nostn_count} THEN",
    f"    RAISE EXCEPTION",
    f"      'Count mismatch — CSV expects {total_count}/{bar_count}/{nostn_count} (total/bar/no-station), "
    f"DB has %/%/%.',",
    "      v_total_count, v_bar_count, v_nostn_count;",
    "  END IF;",
    "",
    f"  RAISE NOTICE 'Seed complete for slug={slug}.';",
    "END;",
    "$$;",
    "",
    "COMMIT;",
]

print('\n'.join(lines))
PYEOF
)

# ── Execute ───────────────────────────────────────────────────────────────────

echo "Seeding '$SLUG' from '$CSV_PATH'..."
echo ""
echo "$SQL" | psql "$DATABASE_URL" 2>&1

EXIT_CODE=$?
if [[ $EXIT_CODE -ne 0 ]]; then
  echo ""
  echo "FAILED (exit $EXIT_CODE). No changes were committed."
  exit $EXIT_CODE
fi

echo ""
echo "Done."
