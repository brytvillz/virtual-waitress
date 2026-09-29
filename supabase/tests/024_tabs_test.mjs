#!/usr/bin/env node
/**
 * Test suite for migration 024 — tabs feature.
 *
 * Run:   node supabase/tests/024_tabs_test.mjs
 * Needs: Node 18+ (uses built-in fetch and crypto.randomUUID)
 *
 * Credentials are read from menu-next/.env.local — never from arguments
 * or environment variables set outside that file.
 *
 * This script only ever targets the 'payment-test' venue.
 * It hard-stops if the slug constant below is changed, as a safety net.
 *
 * Tests covered:
 *   a) Two concurrent open_tab calls get different tab numbers
 *   b) MANUAL — business day boundary (see output)
 *   c) settle_tab marks all orders paid with one shared paid_at
 *   d) settle_tab with a pending cancellation request pays nothing
 *   e) A waiter who did not open the tab is refused
 *   f) The waiter who opened the tab succeeds
 *   g) A waiter is refused on move_order_to_tab
 *   h) void_tab is refused while a live order is on the tab
 *   i) An order cannot be inserted onto a closed tab
 *   j) A direct PATCH setting tab_id is refused outside move_order_to_tab
 *   k) A settled tab cannot be settled again
 *
 * Cleanup: all test orders are cancelled via cancel_order() and all test
 * tabs are voided via void_tab() using the owner session. The script
 * reports any tabs it could not close so manual cleanup is possible.
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// ── Constants ─────────────────────────────────────────────────────────────────

const TARGET_SLUG = 'payment-test';

// ── Load .env.local ───────────────────────────────────────────────────────────

const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dir, '../../menu-next/.env.local');

function loadEnv(path) {
  let raw;
  try { raw = readFileSync(path, 'utf8'); }
  catch (e) { console.error(`Cannot read ${path}: ${e.message}`); process.exit(1); }
  const env = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.+)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

const env = loadEnv(envPath);

const SUPABASE_URL   = env['NEXT_PUBLIC_SUPABASE_URL'];
const ANON_KEY       = env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];
const OWNER_EMAIL    = env['TEST_OWNER_EMAIL'];
const OWNER_PASSWORD = env['TEST_OWNER_PASSWORD'];
const WAITER_A_CODE  = env['TEST_WAITER_A_CODE'];
const WAITER_B_CODE  = env['TEST_WAITER_B_CODE'];

// ── Preflight ─────────────────────────────────────────────────────────────────

const REQUIRED = [
  ['NEXT_PUBLIC_SUPABASE_URL',   SUPABASE_URL],
  ['NEXT_PUBLIC_SUPABASE_ANON_KEY', ANON_KEY],
  ['TEST_OWNER_EMAIL',           OWNER_EMAIL],
  ['TEST_OWNER_PASSWORD',        OWNER_PASSWORD],
  ['TEST_WAITER_A_CODE',         WAITER_A_CODE],
  ['TEST_WAITER_B_CODE',         WAITER_B_CODE],
];
let missingEnv = false;
for (const [k, v] of REQUIRED) {
  if (!v) { console.error(`Missing in menu-next/.env.local: ${k}`); missingEnv = true; }
}
if (missingEnv) process.exit(1);

// Double-check the slug constant hasn't been tampered with.
if (TARGET_SLUG !== 'payment-test') {
  console.error('HARD STOP: TARGET_SLUG has been changed from "payment-test". Refusing to run.');
  process.exit(1);
}

// ── Auth helpers ──────────────────────────────────────────────────────────────

async function authOwner(email, password) {
  const res = await fetch(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      method: 'POST',
      headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }
  );
  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`Owner login failed: ${data.error_description || data.error || JSON.stringify(data)}`);
  }
  return data.access_token;
}

async function authWaiter(accessCode, slug) {
  const loginRes = await fetch(
    `${SUPABASE_URL}/functions/v1/waiter-login`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ANON_KEY}` },
      body: JSON.stringify({ access_code: accessCode, slug }),
    }
  );
  const loginData = await loginRes.json();
  if (!loginData.hashed_token) {
    throw new Error(`waiter-login failed for code ${accessCode}: ${loginData.error || JSON.stringify(loginData)}`);
  }

  const verifyRes = await fetch(
    `${SUPABASE_URL}/auth/v1/verify`,
    {
      method: 'POST',
      headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token_hash: loginData.hashed_token, type: 'magiclink' }),
    }
  );
  const verifyData = await verifyRes.json();
  if (!verifyData.access_token) {
    throw new Error(`OTP verify failed for ${accessCode}: ${verifyData.error_description || verifyData.error || JSON.stringify(verifyData)}`);
  }
  return verifyData.access_token;
}

// ── API helpers ───────────────────────────────────────────────────────────────

function authHeaders(token) {
  return { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

// PostgREST filter strings like "eq.value" and "in.(a,b)" must not be
// URL-encoded — PostgREST parses them before decoding. Build the query
// string manually.
function qs(params) {
  return Object.entries(params).map(([k, v]) => `${k}=${v}`).join('&');
}

async function dbSelect(table, params, token) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs(params)}`, {
    headers: authHeaders(token),
  });
  const text = await res.text();
  if (!res.ok) return { ok: false, status: res.status, data: safeParse(text) };
  return { ok: true, status: res.status, data: safeParse(text) };
}

async function dbInsert(table, body, token) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...authHeaders(token), Prefer: 'return=representation' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, data: safeParse(text) };
}

async function dbPatch(table, filter, body, token) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs(filter)}`, {
    method: 'PATCH',
    headers: { ...authHeaders(token), Prefer: 'return=representation' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, data: safeParse(text) };
}

async function rpc(fn, params, token) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(params),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, data: safeParse(text) };
}

function safeParse(text) {
  if (!text || text.trim() === '') return null;
  try { return JSON.parse(text); } catch { return text; }
}

// Extract a UUID returned by a scalar RPC (open_tab returns uuid).
function extractUuid(data) {
  if (typeof data === 'string' && data.match(/^[0-9a-f-]{36}$/)) return data;
  if (Array.isArray(data) && data.length === 1 && typeof data[0] === 'string') return data[0];
  return null;
}

// ── Test runner ───────────────────────────────────────────────────────────────

const results = [];
let passed = 0, failed = 0;

function ok(name, condition, detail) {
  if (condition) {
    console.log(`    ✓  ${name}`);
    results.push({ name, ok: true });
    passed++;
  } else {
    const msg = detail ? ` — ${detail}` : '';
    console.error(`    ✗  ${name}${msg}`);
    results.push({ name, ok: false, detail });
    failed++;
  }
}

function errMsg(data) {
  if (!data) return '(no response body)';
  if (typeof data === 'object' && data.message) return data.message;
  return JSON.stringify(data);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n================================================================');
  console.log(' migration 024 test suite');
  console.log(` target venue: ${TARGET_SLUG} (hardcoded)`);
  console.log('================================================================\n');

  // ── Authenticate all three sessions ──────────────────────────────────────────
  console.log('Authenticating...');
  let ownerToken, waiterAToken, waiterBToken;
  try {
    [ownerToken, waiterAToken, waiterBToken] = await Promise.all([
      authOwner(OWNER_EMAIL, OWNER_PASSWORD),
      authWaiter(WAITER_A_CODE, TARGET_SLUG),
      authWaiter(WAITER_B_CODE, TARGET_SLUG),
    ]);
  } catch (e) {
    console.error(`  Auth failed: ${e.message}`);
    process.exit(1);
  }
  console.log('  owner, waiter A, waiter B authenticated\n');

  // ── Resolve restaurant id ─────────────────────────────────────────────────────
  const rResp = await dbSelect('restaurants', { slug: `eq.${TARGET_SLUG}`, select: 'id' }, ownerToken);
  const restaurantId = rResp.data?.[0]?.id;
  if (!restaurantId) {
    console.error(`  Could not resolve restaurant id for '${TARGET_SLUG}' with owner token`);
    console.error(`  Response: ${JSON.stringify(rResp.data)}`);
    process.exit(1);
  }
  console.log(`  restaurant id: ${restaurantId}\n`);

  // All test tab ids — tracked so cleanup can close any that are still open.
  const testTabIds = [];

  // ══════════════════════════════════════════════════════════════════════════════
  // TEST A — Two concurrent opens get different tab numbers
  // ══════════════════════════════════════════════════════════════════════════════
  console.log('a) Concurrent open_tab calls get different tab numbers');
  const [rA1, rA2] = await Promise.all([
    rpc('open_tab', { p_restaurant_id: restaurantId }, waiterAToken),
    rpc('open_tab', { p_restaurant_id: restaurantId }, ownerToken),
  ]);

  ok('a-1: both calls succeed', rA1.ok && rA2.ok,
    `call 1: ${errMsg(rA1.data)} | call 2: ${errMsg(rA2.data)}`);

  const raceTab1 = extractUuid(rA1.data);
  const raceTab2 = extractUuid(rA2.data);

  if (rA1.ok && rA2.ok && raceTab1 && raceTab2) {
    testTabIds.push(raceTab1, raceTab2);
    const tabsResp = await dbSelect(
      'tabs',
      { id: `in.(${raceTab1},${raceTab2})`, select: 'id,tab_number' },
      ownerToken
    );
    const numbers = (tabsResp.data || []).map(t => t.tab_number);
    ok('a-2: tab numbers are distinct', new Set(numbers).size === 2,
      `numbers returned: ${JSON.stringify(numbers)}`);
    ok('a-3: both tab numbers are positive integers',
      numbers.every(n => Number.isInteger(n) && n >= 1),
      `numbers: ${JSON.stringify(numbers)}`);
  } else {
    ok('a-2: tab numbers are distinct', false, 'skipped — a-1 did not produce two valid tab ids');
    ok('a-3: both tab numbers are positive integers', false, 'skipped');
  }
  console.log();

  // ══════════════════════════════════════════════════════════════════════════════
  // TEST B — Business day boundary (manual)
  // ══════════════════════════════════════════════════════════════════════════════
  console.log('b) Business day boundary — MANUAL STEP REQUIRED');
  console.log('   After the venue\'s business_day_start rolls over to the next day,');
  console.log('   open one more tab for payment-test and confirm its tab_number is 1.');
  console.log('   (Requires service-role key to automate; not available in .env.local.)\n');

  // ══════════════════════════════════════════════════════════════════════════════
  // SETUP — Open tabs and insert orders for tests c/k, d, e/f, g, h
  // ══════════════════════════════════════════════════════════════════════════════
  console.log('Setting up test tabs and orders...');

  function newOrder(tabId) {
    return {
      id:              crypto.randomUUID(),
      restaurant_id:   restaurantId,
      table_number:    1,
      client_order_id: crypto.randomUUID(),
      tab_id:          tabId,
      status:          'pending',
    };
  }

  // Tab CK — two orders — used for tests c (settle) and k (double-settle)
  const rCK = await rpc('open_tab', { p_restaurant_id: restaurantId }, waiterAToken);
  const tabCK = extractUuid(rCK.data);
  ok('setup: open tab CK (tests c, k)', rCK.ok && !!tabCK, errMsg(rCK.data));
  if (tabCK) testTabIds.push(tabCK);

  const orderCK1 = tabCK ? newOrder(tabCK) : null;
  const orderCK2 = tabCK ? newOrder(tabCK) : null;
  if (tabCK) {
    const [i1, i2] = await Promise.all([
      dbInsert('orders', orderCK1, waiterAToken),
      dbInsert('orders', orderCK2, waiterAToken),
    ]);
    ok('setup: 2 orders on tab CK', i1.ok && i2.ok,
      `order 1: ${errMsg(i1.data)} | order 2: ${errMsg(i2.data)}`);
  }

  // Tab D — one order + pending cancellation request — used for test d
  const rD = await rpc('open_tab', { p_restaurant_id: restaurantId }, waiterAToken);
  const tabD = extractUuid(rD.data);
  ok('setup: open tab D (test d)', rD.ok && !!tabD, errMsg(rD.data));
  if (tabD) testTabIds.push(tabD);

  const orderD = tabD ? newOrder(tabD) : null;
  if (tabD) {
    const iD = await dbInsert('orders', orderD, waiterAToken);
    ok('setup: order on tab D', iD.ok, errMsg(iD.data));

    if (iD.ok) {
      const iCR = await dbInsert('cancellation_requests', {
        order_id:      orderD.id,
        restaurant_id: restaurantId,
        reason:        'test — do not process',
      }, waiterAToken);
      ok('setup: pending cancellation_request on tab D order', iCR.ok, errMsg(iCR.data));
    }
  }

  // Tab EF — one order — used for tests e (wrong waiter refused) and f (opener succeeds)
  const rEF = await rpc('open_tab', { p_restaurant_id: restaurantId }, waiterAToken);
  const tabEF = extractUuid(rEF.data);
  ok('setup: open tab EF (tests e, f)', rEF.ok && !!tabEF, errMsg(rEF.data));
  if (tabEF) testTabIds.push(tabEF);

  const orderEF = tabEF ? newOrder(tabEF) : null;
  if (tabEF) {
    const iEF = await dbInsert('orders', orderEF, waiterAToken);
    ok('setup: order on tab EF', iEF.ok, errMsg(iEF.data));
  }

  // Tabs G and G2 — one order on G — used for test g (waiter refused on move_order_to_tab)
  const [rG, rG2] = await Promise.all([
    rpc('open_tab', { p_restaurant_id: restaurantId }, waiterAToken),
    rpc('open_tab', { p_restaurant_id: restaurantId }, waiterAToken),
  ]);
  const tabG  = extractUuid(rG.data);
  const tabG2 = extractUuid(rG2.data);
  ok('setup: open tabs G and G2 (test g)', rG.ok && rG2.ok && !!tabG && !!tabG2,
    `G: ${errMsg(rG.data)} | G2: ${errMsg(rG2.data)}`);
  if (tabG)  testTabIds.push(tabG);
  if (tabG2) testTabIds.push(tabG2);

  const orderG = tabG ? newOrder(tabG) : null;
  if (tabG) {
    const iG = await dbInsert('orders', orderG, waiterAToken);
    ok('setup: order on tab G', iG.ok, errMsg(iG.data));
  }

  // Tab H — one order — used for test h (void refused with live order) and j (direct PATCH)
  const rH = await rpc('open_tab', { p_restaurant_id: restaurantId }, waiterAToken);
  const tabH = extractUuid(rH.data);
  ok('setup: open tab H (tests h, j)', rH.ok && !!tabH, errMsg(rH.data));
  if (tabH) testTabIds.push(tabH);

  const orderH = tabH ? newOrder(tabH) : null;
  if (tabH) {
    const iH = await dbInsert('orders', orderH, waiterAToken);
    ok('setup: order on tab H', iH.ok, errMsg(iH.data));
  }

  console.log();

  // ══════════════════════════════════════════════════════════════════════════════
  // TEST C — settle_tab marks all orders paid with one shared paid_at
  // ══════════════════════════════════════════════════════════════════════════════
  console.log('c) settle_tab marks all orders paid with one shared paid_at');

  if (tabCK && orderCK1 && orderCK2) {
    const settleC = await rpc('settle_tab',
      { p_tab_id: tabCK, p_payment_method: 'cash' }, waiterAToken);
    ok('c-1: settle succeeds', settleC.ok, errMsg(settleC.data));

    if (settleC.ok) {
      const ordersResp = await dbSelect(
        'orders',
        { id: `in.(${orderCK1.id},${orderCK2.id})`, select: 'id,is_paid,payment_method,paid_at' },
        ownerToken
      );
      const orders = ordersResp.data || [];
      ok('c-2: both orders are paid', orders.length === 2 && orders.every(o => o.is_paid === true),
        `is_paid values: ${orders.map(o => o.is_paid)}`);
      ok('c-3: payment_method is cash on all orders',
        orders.every(o => o.payment_method === 'cash'),
        `payment_methods: ${orders.map(o => o.payment_method)}`);
      ok('c-4: all orders share one identical paid_at',
        orders.length === 2 && orders[0].paid_at === orders[1].paid_at,
        `paid_at values: ${orders.map(o => o.paid_at)}`);

      const tabCKResp = await dbSelect('tabs', { id: `eq.${tabCK}`, select: 'status' }, ownerToken);
      ok('c-5: tab is closed', tabCKResp.data?.[0]?.status === 'closed',
        `status: ${tabCKResp.data?.[0]?.status}`);
    }
  } else {
    ['c-1','c-2','c-3','c-4','c-5'].forEach(n => ok(`${n}: (skipped — setup failed)`, false, 'setup failed'));
  }
  console.log();

  // ══════════════════════════════════════════════════════════════════════════════
  // TEST D — settle_tab with a pending cancellation request pays nothing
  // ══════════════════════════════════════════════════════════════════════════════
  console.log('d) settle_tab with pending cancellation request pays nothing');

  if (tabD && orderD) {
    const settleD = await rpc('settle_tab',
      { p_tab_id: tabD, p_payment_method: 'cash' }, waiterAToken);
    ok('d-1: settle is refused', !settleD.ok,
      settleD.ok ? `unexpected success — tab may have been partially settled` : errMsg(settleD.data));

    const orderDResp = await dbSelect(
      'orders', { id: `eq.${orderD.id}`, select: 'is_paid,status' }, ownerToken);
    ok('d-2: order is still unpaid', orderDResp.data?.[0]?.is_paid === false,
      `is_paid: ${orderDResp.data?.[0]?.is_paid}`);
    ok('d-3: order status is still pending (not cancelled)',
      orderDResp.data?.[0]?.status === 'pending',
      `status: ${orderDResp.data?.[0]?.status}`);

    const tabDResp = await dbSelect('tabs', { id: `eq.${tabD}`, select: 'status' }, ownerToken);
    ok('d-4: tab is still open', tabDResp.data?.[0]?.status === 'open',
      `status: ${tabDResp.data?.[0]?.status}`);
  } else {
    ['d-1','d-2','d-3','d-4'].forEach(n => ok(`${n}: (skipped — setup failed)`, false, 'setup failed'));
  }
  console.log();

  // ══════════════════════════════════════════════════════════════════════════════
  // TEST E — Waiter who did not open the tab is refused
  // ══════════════════════════════════════════════════════════════════════════════
  console.log('e) Non-opener waiter is refused on settle_tab');

  if (tabEF) {
    const settleE = await rpc('settle_tab',
      { p_tab_id: tabEF, p_payment_method: 'cash' }, waiterBToken);
    ok('e-1: waiter B is refused', !settleE.ok,
      settleE.ok ? 'unexpected success — tab should only be settable by its opener' : errMsg(settleE.data));

    const tabEResp = await dbSelect('tabs', { id: `eq.${tabEF}`, select: 'status' }, ownerToken);
    ok('e-2: tab is still open after refusal', tabEResp.data?.[0]?.status === 'open',
      `status: ${tabEResp.data?.[0]?.status}`);
  } else {
    ok('e-1: (skipped — setup failed)', false, 'setup failed');
    ok('e-2: (skipped — setup failed)', false, 'setup failed');
  }
  console.log();

  // ══════════════════════════════════════════════════════════════════════════════
  // TEST F — Waiter who opened the tab succeeds
  // ══════════════════════════════════════════════════════════════════════════════
  console.log('f) Opener waiter settles the same tab successfully');

  if (tabEF) {
    const settleF = await rpc('settle_tab',
      { p_tab_id: tabEF, p_payment_method: 'pos' }, waiterAToken);
    ok('f-1: waiter A settles', settleF.ok, errMsg(settleF.data));

    const tabFResp = await dbSelect('tabs', { id: `eq.${tabEF}`, select: 'status' }, ownerToken);
    ok('f-2: tab is now closed', tabFResp.data?.[0]?.status === 'closed',
      `status: ${tabFResp.data?.[0]?.status}`);
  } else {
    ok('f-1: (skipped — setup failed)', false, 'setup failed');
    ok('f-2: (skipped — setup failed)', false, 'setup failed');
  }
  console.log();

  // ══════════════════════════════════════════════════════════════════════════════
  // TEST G — Waiter is refused on move_order_to_tab
  // ══════════════════════════════════════════════════════════════════════════════
  console.log('g) Waiter is refused on move_order_to_tab (manager/owner only)');

  if (tabG && tabG2 && orderG) {
    const moveG = await rpc('move_order_to_tab', {
      p_order_id:   orderG.id,
      p_new_tab_id: tabG2,
      p_reason:     'waiter test attempt',
    }, waiterAToken);
    ok('g-1: waiter A is refused', !moveG.ok,
      moveG.ok ? 'unexpected success — move_order_to_tab should be manager/owner only'
               : errMsg(moveG.data));

    const orderGResp = await dbSelect('orders',
      { id: `eq.${orderG.id}`, select: 'tab_id' }, ownerToken);
    ok('g-2: order tab_id is unchanged after refusal',
      orderGResp.data?.[0]?.tab_id === tabG,
      `tab_id: ${orderGResp.data?.[0]?.tab_id} (expected ${tabG})`);
  } else {
    ok('g-1: (skipped — setup failed)', false, 'setup failed');
    ok('g-2: (skipped — setup failed)', false, 'setup failed');
  }
  console.log();

  // ══════════════════════════════════════════════════════════════════════════════
  // TEST H — void_tab refused while a live order is on the tab
  // ══════════════════════════════════════════════════════════════════════════════
  console.log('h) void_tab refused while a non-cancelled order is on the tab');

  if (tabH) {
    const voidH = await rpc('void_tab',
      { p_tab_id: tabH, p_reason: 'test void attempt' }, ownerToken);
    ok('h-1: void is refused', !voidH.ok,
      voidH.ok ? 'unexpected success — tab has a live order'
               : errMsg(voidH.data));

    const tabHResp = await dbSelect('tabs', { id: `eq.${tabH}`, select: 'status' }, ownerToken);
    ok('h-2: tab is still open', tabHResp.data?.[0]?.status === 'open',
      `status: ${tabHResp.data?.[0]?.status}`);
  } else {
    ok('h-1: (skipped — setup failed)', false, 'setup failed');
    ok('h-2: (skipped — setup failed)', false, 'setup failed');
  }
  console.log();

  // ══════════════════════════════════════════════════════════════════════════════
  // TEST I — Order insert rejected on a closed tab
  // ══════════════════════════════════════════════════════════════════════════════
  console.log('i) Order insert rejected on a closed tab');

  // tabCK was settled in test c — use it as the closed target.
  if (tabCK) {
    const insI = await dbInsert('orders', {
      id:              crypto.randomUUID(),
      restaurant_id:   restaurantId,
      table_number:    1,
      client_order_id: crypto.randomUUID(),
      tab_id:          tabCK,
      status:          'pending',
    }, waiterAToken);
    ok('i-1: insert is rejected', !insI.ok,
      insI.ok ? 'unexpected success — tab is closed'
              : errMsg(insI.data));
  } else {
    ok('i-1: (skipped — setup failed)', false, 'setup failed');
  }
  console.log();

  // ══════════════════════════════════════════════════════════════════════════════
  // TEST J — Direct PATCH setting tab_id is refused
  // ══════════════════════════════════════════════════════════════════════════════
  console.log('j) Direct PATCH of orders.tab_id is refused (use move_order_to_tab instead)');

  // orderH is on tabH. Try to move it to tabG2 via a direct REST PATCH.
  // enforce_staff_order_update must block this (vw.moving_order_tab not set).
  if (tabH && tabG2 && orderH) {
    const patchJ = await dbPatch(
      'orders',
      { id: `eq.${orderH.id}` },
      { tab_id: tabG2 },
      waiterAToken
    );
    ok('j-1: direct PATCH is refused', !patchJ.ok,
      patchJ.ok ? 'unexpected success — trigger should block tab_id change'
                : `HTTP ${patchJ.status}: ${errMsg(patchJ.data)}`);

    const orderJResp = await dbSelect('orders',
      { id: `eq.${orderH.id}`, select: 'tab_id' }, ownerToken);
    ok('j-2: tab_id is unchanged', orderJResp.data?.[0]?.tab_id === tabH,
      `tab_id: ${orderJResp.data?.[0]?.tab_id} (expected ${tabH})`);
  } else {
    ok('j-1: (skipped — setup failed)', false, 'setup failed');
    ok('j-2: (skipped — setup failed)', false, 'setup failed');
  }
  console.log();

  // ══════════════════════════════════════════════════════════════════════════════
  // TEST K — Settled tab cannot be settled again
  // ══════════════════════════════════════════════════════════════════════════════
  console.log('k) Second settle on an already-settled tab is refused');

  // tabCK was settled in test c and is still the same waiter A's token.
  if (tabCK && orderCK1 && orderCK2) {
    // Record the paid_at before the second attempt so we can verify nothing changed.
    const beforeResp = await dbSelect(
      'orders',
      { id: `in.(${orderCK1.id},${orderCK2.id})`, select: 'id,is_paid,paid_at' },
      ownerToken
    );
    const beforeOrders = beforeResp.data || [];

    const settleK = await rpc('settle_tab',
      { p_tab_id: tabCK, p_payment_method: 'transfer' }, waiterAToken);
    ok('k-1: second settle is refused', !settleK.ok,
      settleK.ok ? 'unexpected success — tab was already closed'
                 : errMsg(settleK.data));

    const afterResp = await dbSelect(
      'orders',
      { id: `in.(${orderCK1.id},${orderCK2.id})`, select: 'id,is_paid,paid_at' },
      ownerToken
    );
    const afterOrders = afterResp.data || [];

    ok('k-2: orders remain paid (state unchanged)',
      afterOrders.every(o => o.is_paid === true),
      `is_paid: ${afterOrders.map(o => o.is_paid)}`);

    const beforeMap = Object.fromEntries(beforeOrders.map(o => [o.id, o.paid_at]));
    ok('k-3: paid_at is identical before and after the refused attempt',
      afterOrders.every(o => o.paid_at === beforeMap[o.id]),
      `before: ${JSON.stringify(beforeMap)} | after: ${JSON.stringify(Object.fromEntries(afterOrders.map(o => [o.id, o.paid_at])))}`
    );
  } else {
    ['k-1','k-2','k-3'].forEach(n => ok(`${n}: (skipped — setup failed)`, false, 'setup failed'));
  }
  console.log();

  // ══════════════════════════════════════════════════════════════════════════════
  // CLEANUP
  // ══════════════════════════════════════════════════════════════════════════════
  console.log('Cleaning up...');

  // Cancel every order that is still live (not yet cancelled), so void_tab can close the tabs.
  const ordersToCancel = [orderD, orderG, orderH].filter(Boolean);
  for (const order of ordersToCancel) {
    const r = await rpc('cancel_order',
      { p_order_id: order.id, p_reason: 'test cleanup' }, ownerToken);
    if (!r.ok) console.warn(`  WARNING: could not cancel order ${order.id}: ${errMsg(r.data)}`);
  }

  // Void all tabs that are still open (tabCK and tabEF are already closed by settle).
  const tabsToVoid = [tabD, tabG, tabG2, tabH, raceTab1, raceTab2].filter(Boolean);
  for (const tabId of tabsToVoid) {
    const r = await rpc('void_tab',
      { p_tab_id: tabId, p_reason: 'test cleanup' }, ownerToken);
    if (!r.ok) console.warn(`  WARNING: could not void tab ${tabId}: ${errMsg(r.data)}`);
  }

  // Verify no test tabs are still open.
  const openResp = await dbSelect(
    'tabs',
    { id: `in.(${testTabIds.join(',')})`, status: 'eq.open', select: 'id,tab_number,status' },
    ownerToken
  );
  const stillOpen = openResp.data || [];
  if (stillOpen.length === 0) {
    console.log('  all test tabs closed\n');
  } else {
    console.warn(`  WARNING: ${stillOpen.length} test tab(s) could not be closed — manual cleanup required:`);
    stillOpen.forEach(t => console.warn(`    tab_number=${t.tab_number}  id=${t.id}`));
    console.log();
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ══════════════════════════════════════════════════════════════════════════════
  console.log('================================================================');
  console.log(` Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error('\n Failed tests:');
    results.filter(r => !r.ok).forEach(r =>
      console.error(`   ✗  ${r.name}${r.detail ? ` — ${r.detail}` : ''}`)
    );
  }
  console.log('================================================================\n');
  console.log('b) Business day boundary — verify manually:');
  console.log('   After the venue\'s business_day_start rolls over, open a new tab');
  console.log('   on payment-test and confirm the tab_number is 1.\n');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
