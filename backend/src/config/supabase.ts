import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

import path from 'path';
import fs from 'fs';

dotenv.config();
const envLocalPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath, override: false });
}

const SUPABASE_URL = process.env.SUPABASE_URL;
// Use the SERVICE ROLE key on the backend only — it bypasses Row Level
// Security, which is what lets this server read/write freely like the old
// Mongoose connection did. Never expose this key to the frontend.
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables. ' +
    'Add them to your .env file (see .env.example).'
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
