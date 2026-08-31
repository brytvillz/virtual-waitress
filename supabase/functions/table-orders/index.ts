// table-orders: return orders by ID, not by restaurant + table.
//
// WHY THIS EXISTS
// The previous version accepted restaurant_id + table_number and returned 12
// hours of orders for that table — no authentication, service role. Both inputs
// are fully guessable (restaurant_id is in every QR code URL; table numbers are
// 1, 2, 3). A loop could enumerate all orders on the platform.
//
// THE NEW CONTRACT
// Caller supplies the order IDs they already hold. Knowing a 128-bit random UUID
// is the proof of having placed the order. The function returns only those orders,
// scoped to a 24-hour window. The customer menu persists placed IDs in
// localStorage and passes them here; orders older than 24 hours are pruned.
//
// LIMITS
// - Max 20 IDs per request. Without this, the function becomes a bulk oracle.
// - UUID format is validated before querying to prevent injection.
// - 24-hour age window: a UUID that leaks in a screenshot stops working by the
//   next day. Matches the localStorage prune window in the customer menu.
//
// RATE LIMITING
// Per-IP rate limiting must be configured at the Supabase project level
// (Settings → API → Rate Limits). The 20-ID cap and age window are the
// application-level guards; they do not substitute for network-level limits.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_IDS = 20;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

// Service role is retained because anon users have no SELECT policy on orders
// (by design — customers must not be able to read arbitrary orders). The lookup
// is gated by caller-supplied UUIDs and the age window rather than by auth.
const supabase = createClient(
  Deno.env.get("SB_URL")!,
  Deno.env.get("SB_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const { order_ids } = await req.json();

    if (!Array.isArray(order_ids) || order_ids.length === 0) {
      return json({ orders: [] });
    }

    if (order_ids.length > MAX_IDS) {
      return json({ error: `Too many order IDs — maximum is ${MAX_IDS}` }, 400);
    }

    // Reject any non-UUID before touching the database
    const invalid = order_ids.filter(
      (id: unknown) => typeof id !== "string" || !UUID_RE.test(id),
    );
    if (invalid.length > 0) {
      return json({ error: "Invalid order ID format" }, 400);
    }

    const cutoff = new Date(Date.now() - MAX_AGE_MS).toISOString();

    const { data: orders, error } = await supabase
      .from("orders")
      .select("id, status, total, created_at, table_number, order_items(item_name, quantity, price)")
      .in("id", order_ids)
      .gte("created_at", cutoff)
      .order("created_at", { ascending: true });

    if (error) throw error;

    return json({ orders: orders ?? [] });
  } catch (err) {
    console.error("table-orders error:", err);
    return json({ error: "Internal error" }, 500);
  }
});
