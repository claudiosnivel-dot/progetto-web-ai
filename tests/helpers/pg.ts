import { Client } from 'pg';

// Helper di test: connessione Postgres DIRETTA all'istanza locale (DATABASE_URL).
// Serve alle asserzioni sui cataloghi di sistema (information_schema, pg_class,
// pg_policies, pg_proc) che PostgREST non espone. Solo lato Node, mai nel bundle app.
export async function pgQuery<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const res = await client.query(sql, params);
    return res.rows as T[];
  } finally {
    await client.end();
  }
}
