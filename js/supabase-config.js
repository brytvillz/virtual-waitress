// Supabase connection — Virtual Waitress
// The anon key is safe to expose client-side; real access control comes from
// Row Level Security (RLS) policies defined in the database, not from hiding this key.

const SUPABASE_URL = 'https://rewdizxixvfytxnkcjyh.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJld2RpenhpeHZmeXR4bmtjanloIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1OTUyMjQsImV4cCI6MjA5NzE3MTIyNH0.JalhUqRkH4mHdZZsyZD0N3iNQWStCKptHc1fn8zLOas';

// Use separate storage keys per page so admin and waiter sessions
// don't overwrite each other when testing on the same browser/device.
const _path = window.location.pathname;
const _storageKey = _path.includes('admin') ? 'vw_admin_auth'
                  : _path.includes('waiter') ? 'vw_waiter_auth'
                  : 'vw_customer_auth';

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { storageKey: _storageKey }
});

// Resolved at runtime: app.js reads ?r=slug, admin.js/waiter.js read from staff record
let RESTAURANT_ID = null;

// Public VAPID key — safe to expose client-side, this is what identifies our
// app to the browser's push service. The matching private key never leaves
// the Edge Function secrets.
const VAPID_PUBLIC_KEY = 'BFrzpgDfqzIw6EeSnmB5KfxjmrOXkWxa9jdsxz_ZY6l44aobWVF1eWx7oQRnShFMgLGJfJOfuzBKB8baovjn8-g';
