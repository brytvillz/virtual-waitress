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

function generateCode(): string {
  return `WTR-${Math.floor(1000 + Math.random() * 9000)}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Verify caller is an authenticated manager
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "");
    if (!token) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: callerStaff } = await supabase
      .from("staff")
      .select("role, restaurant_id")
      .eq("id", user.id)
      .single();

    if (!callerStaff || callerStaff.role !== "manager") {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { name } = await req.json();
    if (!name?.trim()) {
      return new Response(JSON.stringify({ error: "Name is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Generate a unique access code
    let access_code = "";
    for (let i = 0; i < 10; i++) {
      const candidate = generateCode();
      const { data: existing } = await supabase
        .from("staff")
        .select("id")
        .eq("access_code", candidate)
        .maybeSingle();
      if (!existing) {
        access_code = candidate;
        break;
      }
    }
    if (!access_code) throw new Error("Could not generate unique code");

    // Create Supabase Auth user — fake email, random password (never used directly)
    const fakeEmail = `waiter-${crypto.randomUUID().split("-")[0]}@staff.virtualwaitress.internal`;
    const { data: newUser, error: userError } =
      await supabase.auth.admin.createUser({
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
        restaurant_id: callerStaff.restaurant_id,
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
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
