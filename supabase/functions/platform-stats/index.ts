import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPER_ADMIN_EMAIL = "codedbryt@gmail.com";

const supabase = createClient(
  Deno.env.get("SB_URL")!,
  Deno.env.get("SB_SERVICE_ROLE_KEY")!
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Verify caller is the super admin
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user || user.email !== SUPER_ADMIN_EMAIL) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const oneWeekAgo  = new Date(Date.now() - 7  * 24 * 60 * 60 * 1000).toISOString();
    const oneMonthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [
      { data: restaurants },
      { data: orders }
    ] = await Promise.all([
      supabase.from("restaurants").select("id, name, slug, created_at").order("created_at", { ascending: false }),
      supabase.from("orders").select("restaurant_id, total, created_at")
    ]);

    const restaurantList = restaurants || [];
    const orderList      = orders      || [];

    const newThisWeek  = restaurantList.filter(r => r.created_at >= oneWeekAgo).length;
    const newThisMonth = restaurantList.filter(r => r.created_at >= oneMonthAgo).length;
    const totalOrders  = orderList.length;
    const totalRevenue = orderList.reduce((s: number, o: { total: number }) => s + o.total, 0);

    // Aggregate per-restaurant
    const byRestaurant: Record<string, { count: number; revenue: number; lastOrder: string | null }> = {};
    for (const o of orderList) {
      if (!byRestaurant[o.restaurant_id]) {
        byRestaurant[o.restaurant_id] = { count: 0, revenue: 0, lastOrder: null };
      }
      byRestaurant[o.restaurant_id].count++;
      byRestaurant[o.restaurant_id].revenue += o.total;
      if (!byRestaurant[o.restaurant_id].lastOrder || o.created_at > byRestaurant[o.restaurant_id].lastOrder!) {
        byRestaurant[o.restaurant_id].lastOrder = o.created_at;
      }
    }

    const breakdown = restaurantList.map(r => ({
      id:         r.id,
      name:       r.name,
      slug:       r.slug,
      created_at: r.created_at,
      orders:     byRestaurant[r.id]?.count   ?? 0,
      revenue:    byRestaurant[r.id]?.revenue ?? 0,
      lastOrder:  byRestaurant[r.id]?.lastOrder ?? null,
    }));

    return new Response(JSON.stringify({
      restaurants: { total: restaurantList.length, newThisWeek, newThisMonth },
      orders:      { total: totalOrders, revenue: totalRevenue },
      breakdown,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("platform-stats error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
