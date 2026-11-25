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

    const { data: { user: caller }, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !caller) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Block device sessions — devices have no business removing staff.
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

    const { staff_id, action } = await req.json();
    if (!staff_id || !["remove", "delete"].includes(action)) {
      return new Response(JSON.stringify({ error: "Missing or invalid parameters" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Target must belong to the same restaurant.
    const { data: target } = await admin
      .from("staff")
      .select("id, role, restaurant_id, removed_at")
      .eq("id", staff_id)
      .eq("restaurant_id", callerStaff.restaurant_id)
      .maybeSingle();
    if (!target) {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (target.removed_at) {
      return new Response(JSON.stringify({ error: "Already removed" }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "delete") {
      // Re-verify all five blocking FK references are zero before hard-deleting.
      const [
        { count: c1 }, { count: c2 }, { count: c3 }, { count: c4 }, { count: c5 },
      ] = await Promise.all([
        admin.from("orders").select("id", { count: "exact", head: true }).eq("handled_by", staff_id),
        admin.from("orders").select("id", { count: "exact", head: true }).eq("ordered_by", staff_id),
        admin.from("void_requests").select("id", { count: "exact", head: true }).eq("requested_by", staff_id),
        admin.from("void_requests").select("id", { count: "exact", head: true }).eq("decided_by", staff_id),
        admin.from("waiter_calls").select("id", { count: "exact", head: true }).eq("acknowledged_by", staff_id),
      ]);

      const totalRefs = (c1 || 0) + (c2 || 0) + (c3 || 0) + (c4 || 0) + (c5 || 0);
      if (totalRefs > 0) {
        return new Response(
          JSON.stringify({
            error: "This waiter has past records and cannot be permanently deleted. Use Remove instead.",
          }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Revoke sessions before deleting the row.
      await admin.rpc("revoke_staff_sessions", { p_staff_id: staff_id });

      // Delete staff row first (it references auth.users; deleting it removes the
      // FK constraint before we delete the auth user).
      const { error: deleteStaffErr } = await admin
        .from("staff")
        .delete()
        .eq("id", staff_id);
      if (deleteStaffErr) {
        console.error("remove-staff: staff delete failed:", deleteStaffErr);
        return new Response(JSON.stringify({ error: "Failed to delete staff member." }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Delete the auth user so the account cannot be recovered.
      const { error: deleteAuthErr } = await admin.auth.admin.deleteUser(staff_id);
      if (deleteAuthErr) {
        console.error("remove-staff: auth.deleteUser failed:", deleteAuthErr);
        // Staff row is already gone; auth user is now orphaned but harmless — no staff row
        // means no RLS access. Log and treat as success.
      }

      return new Response(
        JSON.stringify({ success: true, action: "deleted" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // action === "remove": soft-remove — keep the row, null the access code,
    // kill active sessions so they cannot log in immediately.
    const { error: revokeErr } = await admin.rpc("revoke_staff_sessions", {
      p_staff_id: staff_id,
    });
    const sessionKilled = !revokeErr;
    if (revokeErr) {
      console.error("remove-staff: revoke_staff_sessions failed:", revokeErr);
    }

    const { error: updateErr } = await admin
      .from("staff")
      .update({ removed_at: new Date().toISOString(), access_code: null })
      .eq("id", staff_id);
    if (updateErr) {
      console.error("remove-staff: staff update failed:", updateErr);
      return new Response(JSON.stringify({ error: "Failed to remove staff member." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ success: true, action: "removed", session_killed: sessionKilled }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("remove-staff error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
