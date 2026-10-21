import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const admin = createClient(
  Deno.env.get("SB_URL")!,
  Deno.env.get("SB_SERVICE_ROLE_KEY")!
);

// 5 failed attempts per IP per hour before the endpoint locks out.
// Successful pairings are NOT counted — an owner pairing multiple screens
// in the same hour must not exhaust their own budget.
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000;

// Alphabet used by both the generator (admin settings) and this validator.
// Excludes I, O, 0, 1 to avoid visual ambiguity when reading aloud.
const CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
      req.headers.get("cf-connecting-ip") ??
      "unknown";

    // ── Rate limit check (read only — do not insert yet) ────────────────────
    const windowStart = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
    const { count: failedCount } = await admin
      .from("pairing_attempts")
      .select("*", { count: "exact", head: true })
      .eq("ip", ip)
      .gte("created_at", windowStart);

    if ((failedCount ?? 0) >= RATE_LIMIT) {
      return new Response(
        JSON.stringify({ error: "Too many attempts — try again in an hour." }),
        {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ── Input validation ────────────────────────────────────────────────────
    const { code } = await req.json();

    if (!code || typeof code !== "string" || !CODE_RE.test(code.toUpperCase())) {
      return new Response(JSON.stringify({ error: "Invalid code format" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const normalised = code.toUpperCase();

    // ── Atomic claim ────────────────────────────────────────────────────────
    // UPDATE ... WHERE used_at IS NULL AND expires_at > NOW() acquires a row
    // lock. Two concurrent requests with the same code will serialize here:
    // only the first finds used_at = NULL and gets a row back; the second
    // finds used_at already set and returns 0 rows.
    const claimAt = new Date().toISOString();
    const { data: claimed, error: claimErr } = await admin
      .from("device_pairing_codes")
      .update({ used_at: claimAt })
      .eq("code", normalised)
      .is("used_at", null)
      .gt("expires_at", claimAt)
      .select("id, restaurant_id")
      .maybeSingle();

    if (claimErr || !claimed) {
      // Record this failed attempt — only failures count toward the rate limit.
      await admin.from("pairing_attempts").insert({ ip });
      return new Response(
        JSON.stringify({ error: "Invalid or expired code" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ── Create auth user ────────────────────────────────────────────────────
    const deviceEmail = `device-${crypto.randomUUID()}@device.vw.internal`;
    const { data: userResult, error: createErr } =
      await admin.auth.admin.createUser({
        email: deviceEmail,
        email_confirm: true,
      });

    if (createErr || !userResult?.user) {
      console.error("createUser failed:", createErr?.message);
      await admin
        .from("device_pairing_codes")
        .update({ used_at: null })
        .eq("id", claimed.id);
      return new Response(
        JSON.stringify({ error: "Failed to create device" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const userId = userResult.user.id;

    // ── Insert device row ───────────────────────────────────────────────────
    const { error: deviceErr } = await admin.from("devices").insert({
      auth_user_id: userId,
      restaurant_id: claimed.restaurant_id,
      name: "Bar Screen",
      station_type: "bar",
    });

    if (deviceErr) {
      console.error("devices insert failed:", deviceErr?.message);
      // Delete the orphaned auth user before resetting the claim,
      // so no account exists without a device row.
      await admin.auth.admin.deleteUser(userId);
      await admin
        .from("device_pairing_codes")
        .update({ used_at: null })
        .eq("id", claimed.id);
      return new Response(
        JSON.stringify({ error: "Failed to register device" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ── Generate one-time session token ─────────────────────────────────────
    const { data: linkData, error: linkErr } =
      await admin.auth.admin.generateLink({
        type: "magiclink",
        email: deviceEmail,
      });

    if (linkErr || !linkData?.properties?.hashed_token) {
      console.error("generateLink failed:", linkErr?.message);
      // deleteUser cascades to the device row via ON DELETE CASCADE.
      await admin.auth.admin.deleteUser(userId);
      await admin
        .from("device_pairing_codes")
        .update({ used_at: null })
        .eq("id", claimed.id);
      return new Response(
        JSON.stringify({ error: "Failed to generate session" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({ hashed_token: linkData.properties.hashed_token }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("pair-device error:", (err as Error)?.message ?? "unknown");
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
