import './src/test_preload';
import { assertApprovedLocalEnvironment } from './src/utils/localDatabaseGuard';

assertApprovedLocalEnvironment('TestProcessor');

import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();
assertApprovedLocalEnvironment('TestProcessor');

const API_URL = 'http://localhost:5000/api';

async function testProcessor() {
  console.log('Testing Processor Endpoints...');
  try {
    // 1. Authenticate as a farmer (to test 403)
    const farmerRes = await axios.post(`${API_URL}/auth/login`, {
      email: 'john@example.com', // Assuming john is farmer from test data
      password: 'password123'
    }).catch(e => e.response);

    const farmerToken = farmerRes.data?.data?.token;
    if (farmerToken) {
      console.log('Farmer logged in successfully.');
      // 2. Farmer attempts to access processor routes (should fail)
      const res403 = await axios.get(`${API_URL}/processor/requests`, {
        headers: { Authorization: `Bearer ${farmerToken}` }
      }).catch(e => e.response);
      console.log('Farmer access to processor/requests:', res403.status === 403 ? 'PASS (403)' : `FAIL (${res403.status})`);
    }

    // 3. Unauthenticated access (should fail)
    const res401 = await axios.get(`${API_URL}/processor/requests`).catch(e => e.response);
    console.log('Unauthenticated access:', res401.status === 401 ? 'PASS (401)' : `FAIL (${res401.status})`);

    // Let's create a Processor user first to test correctly
    const regRes = await axios.post(`${API_URL}/auth/register`, {
      name: 'Test Processor',
      email: 'processor_test@example.com',
      password: 'password123',
      role: 'processor'
    }).catch(e => e.response);

    let token = '';
    if (regRes.status === 201) {
      token = regRes.data.data.token;
    } else {
      const loginRes = await axios.post(`${API_URL}/auth/login`, {
        email: 'processor_test@example.com',
        password: 'password123'
      });
      token = loginRes.data.data.token;
    }

    // 4. Processor views requests
    const reqRes = await axios.get(`${API_URL}/processor/requests`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log('Processor views requests:', reqRes.status === 200 ? `PASS (${reqRes.data.data.length} found)` : 'FAIL');

    // 5. Claim a request
    if (reqRes.data.data.length > 0) {
      const targetReq = reqRes.data.data[0].id;
      const claimRes = await axios.post(`${API_URL}/processor/requests/${targetReq}/claim`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      }).catch(e => e.response);
      console.log('Claim request:', (claimRes.status === 200 || claimRes.status === 409) ? `PASS (${claimRes.status})` : `FAIL (${claimRes.status})`);

      // 6. Another processor tries to claim the same request
      const regRes2 = await axios.post(`${API_URL}/auth/register`, {
        name: 'Test Processor 2',
        email: 'processor_test2@example.com',
        password: 'password123',
        role: 'processor'
      }).catch(e => e.response);

      let token2 = '';
      if (regRes2.status === 201) {
        token2 = regRes2.data.data.token;
      } else {
        const loginRes2 = await axios.post(`${API_URL}/auth/login`, {
          email: 'processor_test2@example.com',
          password: 'password123'
        });
        token2 = loginRes2.data.data.token;
      }

      const claimRes2 = await axios.post(`${API_URL}/processor/requests/${targetReq}/claim`, {}, {
        headers: { Authorization: `Bearer ${token2}` }
      }).catch(e => e.response);
      console.log('Second processor claims same request:', claimRes2.status === 409 ? 'PASS (409 Conflict)' : `FAIL (${claimRes2.status})`);
    }

    // 7. Get Batches
    const batchRes = await axios.get(`${API_URL}/processor/batches`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log('Processor views batches:', batchRes.status === 200 ? 'PASS (200)' : 'FAIL');

  } catch (error) {
    console.error('Test script error:', error);
  }
}

testProcessor();
