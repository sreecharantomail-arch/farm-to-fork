import './test_preload';
import { assertApprovedLocalEnvironment } from './utils/localDatabaseGuard';

assertApprovedLocalEnvironment('TestProxy');

import axios from 'axios';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
dotenv.config();
assertApprovedLocalEnvironment('TestProxy');

const API_URL = 'http://localhost:5000';
const JWT_SECRET = process.env.JWT_SECRET || 'farmchain_super_secret_key';

function getToken(role: string) {
  return jwt.sign({ id: 'test-user-id', role }, JWT_SECRET, { expiresIn: '1h' });
}

async function testProxy() {
  const farmerToken = getToken('farmer');
  const adminToken = getToken('admin');

  console.log('Testing /api/ai/price-prediction proxy');

  // Test 1: Admin should not be authorized (only farmer)
  try {
    await axios.post(`${API_URL}/api/ai/price-prediction`, {}, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    console.error('❌ Expected 403 for Admin');
  } catch (err: any) {
    if (err.response?.status === 403) console.log('✅ Admin -> 403');
    else console.error(`❌ Admin unexpected status: ${err.response?.status}`);
  }

  // Test 2: Valid Request (Assuming AI Service returns 503 VERIFIED_DATA_UNAVAILABLE since we removed CSV)
  try {
    const res = await axios.post(`${API_URL}/api/ai/price-prediction`, {
      commodity: 'Tomato',
      market: 'Bangalore',
      forecast_days: 7
    }, {
      headers: { Authorization: `Bearer ${farmerToken}` }
    });
    console.log(`✅ Valid Request -> ${res.status}`);
  } catch (err: any) {
    if (err.response?.status === 503) {
      console.log('✅ Valid Request -> 503 (Expected due to VERIFIED_DATA_UNAVAILABLE)');
      if (err.response.data.error_code === 'VERIFIED_DATA_UNAVAILABLE') {
        console.log('✅ Proxy successfully propagates VERIFIED_DATA_UNAVAILABLE');
      } else {
        console.error('❌ Proxy did not return correct error code', err.response.data);
      }
    } else {
      console.error(`❌ Valid Request unexpected status: ${err.response?.status}`, err.response?.data);
    }
  }

  // Test 3: Malformed request
  try {
    const res = await axios.post(`${API_URL}/api/ai/price-prediction`, {}, {
      headers: { Authorization: `Bearer ${farmerToken}` }
    });
    console.log(`❌ Malformed Request -> ${res.status}`);
  } catch (err: any) {
    if (err.response?.status === 422) {
      console.log('✅ Malformed Request -> 422');
    } else {
      console.error(`❌ Malformed Request unexpected status: ${err.response?.status}`, err.response?.data);
    }
  }
}

testProxy();
