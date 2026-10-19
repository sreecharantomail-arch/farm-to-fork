import './src/test_preload';
import { assertApprovedLocalEnvironment } from './src/utils/localDatabaseGuard';

assertApprovedLocalEnvironment('TestApi');

import axios from 'axios';
import jwt from 'jsonwebtoken';
import { supabase } from './src/config/supabase';
import { generateNotification } from './src/controllers/notificationController';

const PORT = process.env.PORT || 5000;
const API = `http://localhost:${PORT}/api`;
const SECRET = process.env.JWT_SECRET || 'dev_local_secret_replace_me';

async function runTests() {
  console.log('--- Starting API Tests ---');

  // 1. Get test farmer
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

  // 2. Generate token
  const token = jwt.sign({ id: farmer.id, role: farmer.role }, SECRET, { expiresIn: '1h' });
  const headers = { Authorization: `Bearer ${token}` };

  console.log(`Using Farmer: ${farmer.email}`);

  // 3. Clear existing notifications for this farmer to have a clean slate
  await supabase.from('notifications').delete().eq('user_id', farmer.id);

  // 4. Generate 3 notifications directly in DB via controller function
  await generateNotification(farmer.id, 'product_created', 'Harvest Registered', 'Test', 'product', 'test1');
  await generateNotification(farmer.id, 'product_status', 'Status Updated', 'Test', 'product', 'test2');
  await generateNotification(farmer.id, 'expiry_alert', 'Expiry Alert', 'Test', 'product', 'test3');

  // 5. Fetch notifications via API
  console.log('\n[API Test 1] Fetching Notifications...');
  try {
    const res = await axios.get(`${API}/notifications`, { headers });
    console.log(`Fetched ${res.data.data.length} notifications.`);
    if (res.data.data.length !== 3) throw new Error('Expected 3 notifications.');

    const unreadCount = res.data.data.filter((n: any) => !n.is_read).length;
    console.log(`Unread in list: ${unreadCount}`);
  } catch (e: any) {
    console.error('Failed API GET /notifications', e.response?.data || e.message);
  }

  // 6. Fetch unread count
  console.log('\n[API Test 2] Fetching Unread Count...');
  let firstNotifId;
  try {
    const res = await axios.get(`${API}/notifications/unread-count`, { headers });
    console.log(`Unread count endpoint returned: ${res.data.count}`);
    if (res.data.count !== 3) throw new Error('Expected unread count to be 3.');
  } catch (e: any) {
    console.error('Failed API GET /notifications/unread-count', e.response?.data || e.message);
  }

  // 7. Mark as read
  console.log('\n[API Test 3] Marking one as read...');
  try {
    // Get the ID of the first one
    const notifsRes = await axios.get(`${API}/notifications`, { headers });
    firstNotifId = notifsRes.data.data[0].id;

    await axios.put(`${API}/notifications/${firstNotifId}/read`, {}, { headers });
    console.log(`Marked ${firstNotifId} as read.`);

    // Check unread count again
    const countRes = await axios.get(`${API}/notifications/unread-count`, { headers });
    console.log(`Unread count endpoint now returned: ${countRes.data.count}`);
    if (countRes.data.count !== 2) throw new Error('Expected unread count to be 2.');
    console.log('✅ Unread count decremented successfully.');
  } catch (e: any) {
    console.error('Failed API PUT /read', e.response?.data || e.message);
  }

  // 8. Clean up
  console.log('\n[API Test 4] Cleaning up...');
  await supabase.from('notifications').delete().eq('user_id', farmer.id);
  console.log('Cleaned up.');

  console.log('--- API Tests Complete ---');
  process.exit(0);
}

// ensure backend is ready before running
setTimeout(runTests, 1000);
