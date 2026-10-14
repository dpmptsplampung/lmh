import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATION_PATH = resolve(
  __dirname,
  '../../../supabase/migrations/202607140004_security_and_automation.sql',
);

const readMigration = (): string => {
  try {
    return readFileSync(MIGRATION_PATH, 'utf-8');
  } catch {
    return '';
  }
};

function stripSqlComments(sql: string) {
  let result = '';
  let quote: "'" | '"' | null = null;
  let lineComment = false;
  let blockComment = false;

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const next = sql[i + 1];
    if (lineComment) {
      if (char === '\n') {
        lineComment = false;
        result += char;
      }
    } else if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        i++;
      }
    } else if (quote) {
      result += char;
      if (char === quote && next === quote) {
        result += next;
        i++;
      } else if (char === quote) {
        quote = null;
      }
    } else if (char === "'" || char === '"') {
      quote = char;
      result += char;
    } else if (char === '-' && next === '-') {
      lineComment = true;
      i++;
    } else if (char === '/' && next === '*') {
      blockComment = true;
      i++;
    } else {
      result += char;
    }
  }

  return result;
}

function extractFinalActivePolicy(sql: string, name: string, table: string) {
  const activeSql = stripSqlComments(sql);
  const matches = activeSql.matchAll(
    new RegExp(
      `CREATE\\s+POLICY\\s+"${name}"\\s+ON\\s+${table}[\\s\\S]*?;`,
      'gi',
    ),
  );
  return Array.from(matches).at(-1)?.[0];
}

function extractWithCheckExpression(statement: string) {
  const clause = /\bWITH\s+CHECK\s*\(/i.exec(statement);
  if (!clause) return undefined;

  const start = clause.index + clause[0].length;
  let depth = 1;
  for (let i = start; i < statement.length; i++) {
    if (statement[i] === '(') depth++;
    if (statement[i] === ')' && --depth === 0) return statement.slice(start, i);
  }
  return undefined;
}

function isSecureVisitInsertPolicy(sql: string) {
  const statement = extractFinalActivePolicy(
    sql,
    'visit_insert_walk_in',
    'public.visit',
  );
  const withCheck = statement && extractWithCheckExpression(statement);
  return Boolean(
    statement &&
    withCheck &&
    /FOR\s+INSERT\s+TO\s+authenticated/i.test(statement) &&
    !/\btrue\b/i.test(withCheck) &&
    /^\s*asal\s*=\s*'walk_in'\s+AND\s*\(\s*public\.get_my_role\s*\(\s*\)\s+IN\s*\(\s*'petugas'\s*,\s*'admin'\s*\)\s+OR\s+public\.check_anon_rate\s*\(\s*'visit_insert_walk_in'\s*,\s*5\s*,\s*60\s*\)\s*\)\s*$/i.test(withCheck),
  );
}

describe('final check-in RLS baseline contract', () => {
  const sql = readMigration();

  it('exists at the expected path', () => {
    expect(sql.length).toBeGreaterThan(0);
  });

  it('defines the check_anon_rate function', () => {
    expect(sql).toMatch(/CREATE\s+FUNCTION\s+public\.check_anon_rate/i);
  });

  it('defines the log_anon_action trigger function', () => {
    expect(sql).toMatch(/CREATE\s+FUNCTION\s+public\.log_anon_action/i);
  });

  it('revokes direct client access to anon_rate_limit', () => {
    expect(sql).toMatch(
      /REVOKE\s+ALL\s+ON\s+TABLE\s+public\.anon_rate_limit\s+FROM\s+anon\s*,\s*authenticated/i,
    );
  });

  it('creates final visit walk-in policy with check_anon_rate', () => {
    expect(sql).toMatch(
      /CREATE\s+POLICY\s+"visit_insert_walk_in"\s+ON\s+public\.visit/i,
    );
    expect(sql).toMatch(/check_anon_rate\s*\(\s*'visit_insert_walk_in'\s*,\s*5\s*,\s*60\s*\)/i);
  });

  it('recreates chat_sesi_owner_insert WITH check_anon_rate (3/60s)', () => {
    expect(sql).toMatch(
      /CREATE\s+POLICY\s+"chat_sesi_owner_insert"\s+ON\s+public\.chat_sesi/i,
    );
    expect(sql).toMatch(/check_anon_rate\s*\(\s*'chat_sesi_insert'\s*,\s*3\s*,\s*60\s*\)/i);
  });

  it('recreates chat_pesan_owner_insert WITH check_anon_rate (20/60s)', () => {
    expect(sql).toMatch(
      /CREATE\s+POLICY\s+"chat_pesan_owner_insert"\s+ON\s+public\.chat_pesan/i,
    );
    expect(sql).toMatch(/check_anon_rate\s*\(\s*'chat_pesan_insert'\s*,\s*20\s*,\s*60\s*\)/i);
  });

  it('exempts petugas/admin from rate limiting in public-write policies', () => {
    // Each WITH CHECK must include get_my_role() IN ('petugas','admin')
    // Strip line comments so the ROLLBACK section is ignored.
    const stripped = sql
      .split('\n')
      .map((line) => line.replace(/--.*$/, ''))
      .join('\n');
    // Visit, chat session, chat message, lead, and UMKM inquiry policies use this exemption.
    const matches = stripped.match(
      /get_my_role\s*\(\s*\)\s+IN\s*\(\s*'petugas'\s*,\s*'admin'\s*\)/gi,
    );
    expect(matches?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it('creates final AFTER INSERT accounting triggers', () => {
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+trg_log_visit_insert/i);
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+trg_log_chat_sesi_insert/i);
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+trg_log_chat_pesan_insert/i);
  });

  it('does NOT contain WITH CHECK (true) for visit INSERT (active SQL)', () => {
    expect(isSecureVisitInsertPolicy(sql)).toBe(true);
  });

  it('rejects true OR check_anon_rate in the kunjungan INSERT policy', () => {
    const insecureSql = `
      CREATE POLICY "visit_insert_walk_in" ON public.visit
        FOR INSERT TO authenticated
        WITH CHECK (
          asal = 'walk_in' AND (public.get_my_role() IN ('petugas', 'admin')
          OR public.check_anon_rate('visit_insert_walk_in', 5, 60))
        );
      CREATE POLICY "visit_insert_walk_in" ON public.visit
        FOR INSERT TO authenticated
        WITH CHECK (
          true OR public.check_anon_rate('visit_insert_walk_in', 5, 60)
        );
    `;

    expect(isSecureVisitInsertPolicy(insecureSql)).toBe(false);
  });

  it('scopes visit INSERT to authenticated', () => {
    // Strip comments so ROLLBACK block is ignored.
    const stripped = sql
      .split('\n')
      .map((line) => line.replace(/--.*$/, ''))
      .join('\n');
    const policyBlock = stripped.match(
      /CREATE\s+POLICY\s+"visit_insert_walk_in"\s+ON\s+public\.visit\s+FOR\s+INSERT\s+TO\s+authenticated/i,
    );
    expect(policyBlock).not.toBeNull();
  });

  it('contains no historical policy drop/recreate cycle', () => {
    expect(stripSqlComments(sql)).not.toMatch(/DROP\s+POLICY/i);
  });
});
