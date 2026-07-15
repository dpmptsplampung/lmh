// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readBaseline } from './migration-test-utils';

describe('final notification and push baseline', () => {
  const feature = readBaseline(2);
  const security = readBaseline(3);

  it('creates notification queue and user-scoped push subscriptions', () => {
    expect(feature).toMatch(/CREATE\s+TABLE\s+public\.notifikasi/i);
    expect(feature).toMatch(/kanal\s+text[\s\S]*'email'[\s\S]*'web_push'/i);
    expect(feature).toMatch(/CREATE\s+TABLE\s+public\.push_subscriptions/i);
    expect(feature).toMatch(/CREATE\s+UNIQUE\s+INDEX\s+idx_push_sub_endpoint/i);
    expect(security).toMatch(/CREATE\s+POLICY\s+"push_sub_self_insert"[\s\S]*user_id\s*=\s*auth\.uid\(\)/i);
  });

  it('queues visit and UMKM notifications through private definer helpers', () => {
    expect(security).toMatch(/FUNCTION\s+public\.queue_notifikasi/i);
    expect(security).toMatch(/FUNCTION\s+public\.notify_visit_selesai/i);
    expect(security).toMatch(/FUNCTION\s+public\.notify_umkm_approved/i);
    expect(security).toMatch(/REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.queue_notifikasi[\s\S]*FROM\s+PUBLIC,\s*anon,\s*authenticated/i);
  });

  it('attaches a transition-only completed-visit notification with an opaque token URL', () => {
    expect(security).toMatch(/NEW\.status\s*=\s*'selesai'\s+AND\s+OLD\.status\s+IS\s+DISTINCT\s+FROM\s+'selesai'/i);
    expect(security).toMatch(/'\/skm\?token='\s*\|\|\s*NEW\.qr_token/i);
    expect(security).toMatch(/'Layanan Anda telah selesai\. Mohon isi survei: '\s*\|\|/i);
    expect(security).toMatch(/CREATE\s+TRIGGER\s+trg_notify_visit_selesai\s+AFTER\s+UPDATE\s+OF\s+status\s+ON\s+public\.visit[\s\S]*notify_visit_selesai\(\)/i);
  });

  it('queues web_push on visit selesai when visitor has auth_user_id', () => {
    expect(security).toMatch(/visitor\.auth_user_id/i);
    expect(security).toMatch(/'web_push'/i);
    expect(security).toMatch(/skm_survey_push|type',\s*'skm_survey/i);
  });

  it('queues web_push on menunggu and dilayani transitions when visitor has auth_user_id', () => {
    expect(security).toMatch(/NEW\.status\s*=\s*'menunggu'\s+AND\s+OLD\.status\s+IS\s+DISTINCT\s+FROM\s+'menunggu'/i);
    expect(security).toMatch(/NEW\.status\s*=\s*'dilayani'\s+AND\s+OLD\.status\s+IS\s+DISTINCT\s+FROM\s+'dilayani'/i);
    expect(security).toMatch(/Anda masuk antrean|masuk antrean/i);
    expect(security).toMatch(/Giliran Anda dimulai|giliran anda dimulai/i);
  });

  it('attaches the UMKM publish transition notification to listing updates', () => {
    expect(security).toMatch(/NEW\.status\s*=\s*'published'\s+AND\s+OLD\.status\s+IS\s+DISTINCT\s+FROM\s+'published'/i);
    expect(security).toMatch(/CREATE\s+TRIGGER\s+trg_notify_umkm_approved\s+AFTER\s+UPDATE\s+OF\s+status\s+ON\s+public\.listing_umkm/i);
  });
});
