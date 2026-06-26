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

const STAFF_LIMITS: Record<string, number> = { free: 1, growth: 5 };

function generateCode(): string {
  return `WTR-${Math.floor(1000 + Math.random() * 9000)}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "");
    if (!token) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { name, restaurant_id: targetRestaurantId } = await req.json();
    if (!name?.trim()) {
      return new Response(JSON.stringify({ error: "Name is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if caller is a manager via staff table
    const { data: callerStaff } = await supabase
      .from("staff")
      .select("role, restaurant_id")
      .eq("id", user.id)
      .maybeSingle();

    // Check if caller is the owner of the target restaurant
    const restaurantId = targetRestaurantId || callerStaff?.restaurant_id;
    if (!restaurantId) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: restaurant } = await supabase
      .from("restaurants")
      .select("id, plan, plan_status, owner_id")
      .eq("id", restaurantId)
      .single();

    const isManager = callerStaff?.role === "manager" && callerStaff?.restaurant_id === restaurantId;
    const isOwner = restaurant?.owner_id === user.id;

    if (!isManager && !isOwner) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Enforce staff count limit per plan
    const plan = (restaurant?.plan_status === "active") ? (restaurant?.plan || "free") : "free";
    const limit = STAFF_LIMITS[plan]; // undefined = pro = unlimited

    if (limit !== undefined) {
      const { count } = await supabase
        .from("staff")
        .select("id", { count: "exact", head: true })
        .eq("restaurant_id", restaurantId)
        .eq("role", "waiter");

      if ((count || 0) >= limit) {
        const planLabel = plan === "free" ? "Free plan (1 waiter)" : "Growth plan (5 waiters)";
        return new Response(
          JSON.stringify({ error: `Staff limit reached for your ${planLabel}. Upgrade to add more.` }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Generate unique access code
    let access_code = "";
    for (let i = 0; i < 10; i++) {
      const candidate = generateCode();
      const { data: existing } = await supabase
        .from("staff")
        .select("id")
        .eq("access_code", candidate)
        .maybeSingle();
      if (!existing) { access_code = candidate; break; }
    }
    if (!access_code) throw new Error("Could not generate unique code");

    const fakeEmail = `waiter-${crypto.randomUUID().split("-")[0]}@staff.virtualwaitress.internal`;
    const { data: newUser, error: userError } = await supabase.auth.admin.createUser({
      email: fakeEmail,
      email_confirm: true,
      password: crypto.randomUUID(),
    });

    if (userError || !newUser.user) {
      throw new Error(userError?.message || "Failed to create auth user");
    }

    const { data: newStaff, error: staffError } = await supabase
      .from("staff")
      .insert({
        id: newUser.user.id,
        restaurant_id: restaurantId,
        name: name.trim(),
        role: "waiter",
        access_code,
      })
      .select()
      .single();

    if (staffError) throw new Error(staffError.message);

    return new Response(JSON.stringify({ staff: newStaff }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("create-waiter error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message || "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
