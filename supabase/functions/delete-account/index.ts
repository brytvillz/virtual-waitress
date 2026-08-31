import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SB_URL")!,
      Deno.env.get("SB_SERVICE_ROLE_KEY")!,
    );

    // Verify caller is a real authenticated user
    const { data: { user }, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Refuse if the caller is a device. A device calling delete-account would
    // delete its own auth user, cascade-deleting the devices row and erasing
    // the revocation audit trail that exists specifically to track stolen screens.
    const { data: deviceRow } = await admin
      .from("devices")
      .select("id")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (deviceRow) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get restaurants owned by this user. Only owners may proceed.
    // This also refuses waiters and managers (staff users own no restaurants).
    // A waiter deleting their own auth user would cascade-delete their staff row
    // and potentially null out every order attribution and shift assignment in
    // history — silent, permanent data loss.
    const { data: restaurants } = await admin
      .from("restaurants")
      .select("id")
      .eq("owner_id", user.id);

    const restaurantIds = (restaurants ?? []).map((r: { id: string }) => r.id);

    if (restaurantIds.length === 0) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Delete everything per restaurant (explicit order to respect FK constraints)
    for (const restaurantId of restaurantIds) {
      const { data: orderRows } = await admin
        .from("orders")
        .select("id")
        .eq("restaurant_id", restaurantId);

      const orderIds = (orderRows ?? []).map((o: { id: string }) => o.id);

      if (orderIds.length > 0) {
        await admin.from("order_items").delete().in("order_id", orderIds);
      }

      await admin.from("orders").delete().eq("restaurant_id", restaurantId);
      await admin.from("waiter_calls").delete().eq("restaurant_id", restaurantId);
      await admin.from("push_subscriptions").delete().eq("restaurant_id", restaurantId);
      await admin.from("shift_assignments").delete().eq("restaurant_id", restaurantId);
      await admin.from("staff").delete().eq("restaurant_id", restaurantId);
      await admin.from("menu_items").delete().eq("restaurant_id", restaurantId);
      await admin.from("menu_categories").delete().eq("restaurant_id", restaurantId);
      await admin.from("tables").delete().eq("restaurant_id", restaurantId);
      await admin.from("restaurants").delete().eq("id", restaurantId);
    }

    // Delete the auth user only after all restaurant data is gone
    const { error: deleteErr } = await admin.auth.admin.deleteUser(user.id);
    if (deleteErr) {
      console.error("delete-account: auth user deletion failed:", deleteErr);
      return new Response(JSON.stringify({ error: "Failed to delete account. Please contact support@virtualwaitress.com." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("delete-account error:", err);
    return new Response(JSON.stringify({ error: "Server error. Please try again." }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
