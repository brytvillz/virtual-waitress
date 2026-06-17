import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const supabase = createClient(
  Deno.env.get("SB_URL")!,
  Deno.env.get("SB_SERVICE_ROLE_KEY")!
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { restaurant_id, table_number } = await req.json();
    if (!restaurant_id || table_number == null) {
      return new Response(JSON.stringify({ error: "Missing fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const twelveHoursAgo = new Date(
      Date.now() - 12 * 60 * 60 * 1000
    ).toISOString();

    const { data: orders, error } = await supabase
      .from("orders")
      .select(
        "id, status, total, created_at, order_items(item_name, quantity, price)"
      )
      .eq("restaurant_id", restaurant_id)
      .eq("table_number", Number(table_number))
      .gte("created_at", twelveHoursAgo)
      .order("created_at", { ascending: true });

    if (error) throw error;

    return new Response(JSON.stringify({ orders: orders || [] }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("table-orders error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
