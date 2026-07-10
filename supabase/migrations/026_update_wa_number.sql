-- ============================================================
-- Migration 026: Update wa_number ke nomor resmi DPMPTSP
-- Fase 1 / B4: Pisahkan seed demo
-- ============================================================
--
-- Mengganti placeholder fake `6281234567890` (migration 016)
-- dengan nomor WhatsApp DPMPTSP Provinsi Lampung.
--
-- CATATAN: `6281277000000` adalah placeholder format yang plausibel.
-- Ganti dengan nomor resmi yang sebenarnya saat dikonfirmasi oleh tim DPMPTSP.
-- ============================================================

UPDATE site_settings SET value = '6281277000000' WHERE key = 'wa_number';

-- ROLLBACK: UPDATE site_settings SET value = '6281234567890' WHERE key = 'wa_number';
