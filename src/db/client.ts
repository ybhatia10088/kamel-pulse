import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

// Falls back to a syntactically valid placeholder so route modules can be
// statically imported/bundled (Next's build-time "collect page data" step)
// without a real DATABASE_URL present. Any actual query still fails at
// request time until a real connection string is set.
const sql = neon(
  process.env.DATABASE_URL ?? 'postgres://placeholder:placeholder@localhost:5432/placeholder'
);

export const db = drizzle(sql, { schema });
