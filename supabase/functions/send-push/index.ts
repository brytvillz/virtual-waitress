// Edge Function: send-push
// Triggered by a Database Webhook on INSERT into `orders` or `waiter_calls`.
// Looks up every staff device subscribed for that restaurant and sends a
// real Web Push notification, even if the dashboard tab is closed.

import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT")!;
const SB_URL = Deno.env.get("SB_URL")!;
const SB_SERVICE_ROLE_KEY = Deno.env.get("SB_SERVICE_ROLE_KEY")!;

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

// Service role key bypasses RLS — safe here because this code only runs on
// Supabase's servers, never in a browser.
const supabase = createClient(SB_URL, SB_SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  const payload = await req.json();
  const record = payload.record;
  const table = payload.table;

  let title = "Virtual Waitress";
  let body = "";

  if (table === "orders") {
    title = "🛒 New Order";
    body = `Table ${record.table_number} placed an order — ₦${record.total}`;
  } else if (table === "waiter_calls") {
    title = "🔔 Waiter Called";
    body = `Table ${record.table_number} needs assistance`;
  } else {
    return new Response("Ignored — unrecognised table", { status: 200 });
  }

  const { data: subs, error } = await supabase
    .from("push_subscriptions")
    .select("*")
    .eq("restaurant_id", record.restaurant_id);

  if (error) {
    return new Response(JSON.stringify({ error }), { status: 500 });
  }

  const results = await Promise.allSettled(
    (subs || []).map((sub) =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify({ title, body })
      )
    )
  );

  // A 404/410 means the browser unsubscribed or the subscription expired —
  // clean those up so we stop wasting calls on dead endpoints.
  await Promise.all(
    results.map((result, i) => {
      const statusCode = result.status === "rejected" ? result.reason?.statusCode : null;
      if (statusCode === 404 || statusCode === 410) {
        return supabase.from("push_subscriptions").delete().eq("id", subs[i].id);
      }
      return Promise.resolve();
    })
  );

  return new Response(JSON.stringify({ sent: subs?.length || 0 }), { status: 200 });
});
