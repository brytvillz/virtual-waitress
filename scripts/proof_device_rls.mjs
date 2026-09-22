/**
 * Station Screen — device RLS proof tests
 *
 * Run with:
 *   cd /Users/goodgod/Desktop/virtual-waitress/admin-next   # supabase-js lives here
 *   SUPABASE_URL=https://rewdizxixvfytxnkcjyh.supabase.co \
 *   SUPABASE_SERVICE_KEY=<your-service-role-key> \
 *   SUPABASE_ANON_KEY=<your-anon-key> \
 *   RESTAURANT_ID=<uuid-of-any-restaurant-in-your-db> \
 *   node scripts/proof_device_rls.mjs
 *
 * What it proves:
 *   1. A device auth user + devices row can be created.
 *   2. Device session CANNOT read staff.access_code directly.
 *   3. Device session CANNOT read staff_public.access_code (column doesn't exist).
 *   4. Device session CANNOT update orders.total (trigger blocks it).
 *   5. Device session CANNOT jump order status pending → served (invalid transition).
 *   6. After revoking device (revoked_at set), staff table is still denied.
 */

// Run: node --input-type=module < scripts/proof_device_rls.mjs
// Or: npm install @supabase/supabase-js  (once), then node scripts/proof_device_rls.mjs
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL        = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SUPABASE_ANON_KEY   = process.env.SUPABASE_ANON_KEY;
const RESTAURANT_ID       = process.env.RESTAURANT_ID;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !SUPABASE_ANON_KEY || !RESTAURANT_ID) {
  console.error('Missing env vars. See usage comment at top of file.');
  process.exit(1);
}

const admin  = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const anon   = createClient(SUPABASE_URL, SUPABASE_ANON_KEY,   { auth: { autoRefreshToken: false, persistSession: false } });

function pass(label) { console.log(`  PASS  ${label}`); }
function fail(label, detail) { console.error(`  FAIL  ${label}: ${detail}`); process.exitCode = 1; }

