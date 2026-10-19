import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

export class LocalDatabaseGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocalDatabaseGuardError';
  }
}

export const APPROVED_LOCAL_HOSTS = ['127.0.0.1', 'localhost'];
export const APPROVED_LOCAL_SUPABASE_PORT = '54321';
export const APPROVED_LOCAL_POSTGRES_PORT = '54322';
export const APPROVED_LOCAL_POSTGRES_DB = 'postgres';

/**
 * Safely masks passwords and sensitive tokens in a URL string for logging and errors.
 */
export function maskUrlCredentials(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.password) {
      parsed.password = '***';
    }
    return parsed.toString();
  } catch {
    // If not a parseable URL, mask basic credential patterns
    return rawUrl.replace(/:([^@/]+)@/, ':***@');
  }
}

/**
 * Asserts that a given Supabase URL points strictly to the approved local Supabase container (127.0.0.1:54321 or localhost:54321).
 * Fails closed if undefined, invalid, remote, or pointing to a hosted Supabase project.
 */
export function assertLocalSupabaseUrl(url?: string | null, context: string = 'General'): void {
  if (!url || typeof url !== 'string' || url.trim() === '') {
    throw new LocalDatabaseGuardError(
      `[LOCAL_DATABASE_GUARD_FAILED] [${context}] Missing or empty SUPABASE_URL. Operation aborted before any database access.`
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (err: any) {
    throw new LocalDatabaseGuardError(
      `[LOCAL_DATABASE_GUARD_FAILED] [${context}] Malformed SUPABASE_URL '${maskUrlCredentials(url)}'. Operation aborted.`
    );
  }

  const isLocalHost = APPROVED_LOCAL_HOSTS.includes(parsed.hostname);
  const isApprovedPort = parsed.port === APPROVED_LOCAL_SUPABASE_PORT;
  const isAllowedProtocol = parsed.protocol === 'http:' || (parsed.protocol === 'https:' && parsed.hostname === 'localhost');

  if (!isLocalHost || !isApprovedPort || !isAllowedProtocol || parsed.hostname.includes('supabase.co')) {
    throw new LocalDatabaseGuardError(
      `[LOCAL_DATABASE_GUARD_FAILED] [${context}] FAIL-CLOSED: Target Supabase URL '${maskUrlCredentials(url)}' is not the approved local development database. ` +
      `Expected host '127.0.0.1' or 'localhost' on port '${APPROVED_LOCAL_SUPABASE_PORT}'. Operation aborted before any database access.`
    );
  }
}

/**
 * Asserts that a PostgreSQL connection string points strictly to the approved local PostgreSQL container (127.0.0.1:54322/postgres).
 * Fails closed if undefined, invalid, remote, or pointing to an unapproved host/port/database.
 */
export function assertLocalPostgresUrl(connectionString?: string | null, context: string = 'General'): void {
  if (!connectionString || typeof connectionString !== 'string' || connectionString.trim() === '') {
    throw new LocalDatabaseGuardError(
      `[LOCAL_DATABASE_GUARD_FAILED] [${context}] Missing or empty PostgreSQL connection string. Operation aborted before any database access.`
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch (err: any) {
    throw new LocalDatabaseGuardError(
      `[LOCAL_DATABASE_GUARD_FAILED] [${context}] Malformed PostgreSQL connection string '${maskUrlCredentials(connectionString)}'. Operation aborted.`
    );
  }

  const isPostgresProtocol = parsed.protocol === 'postgresql:' || parsed.protocol === 'postgres:';
  const isLocalHost = APPROVED_LOCAL_HOSTS.includes(parsed.hostname);
  const isApprovedPort = parsed.port === APPROVED_LOCAL_POSTGRES_PORT;
  const dbName = parsed.pathname.replace(/^\//, '');
  const isApprovedDb = dbName === APPROVED_LOCAL_POSTGRES_DB;

  if (!isPostgresProtocol || !isLocalHost || !isApprovedPort || !isApprovedDb || parsed.hostname.includes('supabase.co')) {
    throw new LocalDatabaseGuardError(
      `[LOCAL_DATABASE_GUARD_FAILED] [${context}] FAIL-CLOSED: Target PostgreSQL connection '${maskUrlCredentials(connectionString)}' is not the approved local development database. ` +
      `Expected 'postgresql://postgres:***@127.0.0.1:${APPROVED_LOCAL_POSTGRES_PORT}/${APPROVED_LOCAL_POSTGRES_DB}'. Operation aborted before any database access.`
    );
  }
}

/**
 * Asserts that the current process environment has loaded and locked the approved local development targets.
 */
export function assertApprovedLocalEnvironment(context: string = 'General'): void {
  assertLocalSupabaseUrl(process.env.SUPABASE_URL, context);

  if (process.env.LOCAL_DB_URL) {
    assertLocalPostgresUrl(process.env.LOCAL_DB_URL, context);
  }
  if (process.env.DATABASE_URL) {
    assertLocalPostgresUrl(process.env.DATABASE_URL, context);
  }
}

/**
 * Enforces local development test environment with override precedence.
 * Loads .env.local with override: true and enforces that SUPABASE_URL and LOCAL_DB_URL point locally.
 */
export function enforceLocalTestEnvironment(context: string = 'TestPreload'): void {
  const envLocalPath = path.resolve(__dirname, '../../.env.local');
  if (fs.existsSync(envLocalPath)) {
    dotenv.config({ path: envLocalPath, override: true });
  }

  // Ensure baseline defaults if missing
  if (!process.env.SUPABASE_URL) {
    process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
  }
  if (!process.env.LOCAL_DB_URL) {
    process.env.LOCAL_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
  }

  // Fail closed immediately if environment does not match local targets
  assertApprovedLocalEnvironment(context);
}
