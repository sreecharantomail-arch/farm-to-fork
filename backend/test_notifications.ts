import './src/test_preload';
import { assertApprovedLocalEnvironment } from './src/utils/localDatabaseGuard';

assertApprovedLocalEnvironment('TestNotifications');

import { supabase } from './src/config/supabase';
import { generateNotification } from './src/controllers/notificationController';

async function runTests() {
  console.log('--- Starting Notification Tests ---');

  // 1. Get a test farmer
  const { data: users, error: userErr } = await supabase
    .from('users')
    .select('*')
    .eq('role', 'farmer')
    .limit(1);

  if (userErr || !users || users.length === 0) {
    console.error('Failed to get a test farmer', userErr);
    return;
  }
  const farmer = users[0];
  console.log(`Using Farmer: ${farmer.email} (${farmer.id})`);

  // 2. Generate a test notification (Creation)
  console.log('\n[Test 1] Generating Harvest Notification...');
  await generateNotification(
    farmer.id,
    'product_created',
    'Test Harvest Registered',
    'Test Batch BATCH-001 has been registered.',
    'product',
    'prod-123'
  );
  console.log('Done.');

  // 3. Verify deduplication
  console.log('\n[Test 2] Generating Duplicate Harvest Notification...');
  await generateNotification(
    farmer.id,
    'product_created',
    'Test Harvest Registered',
    'Test Batch BATCH-001 has been registered.',
    'product',
    'prod-123'
  );
  console.log('Done (Should not duplicate).');

  // 4. Fetch notifications to verify count
  const { data: notifs, error: notifErr } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', farmer.id)
    .eq('related_entity_id', 'prod-123');

  if (notifErr) {
    console.error('Failed to fetch notifications', notifErr);
  } else {
    console.log(`\n[Test 3] Fetched notifications for this entity: ${notifs.length}`);
    if (notifs.length === 1) {
      console.log('✅ Deduplication works! Only 1 notification exists.');
      console.log('Notification Title:', notifs[0].title);
    } else {
      console.error('❌ Deduplication failed! Count:', notifs.length);
    }
  }

  // 5. Clean up
  console.log('\n[Test 4] Cleaning up test data...');
  await supabase
    .from('notifications')
    .delete()
    .eq('user_id', farmer.id)
    .eq('related_entity_id', 'prod-123');
  console.log('Cleaned up.');

  console.log('--- Tests Complete ---');
}

runTests();
