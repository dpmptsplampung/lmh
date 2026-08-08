// supabase/migrations/chat_realtime_publication.test.ts
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

const sql = readFileSync(
  join(__dirname, '202608080001_chat_realtime_publication.sql'),
  'utf8',
);

describe('chat realtime publication migration', () => {
  it('adds chat_sesi and chat_pesan to supabase_realtime publication', () => {
    expect(sql).toMatch(/ALTER PUBLICATION supabase_realtime ADD TABLE public\.chat_sesi/i);
    expect(sql).toMatch(/ALTER PUBLICATION supabase_realtime ADD TABLE public\.chat_pesan/i);
  });
  it('sets REPLICA IDENTITY FULL on both tables', () => {
    expect(sql).toMatch(/ALTER TABLE public\.chat_sesi REPLICA IDENTITY FULL/i);
    expect(sql).toMatch(/ALTER TABLE public\.chat_pesan REPLICA IDENTITY FULL/i);
  });
});
