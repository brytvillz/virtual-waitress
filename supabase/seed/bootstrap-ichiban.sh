#!/usr/bin/env bash
# ============================================================
# Bootstrap Ichiban pilot account + venue
#
# Run this ONCE before pushing migrations 019 and 020.
# It calls the create-restaurant edge function (which uses the
# Admin API, so auth.identities is created correctly and the
# owner can log in via the waiter-login flow later).
#
# After this runs successfully:
#   supabase db push
#
# USAGE:
#   chmod +x supabase/seed/bootstrap-ichiban.sh
#   ICHIBAN_EMAIL=owner@example.com ICHIBAN_PASS=somepass123 bash supabase/seed/bootstrap-ichiban.sh
#
# Or edit the defaults below and run without env vars.
# ============================================================

set -euo pipefail

SUPABASE_URL="https://rewdizxixvfytxnkcjyh.supabase.co"
RESTAURANT_NAME="Ichiban"

EMAIL="${ICHIBAN_EMAIL:-}"
PASS="${ICHIBAN_PASS:-}"

if [[ -z "$EMAIL" ]]; then
  echo "ERROR: set ICHIBAN_EMAIL to the owner's email address."
  exit 1
fi

if [[ -z "$PASS" ]]; then
  echo "ERROR: set ICHIBAN_PASS to the owner's initial password (min 8 chars)."
  exit 1
fi

echo "Creating Ichiban owner account and venue..."
echo "  Name  : $RESTAURANT_NAME"
echo "  Email : $EMAIL"
echo "  URL   : $SUPABASE_URL"
echo ""

RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST "$SUPABASE_URL/functions/v1/create-restaurant" \
  -H "Content-Type: application/json" \
  -d "{\"restaurant_name\": \"$RESTAURANT_NAME\", \"email\": \"$EMAIL\", \"password\": \"$PASS\"}"
)

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

echo "HTTP $HTTP_CODE"
echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"

if [[ "$HTTP_CODE" != "200" ]]; then
  echo ""
  echo "FAILED. Check the error above and fix before pushing migrations."
  exit 1
fi

SLUG=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('slug',''))")

if [[ "$SLUG" != "ichiban" ]]; then
  echo ""
  echo "WARNING: slug is '$SLUG', not 'ichiban'. Migration 019 looks for slug='ichiban'."
  echo "If 'ichiban' was already taken, migration 019 will abort."
  echo "Check the restaurants table and fix the slug before running db push."
  exit 1
fi

echo ""
echo "OK. Ichiban created with slug='ichiban'."
echo ""
echo "Next step — push migrations:"
echo "  supabase db push"
echo ""
echo "019 will override billing to pro/active/no-trial and seed the 78-item menu."
echo "020 will add party_label + payment_method to orders."
