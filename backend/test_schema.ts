import './src/test_preload';
import { assertApprovedLocalEnvironment } from './src/utils/localDatabaseGuard';

assertApprovedLocalEnvironment('TestSchema');

import dotenv from 'dotenv';
dotenv.config();
assertApprovedLocalEnvironment('TestSchema');
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function inspectSchema() {
  const tables = [
    'users', 'products', 'product_requests', 'traceability_events',
    'batch_lineage', 'shipments', 'retailer_inventory', 'retailer_sales',
    'retailer_wastage', 'retailer_returns', 'notifications'
  ];

  for (const table of tables) {
    const { data, error } = await supabase.from(table).select('*').limit(1);
    if (error) {
      console.log(`Table ${table}: ERROR - ${error.message}`);
    } else {
      console.log(`Table ${table}: EXISTS`);
      if (data && data.length > 0) {
        console.log(`  Columns inferred from data: ${Object.keys(data[0]).join(', ')}`);
        for (const [k, v] of Object.entries(data[0])) {
          console.log(`    ${k} (${typeof v}) = ${v}`);
        }
      } else {
        console.log('  Exists but empty. Attempting to get schema via invalid insert...');
        const { error: insErr } = await supabase.from(table).insert([{ __invalid_col__: 1 }]);
        if (insErr) console.log(`  Insert Error (Schema Hint): ${insErr.message}`);
      }
    }
  }
}
inspectSchema();
