import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const admin = createClient(
  Deno.env.get("SB_URL")!,
  Deno.env.get("SB_SERVICE_ROLE_KEY")!,
);

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

    // Verify the caller is a real authenticated user (not anon, not a device).
    const { data: { user: caller }, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !caller) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Block device sessions — devices have no business suspending staff.
    const { data: deviceRow } = await admin
      .from("devices")
      .select("id")
      .eq("auth_user_id", caller.id)
      .maybeSingle();
    if (deviceRow) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Caller must be a manager at a restaurant.
    const { data: callerStaff } = await admin
      .from("staff")
      .select("role, restaurant_id")
      .eq("id", caller.id)
      .maybeSingle();
    if (!callerStaff || callerStaff.role !== "manager") {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { staff_id } = await req.json();
    if (!staff_id) {
      return new Response(JSON.stringify({ error: "Missing staff_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Confirm the target waiter belongs to the same restaurant.
    const { data: target } = await admin
      .from("staff")
      .select("id, role, restaurant_id, suspended_at")
      .eq("id", staff_id)
      .eq("restaurant_id", callerStaff.restaurant_id)
      .maybeSingle();
    if (!target) {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (target.suspended_at) {
      return new Response(JSON.stringify({ error: "Already suspended" }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Kill all active sessions for this user. This is the convenience step;
    // the suspended_at column below is the guarantee.
    const { error: revokeErr } = await admin.rpc("revoke_staff_sessions", {
      p_staff_id: staff_id,
    });
    const sessionKilled = !revokeErr;
    if (revokeErr) {
      console.error("suspend-staff: revoke_staff_sessions failed:", revokeErr);
    }

    // Set suspended_at and null the access code so no new logins are possible.
    const { error: updateErr } = await admin
      .from("staff")
      .update({ suspended_at: new Date().toISOString(), access_code: null })
      .eq("id", staff_id);
    if (updateErr) {
      console.error("suspend-staff: staff update failed:", updateErr);
      return new Response(JSON.stringify({ error: "Failed to suspend staff member." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ success: true, session_killed: sessionKilled }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("suspend-staff error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
