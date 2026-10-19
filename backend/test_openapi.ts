import './src/test_preload';
import { assertApprovedLocalEnvironment } from './src/utils/localDatabaseGuard';

assertApprovedLocalEnvironment('TestOpenApi');

import dotenv from 'dotenv';
dotenv.config();
assertApprovedLocalEnvironment('TestOpenApi');
import axios from 'axios';

async function fetchSchema() {
  assertApprovedLocalEnvironment('TestOpenApi');
  const url = `${process.env.SUPABASE_URL}/rest/v1/`;
  try {
    const res = await axios.get(url, {
      headers: {
        'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY!,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`
      }
    });

    const tables = [
      'users', 'products', 'product_requests', 'traceability_events',
      'batch_lineage', 'shipments', 'retailer_inventory', 'retailer_sales',
      'retailer_wastage', 'retailer_returns', 'notifications'
    ];

    for (const table of tables) {
      if (res.data.definitions && res.data.definitions[table]) {
        console.log(`\nTable ${table}:`);
        const props = res.data.definitions[table].properties;
        for (const [colName, colDef] of Object.entries(props)) {
          console.log(`  ${colName}: ${(colDef as any).type} (${(colDef as any).format})`);
        }
      } else {
        console.log(`\nTable ${table}: NOT FOUND IN OPENAPI SPEC`);
      }
    }
  } catch (error: any) {
    console.error("Error fetching schema:", error.message);
  }
}
fetchSchema();