async function run() {
  const testEmail = `device-proof-${Date.now()}@test.virtualwaitress.com`;
  const testPass  = `TestPass${Date.now()}!`;
  let deviceUserId, orderId;

  console.log('\n── Test 1: Create device auth user + devices row ────────────────────');
  {
    const { data: user, error } = await admin.auth.admin.createUser({
      email: testEmail, password: testPass, email_confirm: true,
    });
    if (error) { fail('createUser', error.message); return; }
    deviceUserId = user.user.id;

    const { error: devErr } = await admin.from('devices').insert({
      auth_user_id: deviceUserId,
      restaurant_id: RESTAURANT_ID,
      name: 'Proof Test Screen',
    });
    if (devErr) { fail('insert devices', devErr.message); return; }
    pass('Device auth user and devices row created');
  }

  // Sign in as device user to get a JWT
  const { data: session, error: signinErr } = await anon.auth.signInWithPassword({
    email: testEmail, password: testPass,
  });
  if (signinErr) { fail('signIn as device', signinErr.message); return; }

  const device = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${session.session.access_token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log('\n── Test 2: Device cannot read staff.access_code directly ────────────');
  {
    const { data, error } = await device.from('staff').select('access_code').limit(1);
    if (error) {
      pass(`Denied: ${error.message}`);
    } else if (!data || data.length === 0) {
      pass('Returned 0 rows (RLS filtered all rows)');
    } else {
      fail('staff.access_code readable', JSON.stringify(data));
    }
  }

  console.log('\n── Test 3: Device cannot read staff_public.access_code ──────────────');
  {
    const { data, error } = await device.from('staff_public').select('access_code').limit(1);
    if (error && (error.message.includes('does not exist') || error.message.includes('access_code'))) {
      pass(`Column error as expected: ${error.message}`);
    } else if (error) {
      pass(`Query denied (good): ${error.message}`);
    } else {
      fail('staff_public.access_code returned data', JSON.stringify(data));
    }
  }

  console.log('\n── Test 4: Device cannot update orders.total ────────────────────────');
  {
    // Find or create a pending order to test with
    const { data: orders } = await device.from('orders')
      .select('id, status')
      .eq('restaurant_id', RESTAURANT_ID)
      .eq('status', 'pending')
      .limit(1);

    if (!orders || orders.length === 0) {
      console.log('  SKIP  No pending orders found — insert one via dashboard and re-run');
    } else {
      orderId = orders[0].id;
      const { error } = await device.from('orders')
        .update({ total: 99999 })
        .eq('id', orderId);
      if (error && error.message.includes('Station Screen may only update order status')) {
        pass(`Trigger blocked: ${error.message}`);
      } else if (error) {
        pass(`Blocked (different error): ${error.message}`);
      } else {
        fail('orders.total was updated — trigger did not fire', 'No error returned');
      }
    }
  }

  console.log('\n── Test 5: Device cannot jump order status pending → served ─────────');
  {
    if (!orderId) {
      console.log('  SKIP  No pending order from Test 4');
    } else {
      const { error } = await device.from('orders')
        .update({ status: 'served' })
        .eq('id', orderId);
      if (error && error.message.includes('Invalid status transition')) {
        pass(`Trigger blocked: ${error.message}`);
      } else if (error) {
        pass(`Blocked (different error): ${error.message}`);
      } else {
        fail('Status jumped pending → served — trigger did not block', 'No error returned');
      }
    }
  }

  console.log('\n── Test 6: After revocation, device is denied ───────────────────────');
  {
    const { error: revokeErr } = await admin.from('devices')
      .update({ revoked_at: new Date().toISOString() })
      .eq('auth_user_id', deviceUserId);
    if (revokeErr) { fail('revoke device', revokeErr.message); }

    // Confirm the row was actually updated (silent 0-row update would explain Test 6 failure)
    const { data: devRow } = await admin.from('devices')
      .select('revoked_at')
      .eq('auth_user_id', deviceUserId)
      .single();
    if (devRow?.revoked_at) {
      console.log(`  INFO  devices.revoked_at = ${devRow.revoked_at} ✓`);
    } else {
      console.log(`  WARN  devices.revoked_at is null — revocation update matched 0 rows!`);
    }

    // Re-sign in so Supabase issues a new JWT (token itself still valid, but
    // current_device_restaurant() now returns NULL for this user)
    const { data: session2, error: signinErr2 } = await anon.auth.signInWithPassword({
      email: testEmail, password: testPass,
    });
    if (signinErr2) { fail('second signIn', signinErr2.message); }
    const revokedDevice = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${session2.session.access_token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Diagnostic: what do the device functions return for the revoked session?
    const { data: fnCheck } = await revokedDevice.rpc('is_active_device');
    console.log(`  INFO  is_active_device() for revoked session = ${fnCheck}`);
    const { data: fnCheck2 } = await revokedDevice.rpc('current_device_restaurant');
    console.log(`  INFO  current_device_restaurant() for revoked session = ${fnCheck2}`);

    const { data, error } = await revokedDevice.from('staff').select('id').limit(1);
    if (error || !data || data.length === 0) {
      pass('Revoked device denied access to staff table');
    } else {
      fail('Revoked device can still read staff', JSON.stringify(data));
    }

    const { data: orders, error: ordErr } = await revokedDevice.from('orders')
      .select('id').eq('restaurant_id', RESTAURANT_ID).limit(1);
    if (ordErr || !orders || orders.length === 0) {
      pass('Revoked device denied access to orders');
    } else {
      fail('Revoked device can still read orders', JSON.stringify(orders));
    }
  }

  console.log('\n── Cleanup ──────────────────────────────────────────────────────────');
  {
    await admin.auth.admin.deleteUser(deviceUserId);
    pass('Test device auth user deleted');
  }

  console.log('');
}

run().catch(e => { console.error('Unhandled error:', e); process.exit(1); });
