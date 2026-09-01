import { describe, it, expect } from 'vitest';
import { ticketsQuerySchema, exportQuerySchema } from './schemas';

describe('rekap schemas', () => {
  describe('ticketsQuerySchema', () => {
    it('accepts empty input with defaults', () => {
      const r = ticketsQuerySchema.safeParse({});
      expect(r.success).toBe(true);
      if (r.success) {
        expect(r.data.page).toBe(0);
        expect(r.data.page_size).toBe(25);
        expect(r.data.q).toBe('');
        expect(r.data.layanan_id).toBeUndefined();
        expect(r.data.dari).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(r.data.sampai).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    });

    it('accepts all valid params', () => {
      const r = ticketsQuerySchema.safeParse({
        layanan_id: '550e8400-e29b-41d4-a716-446655440000',
        q: 'budi',
        dari: '2026-08-01',
        sampai: '2026-08-31',
        page: '2',
        page_size: '50',
      });
      expect(r.success).toBe(true);
      if (r.success) {
        expect(r.data.page).toBe(2);
        expect(r.data.page_size).toBe(50);
        expect(r.data.q).toBe('budi');
      }
    });

    it('rejects invalid uuid for layanan_id', () => {
      const r = ticketsQuerySchema.safeParse({ layanan_id: 'not-a-uuid' });
      expect(r.success).toBe(false);
    });

    it('rejects q longer than 100 chars', () => {
      const r = ticketsQuerySchema.safeParse({ q: 'a'.repeat(101) });
      expect(r.success).toBe(false);
    });

    it('rejects page_size > 100', () => {
      const r = ticketsQuerySchema.safeParse({ page_size: '101' });
      expect(r.success).toBe(false);
    });

    it('rejects negative page', () => {
      const r = ticketsQuerySchema.safeParse({ page: '-1' });
      expect(r.success).toBe(false);
    });
  });

  describe('exportQuerySchema', () => {
    it('rejects page and page_size', () => {
      const r = exportQuerySchema.safeParse({ page: '0', page_size: '25' });
      expect(r.success).toBe(false);
    });

    it('accepts valid export params', () => {
      const r = exportQuerySchema.safeParse({
        layanan_id: '550e8400-e29b-41d4-a716-446655440000',
        dari: '2026-08-01',
        sampai: '2026-08-31',
        q: 'budi',
      });
      expect(r.success).toBe(true);
    });
  });
});
