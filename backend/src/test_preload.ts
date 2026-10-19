import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import {
  enforceLocalTestEnvironment,
  assertApprovedLocalEnvironment,
  assertLocalSupabaseUrl,
  assertLocalPostgresUrl,
  LocalDatabaseGuardError,
  maskUrlCredentials,
} from './utils/localDatabaseGuard';

// 1. Force load .env.local with strict override to guarantee local precedence
const envLocalPath = path.resolve(__dirname, '../.env.local');
if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath, override: true });
}

// 2. Enforce local environment and verify fail-closed invariants
enforceLocalTestEnvironment('TestPreload');

// 3. Re-export guards for seamless use in test suites
export {
  enforceLocalTestEnvironment,
  assertApprovedLocalEnvironment,
  assertLocalSupabaseUrl,
  assertLocalPostgresUrl,
  LocalDatabaseGuardError,
  maskUrlCredentials,
};
