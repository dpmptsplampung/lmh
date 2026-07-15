// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readBaseline } from './migration-test-utils';

describe('final anonymous rate-limit maintenance', () => {
  const security = readBaseline(3);
  const jobs = readBaseline(4);

  it('defines private check, log, and seven-day prune helpers', () => {
    expect(security).toMatch(/FUNCTION\s+public\.check_anon_rate/i);
    expect(security).toMatch(/FUNCTION\s+public\.log_anon_action/i);
    expect(security).toMatch(/FUNCTION\s+public\.prune_anon_rate_limit[\s\S]*INTERVAL\s+'7 days'/i);
    expect(security).toMatch(/REVOKE\s+ALL\s+ON\s+TABLE\s+public\.anon_rate_limit\s+FROM\s+anon,\s*authenticated/i);
  });

  it('idempotently schedules daily pruning', () => {
    expect(jobs).toMatch(/cron\.unschedule[\s\S]*prune_anon_rate_limit/i);
    expect(jobs).toMatch(/cron\.schedule\([\s\S]*'prune_anon_rate_limit'[\s\S]*'0 3 \* \* \*'/i);
  });
});
