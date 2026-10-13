// One-off fix script: replace antrean_broadcast to use realtime.send
// (broadcast_changes record/jsonb signature mismatch broke ALL inserts to
// visit & tiket_antrean in production). Idempotent, touches no data.
import { Client } from 'pg';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')];
    }),
);

const sql = `
CREATE OR REPLACE FUNCTION public.antrean_broadcast()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, realtime
AS $fn$
DECLARE
  v_payload jsonb;
BEGIN
  v_payload := jsonb_build_object(
    'tiket_id', NEW.id,
    'layanan_id', NEW.layanan_id,
    'nomor_display', NEW.nomor_display,
    'status', NEW.status
  );
  PERFORM realtime.send(
    v_payload, TG_OP::text, 'antrean:publik'::text, false
  );
  RETURN NULL;
END
$fn$;
`;

const c = new Client({ connectionString: env.DIRECT_URL, ssl: { rejectUnauthorized: false } });
try {
  await c.connect();
  await c.query(sql);
  console.log('OK: antrean_broadcast() replaced (realtime.send)');
} catch (e) {
  console.error('ERR:', e.message);
  process.exit(1);
} finally {
  await c.end();
}
