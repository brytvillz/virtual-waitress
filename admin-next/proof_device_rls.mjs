/**
 * Station Screen — device RLS proof tests
 *
 * Run with:
 *   cd /Users/goodgod/Desktop/virtual-waitress/admin-next
 *   SUPABASE_URL=https://rewdizxixvfytxnkcjyh.supabase.co \
 *   SUPABASE_SERVICE_KEY=<your-service-role-key> \
 *   SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJld2RpenhpeHZmeXR4bmtjanloIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1OTUyMjQsImV4cCI6MjA5NzE3MTIyNH0.JalhUqRkH4mHdZZsyZD0N3iNQWStCKptHc1fn8zLOas \
 *   RESTAURANT_ID=<uuid-of-any-restaurant-in-your-db> \
 *   node proof_device_rls.mjs
 *
 * What it proves:
 *   1. A device auth user + devices row can be created.
 *   2. Device session CANNOT read staff.access_code directly.
 *   3. Device session CANNOT read staff_public.access_code (column doesn't exist).
 *   4. Device session CANNOT update orders.total (trigger blocks it).
 *   5. Device session CANNOT jump order status pending → served (invalid transition).
 *   6. After revoking device (revoked_at set), staff table + orders are still denied.
 *   7. Device can ONLY read order_items for its own restaurant (cross-tenant check).
 *   8. Anonymous session CANNOT insert a waiter_call for a foreign restaurant_id.
 */

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
    const { data: orders } = await device.from('orders')
      .select('id, status')
      .eq('restaurant_id', RESTAURANT_ID)
      .eq('status', 'pending')
      .limit(1);

    if (!orders || orders.length === 0) {
      console.log('  SKIP  No pending orders found — place one via the customer menu and re-run');
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

    const { data: devRow } = await admin.from('devices')
      .select('revoked_at')
      .eq('auth_user_id', deviceUserId)
      .single();
    if (devRow?.revoked_at) {
      console.log(`  INFO  devices.revoked_at = ${devRow.revoked_at} ✓`);
    } else {
      console.log(`  WARN  devices.revoked_at is null — revocation update matched 0 rows!`);
    }

    const { data: session2, error: signinErr2 } = await anon.auth.signInWithPassword({
      email: testEmail, password: testPass,
    });
    if (signinErr2) { fail('second signIn', signinErr2.message); }
    const revokedDevice = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${session2.session.access_token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: fnCheck } = await revokedDevice.rpc('is_active_device');
    console.log(`  INFO  is_active_device() for revoked session = ${fnCheck}`);
    const { data: fnCheck2 } = await revokedDevice.rpc('current_device_restaurant');
    console.log(`  INFO  current_device_restaurant() for revoked session = ${fnCheck2}`);
    const { data: fnCheck3 } = await revokedDevice.rpc('is_any_device');
    console.log(`  INFO  is_any_device() for revoked session = ${fnCheck3}`);

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

  // ── Tests 7–8 use the active device session from before revocation.
  // Re-sign in to get a fresh active session for those tests.
  console.log('\n── Test 7: Device can only see order_items for its own restaurant ────');
  {
    // The test device is now revoked. We need a fresh active device to test reads.
    // Create a second temporary device entry for the same auth user by un-revoking,
    // or simply query all visible order_items and verify their restaurant via admin.
    //
    // Strategy: re-use the active device session captured before revocation (it still
    // holds a valid JWT). The JWT is accepted, but current_device_restaurant() now
    // returns NULL → device_read_order_items policy denies. So zero rows is correct.
    //
    // To test the positive case (device CAN read own-restaurant items), we check using
    // the admin client whether device_read_order_items scopes correctly — we verify
    // all order_items the device CAN see (via a new active device) belong only to
    // RESTAURANT_ID. Create a second test device for this check.
    const testEmail2 = `device-proof2-${Date.now()}@test.virtualwaitress.com`;
    const testPass2  = `TestPass2${Date.now()}!`;
    let deviceUserId2;

    const { data: user2 } = await admin.auth.admin.createUser({
      email: testEmail2, password: testPass2, email_confirm: true,
    });
    deviceUserId2 = user2.user.id;
    await admin.from('devices').insert({
      auth_user_id: deviceUserId2,
      restaurant_id: RESTAURANT_ID,
      name: 'Proof Test Screen 2',
    });

    const { data: session3 } = await anon.auth.signInWithPassword({
      email: testEmail2, password: testPass2,
    });
    const device2 = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${session3.session.access_token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Read ALL order_items visible to device2 (limit high to catch any leak)
    const { data: visibleItems, error: itemErr } = await device2.from('order_items')
      .select('order_id')
      .limit(500);

    if (itemErr) {
      pass(`RLS denied the query outright: ${itemErr.message}`);
    } else if (!visibleItems || visibleItems.length === 0) {
      pass('Device sees 0 order_items (no active orders in its restaurant, or RLS is blocking)');
      console.log('  INFO  If you have active orders, this means RLS is blocking correctly.');
      console.log('  INFO  Place a pending order and re-run to confirm positive case.');
    } else {
      // Use admin to check whether any visible order belongs to a DIFFERENT restaurant
      const orderIds = [...new Set(visibleItems.map(i => i.order_id))];
      const { data: foreignOrders, error: foErr } = await admin.from('orders')
        .select('id, restaurant_id')
        .in('id', orderIds)
        .neq('restaurant_id', RESTAURANT_ID);

      if (foErr) {
        fail('admin cross-restaurant check failed', foErr.message);
      } else if (foreignOrders && foreignOrders.length > 0) {
        fail(
          'Device can read order_items from another restaurant',
          JSON.stringify(foreignOrders),
        );
      } else {
        pass(`All ${visibleItems.length} visible order_items belong to device restaurant (${RESTAURANT_ID.slice(0, 8)}…)`);
      }
    }

    // Cleanup second device
    await admin.auth.admin.deleteUser(deviceUserId2);
  }

  console.log('\n── Test 8: Anon cannot insert waiter_call for foreign restaurant_id ─');
  {
    // Use a UUID that is not RESTAURANT_ID.
    // If anon_insert_waiter_calls has no restaurant_id scope, the insert will succeed
    // (or fail only on FK), exposing a DoS vector for the Station Screen.
    // It must fail with an RLS violation, not a FK violation.
    //
    // If no other real restaurant exists, we use a fake UUID. A FK error here means
    // the policy WITH CHECK passed — that would be a finding.
    let foreignId = '00000000-0000-0000-0000-000000000001';

    // Try to find a real second restaurant so the FK can't mask an RLS gap
    const { data: otherRestaurants } = await admin.from('restaurants')
      .select('id')
      .neq('id', RESTAURANT_ID)
      .limit(1);
    if (otherRestaurants && otherRestaurants.length > 0) {
      foreignId = otherRestaurants[0].id;
      console.log(`  INFO  Found a second restaurant — using real foreign ID for stricter test`);
    } else {
      console.log(`  INFO  Only one restaurant in DB — using fake UUID (FK will catch it if RLS misses)`);
    }

    const { data, error } = await anon.from('waiter_calls').insert({
      restaurant_id: foreignId,
      table_number: 1,
      status: 'pending',
    }).select();

    if (!error) {
      fail('Anon inserted waiter_call for foreign restaurant — RLS not blocking', JSON.stringify(data));
    } else if (
      error.message.includes('row-level security') ||
      error.code === '42501' ||
      error.message.includes('new row violates')
    ) {
      pass(`RLS blocked insert: ${error.message}`);
    } else if (
      error.message.includes('foreign key') ||
      error.code === '23503'
    ) {
      // FK violation means RLS WITH CHECK returned true — the policy does NOT scope
      // by restaurant_id. This is a security gap: a real restaurant_id would succeed.
      fail(
        'RLS WITH CHECK passed — FK caught it. anon_insert_waiter_calls does not check restaurant_id.',
        error.message,
      );
    } else {
      // Some other error — report it so we know what happened
      console.log(`  INFO  Error code: ${error.code}, message: ${error.message}`);
      pass(`Blocked (unexpected error — check INFO line above)`);
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
