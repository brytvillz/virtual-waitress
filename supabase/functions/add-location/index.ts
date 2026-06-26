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

const MAX_LOCATIONS: Record<string, number> = { free: 1, growth: 1, pro: 3 };

function toSlug(name: string): string {
  return name
    .toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
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

    const { restaurant_name } = await req.json();
    if (!restaurant_name?.trim()) {
      return new Response(JSON.stringify({ error: "Restaurant name is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get all restaurants owned by this user
    const { data: ownedRestaurants, error: ownedErr } = await supabase
      .from("restaurants")
      .select("id, plan, plan_status")
      .eq("owner_id", user.id);

    if (ownedErr || !ownedRestaurants?.length) {
      return new Response(JSON.stringify({ error: "No restaurants found for this account" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Plan is taken from the primary (first) restaurant
    const primary = ownedRestaurants[0];
    const plan = (primary.plan_status === "active") ? (primary.plan || "free") : "free";
    const maxLocations = MAX_LOCATIONS[plan] ?? 1;

    if (ownedRestaurants.length >= maxLocations) {
      return new Response(
        JSON.stringify({ error: `Your ${plan} plan allows up to ${maxLocations} location${maxLocations > 1 ? "s" : ""}. Upgrade to Pro to add more.` }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Generate unique slug
    const baseSlug = toSlug(restaurant_name.trim());
    if (!baseSlug) {
      return new Response(JSON.stringify({ error: "Restaurant name must contain letters or numbers." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let slug = baseSlug;
    let counter = 2;
    while (true) {
      const { data: existing } = await supabase
        .from("restaurants")
        .select("id")
        .eq("slug", slug)
        .maybeSingle();
      if (!existing) break;
      slug = `${baseSlug}-${counter}`;
      counter++;
    }

    const { data: newRestaurant, error: insertErr } = await supabase
      .from("restaurants")
      .insert({
        name: restaurant_name.trim(),
        slug,
        accent_color: "#C41E3A",
        owner_id: user.id,
      })
      .select("id, name, slug")
      .single();

    if (insertErr) throw new Error(insertErr.message);

    return new Response(JSON.stringify({ restaurant: newRestaurant }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("add-location error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message || "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
