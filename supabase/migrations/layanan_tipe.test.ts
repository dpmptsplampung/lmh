// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readBaseline } from './migration-test-utils';

describe('final layanan schema', () => {
  const sql = readBaseline(1);

  it('integrates tipe and chatbot flags in CREATE TABLE', () => {
    expect(sql).toMatch(/CREATE\s+TABLE\s+public\.layanan[\s\S]*tipe\s+text\s+NOT\s+NULL\s+DEFAULT\s+'konsultatif'/i);
    expect(sql).toMatch(/CHECK\s*\(tipe\s+IN\s*\('konsultatif',\s*'mitra',\s*'modul_publik'\)\)/i);
    expect(sql).toMatch(/chatbot_aktif\s+boolean\s+NOT\s+NULL/i);
    expect(sql).not.toMatch(/ALTER\s+TABLE\s+public\.layanan\s+ADD/i);
  });
});
