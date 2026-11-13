import { existsSync, readFileSync } from 'node:fs';
import dotenv from 'dotenv';

// Load the test environment and make sure we never touch the development database.
const devEnv = existsSync('.env') ? dotenv.parse(readFileSync('.env')) : {};
dotenv.config({ path: '.env.test', override: true });

if (!process.env.DATABASE_URL) {
  throw new Error('.env.test must define DATABASE_URL (a separate test database)');
}
if (process.env.DATABASE_URL === devEnv.DATABASE_URL) {
  throw new Error('DATABASE_URL in .env.test must differ from the development database');
}
process.env.JWT_SECRET ??= 'test-secret';
