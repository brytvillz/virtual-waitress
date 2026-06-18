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
    const { access_code } = await req.json();

    if (!access_code) {
      return new Response(JSON.stringify({ error: "Missing fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Access codes are globally unique — no restaurant_id needed
    const { data: staff, error: staffError } = await supabase
      .from("staff")
      .select("id, name, role, restaurant_id")
      .eq("access_code", String(access_code).trim().toUpperCase())
      .eq("role", "waiter")
      .maybeSingle();

    if (staffError || !staff) {
      return new Response(JSON.stringify({ error: "Invalid code" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get the auth user's email (stored on the auth.users record)
    const { data: userData, error: userError } =
      await supabase.auth.admin.getUserById(staff.id);

    if (userError || !userData?.user?.email) {
      console.error("getUserById failed:", userError);
      return new Response(JSON.stringify({ error: "Login failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Generate a magic-link token — email delivery to the internal address
    // will fail silently, but the hashed_token is what we actually use.
    const { data: linkData, error: linkError } =
      await supabase.auth.admin.generateLink({
        type: "magiclink",
        email: userData.user.email,
      });

    if (linkError || !linkData?.properties?.hashed_token) {
      console.error("generateLink failed:", linkError);
      return new Response(JSON.stringify({ error: "Login failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ hashed_token: linkData.properties.hashed_token, staff }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("waiter-login error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
