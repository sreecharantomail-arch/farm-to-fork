import './test_preload';
import { assertApprovedLocalEnvironment } from './utils/localDatabaseGuard';

assertApprovedLocalEnvironment('TestRbac');

import axios from 'axios';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
dotenv.config();
assertApprovedLocalEnvironment('TestRbac');

const API_URL = 'http://localhost:5000';
const JWT_SECRET = process.env.JWT_SECRET || 'farmchain_super_secret_key';

function getToken(role: string) {
  return jwt.sign({ id: 'test-user-id', role }, JWT_SECRET, { expiresIn: '1h' });
}

async function testRBAC() {
  const roles = ['farmer', 'processor', 'distributor', 'retailer', 'consumer', 'admin'];

  console.log('Testing RBAC for /api/ai/observability');

  // No JWT
  try {
    await axios.get(`${API_URL}/api/ai/observability`);
    console.error('❌ Expected 401 for No JWT');
  } catch (err: any) {
    if (err.response?.status === 401) console.log('✅ No JWT -> 401');
    else console.error(`❌ No JWT unexpected status: ${err.response?.status}`);
  }

  for (const role of roles) {
    const token = getToken(role);
    try {
      const res = await axios.get(`${API_URL}/api/ai/observability`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (role === 'admin') console.log(`✅ ${role} -> ${res.status}`);
      else console.error(`❌ ${role} unexpected status: ${res.status}`);
    } catch (err: any) {
      if (role !== 'admin' && err.response?.status === 403) {
        console.log(`✅ ${role} -> 403`);
      } else {
        console.error(`❌ ${role} unexpected status: ${err.response?.status}`);
      }
    }
  }
}

testRBAC();
