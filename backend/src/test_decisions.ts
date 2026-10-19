import './test_preload';
import { assertApprovedLocalEnvironment } from './utils/localDatabaseGuard';

assertApprovedLocalEnvironment('TestDecisions');

import axios from 'axios';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
dotenv.config();
assertApprovedLocalEnvironment('TestDecisions');

const API_URL = 'http://localhost:5000';
const JWT_SECRET = process.env.JWT_SECRET || 'farmchain_super_secret_key';

function getToken(role: string) {
  return jwt.sign({ id: 'test-user-id', role }, JWT_SECRET, { expiresIn: '1h' });
}

async function testDecisions() {
  const roles = ['farmer', 'processor', 'distributor', 'retailer', 'consumer', 'admin'];
  
  console.log('Testing RBAC for /api/decisions');
  
  // No JWT
  try {
    await axios.get(`${API_URL}/api/decisions`);
    console.error('❌ Expected 401 for No JWT');
  } catch (err: any) {
    if (err.response?.status === 401) console.log('✅ No JWT -> 401');
    else console.error(`❌ No JWT unexpected status: ${err.response?.status}`);
  }

  for (const role of roles) {
    const token = getToken(role);
    try {
      const res = await axios.get(`${API_URL}/api/decisions`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      console.log(`✅ ${role} -> ${res.status}`);
      if (res.data?.data) {
        console.log(`   Data status: ${res.data.data.status}, signals: ${res.data.data.signals?.length}`);
      }
    } catch (err: any) {
      if (role === 'consumer' && err.response?.status === 403) {
        console.log(`✅ ${role} -> 403 (Consumer is not authorized)`);
      } else {
        console.error(`❌ ${role} unexpected status: ${err.response?.status}`, err.response?.data);
      }
    }
  }
}

testDecisions();
