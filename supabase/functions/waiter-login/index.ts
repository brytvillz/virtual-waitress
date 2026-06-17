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
    const { access_code, restaurant_id } = await req.json();

    if (!access_code || !restaurant_id) {
      return new Response(JSON.stringify({ error: "Missing fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: staff, error: staffError } = await supabase
      .from("staff")
      .select("id, name, role")
      .eq("access_code", String(access_code).trim().toUpperCase())
      .eq("restaurant_id", restaurant_id)
      .eq("role", "waiter")
      .maybeSingle();

    if (staffError || !staff) {
      return new Response(JSON.stringify({ error: "Invalid code" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: sessionData, error: sessionError } =
      await supabase.auth.admin.createSession({ user_id: staff.id });

    if (sessionError || !sessionData?.session) {
      console.error("Session creation failed:", sessionError);
      return new Response(JSON.stringify({ error: "Login failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ session: sessionData.session, staff }),
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
