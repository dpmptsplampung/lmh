'use client';

import { useState, useEffect } from 'react';
import {
  HelpCircle,
  Edit2,
  Trash2,
  Save,
  RotateCcw,
  Building2,
  Loader2,
  MessageSquare,
  AlertCircle,
  Sparkles,
} from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/Toast';
import styles from './faq.module.css';

interface Layanan {
  id: string;
  nama: string;
  chatbot_aktif: boolean;
}

interface FAQ {
  id: string;
  layanan_id: string;
  pertanyaan: string;
  jawaban: string;
  dasar_hukum?: string | null;
  aktif: boolean;
  urutan: number;
}

export default function AdminFAQPage() {
  const { toast } = useToast();
  const [layananList, setLayananList] = useState<Layanan[]>([]);
  const [selectedLayananId, setSelectedLayananId] = useState('');
  const [faqList, setFaqList] = useState<FAQ[]>([]);
  const [loading, setLoading] = useState(true);
  const [layananError, setLayananError] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Form States
  const [editingFaqId, setEditingFaqId] = useState<string | null>(null);
  const [formPertanyaan, setFormPertanyaan] = useState('');
  const [formJawaban, setFormJawaban] = useState('');
  const [formDasarHukum, setFormDasarHukum] = useState('');
  const [formAktif, setFormAktif] = useState(true);
  const [formUrutan, setFormUrutan] = useState(0);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Embedding RAG: generate ulang embedding FAQ yang belum punya (max 50/panggilan)
  const [embedding, setEmbedding] = useState(false);

  const generateEmbeddings = async (): Promise<boolean> => {
    try {
      const res = await fetch('/api/admin/faq/embed', { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast(data?.error || 'Gagal membuat embedding FAQ', 'error');
        return false;
      }
      toast(
        `Embedding diperbarui: ${data?.embedded ?? 0} berhasil, ${data?.failed ?? 0} gagal` +
          (data?.remaining ? ` (sisa ${data.remaining} belum di-embed)` : ''),
        'success',
      );
      return true;
    } catch {
      toast('Gagal membuat embedding FAQ', 'error');
      return false;
    }
  };

  const handleGenerateEmbeddings = async () => {
    if (embedding) return;
    setEmbedding(true);
    await generateEmbeddings();
    setEmbedding(false);
  };

  // I4: prefill pertanyaan from query param (?prefill_pertanyaan=...)
  // Used by the admin AI-log page "Tambah ke FAQ" action.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const prefill = params.get('prefill_pertanyaan');
    if (prefill) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFormPertanyaan(prefill);
    }
  }, []);

  // Load Layanan
  useEffect(() => {
    async function loadLayanan() {
      try {
        const supabase = createClient();
        const { data, error: fetchErr } = await supabase
          .from('layanan')
          .select('id, nama, chatbot_aktif')
          .order('nama');

        if (fetchErr) throw fetchErr;

        setLayananList(data || []);
        setLayananError(false);
        if (data && data.length > 0) {
          setSelectedLayananId(data[0].id);
        }
      } catch {
        setLayananList([]);
        setLayananError(true);
        toast('Gagal memuat layanan', 'error');
      }
    }
    loadLayanan();
  }, [toast]);

  // Load FAQs when selected service changes or refresh triggered
  useEffect(() => {
    if (!selectedLayananId) return;

    async function loadFAQs() {
      try {
        const supabase = createClient();
        const { data, error: fetchErr } = await supabase
          .from('faq_knowledge_base')
          .select('id, layanan_id, pertanyaan, jawaban, dasar_hukum, aktif, urutan')
          .eq('layanan_id', selectedLayananId)
          .order('urutan', { ascending: true });

        if (fetchErr) throw fetchErr;
        setFaqList(data || []);
      } catch {
        setFaqList([]);
        toast('Gagal memuat FAQ', 'error');
      } finally {
        setLoading(false);
      }
    }
    loadFAQs();
  }, [selectedLayananId, refreshTrigger, toast]);

  // Toggle chatbot state per-service
  const handleToggleChatbot = async (id: string, currentVal: boolean) => {
    const supabase = createClient();
    try {
      const newVal = !currentVal;
      const { error: updateErr } = await supabase
        .from('layanan')
        .update({ chatbot_aktif: newVal })
        .eq('id', id);

      if (updateErr) throw updateErr;

      setLayananList((prev) =>
        prev.map((l) => (l.id === id ? { ...l, chatbot_aktif: newVal } : l))
      );
      toast('Status chatbot layanan berhasil diperbarui', 'success');
    } catch {
      setLayananList((prev) =>
        prev.map((l) => (l.id === id ? { ...l, chatbot_aktif: !currentVal } : l))
      );
      toast('Gagal memperbarui status chatbot', 'error');
    }
  };

  const handleEdit = (faq: FAQ) => {
    setEditingFaqId(faq.id);
    setFormPertanyaan(faq.pertanyaan);
    setFormJawaban(faq.jawaban);
    setFormDasarHukum(faq.dasar_hukum || '');
    setFormAktif(faq.aktif);
    setFormUrutan(faq.urutan);
  };

  const handleResetForm = () => {
    setEditingFaqId(null);
    setFormPertanyaan('');
    setFormJawaban('');
    setFormDasarHukum('');
    setFormAktif(true);
    setFormUrutan(faqList.length + 1);
    setError('');
  };

  const handleSubmitFaq = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formPertanyaan.trim() || !formJawaban.trim()) {
      setError('Pertanyaan dan Jawaban wajib diisi!');
      return;
    }

    setSaving(true);
    setError('');

    const supabase = createClient();

    try {
      if (editingFaqId) {
        const { error: editErr } = await supabase
          .from('faq_knowledge_base')
          .update({
            pertanyaan: formPertanyaan.trim(),
            jawaban: formJawaban.trim(),
            dasar_hukum: formDasarHukum.trim() || null,
            aktif: formAktif,
            urutan: formUrutan,
            // Konten berubah → embedding lama tidak valid; null-kan supaya
            // di-embed ulang oleh /api/admin/faq/embed (yang hanya memproses
            // baris embedding IS NULL).
            embedding: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', editingFaqId);

        if (editErr) throw editErr;
        toast('FAQ berhasil diperbarui', 'success');
      } else {
        const { error: insertErr } = await supabase.from('faq_knowledge_base').insert({
          layanan_id: selectedLayananId,
          pertanyaan: formPertanyaan.trim(),
          jawaban: formJawaban.trim(),
          dasar_hukum: formDasarHukum.trim() || null,
          aktif: formAktif,
          urutan: formUrutan,
        });

        if (insertErr) throw insertErr;
        toast('FAQ baru berhasil ditambahkan', 'success');
      }

      handleResetForm();
      setRefreshTrigger((prev) => prev + 1);

      // Auto-generate embedding RAG untuk FAQ baru/diubah (best-effort).
      await generateEmbeddings();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Gagal menyimpan FAQ.';
      setError(errorMsg);
      toast(errorMsg, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Apakah Anda yakin ingin menghapus FAQ ini?')) return;

    const supabase = createClient();
    try {
      const { error: delErr } = await supabase
        .from('faq_knowledge_base')
        .delete()
        .eq('id', id);

      if (delErr) throw delErr;

      toast('FAQ berhasil dihapus', 'success');
      setRefreshTrigger((prev) => prev + 1);
    } catch {
      toast('Gagal menghapus FAQ', 'error');
    }
  };

  const getSelectedLayanan = () => {
    return layananList.find((l) => l.id === selectedLayananId);
  };

  return (
    <>
      <PageHeader
        title="Kelola Chatbot & FAQ"
        description="Atur kecerdasan bot otomatis dan kelola knowledge base tanya-jawab tiap loket layanan"
      />

      <div className={styles.faqPage}>
        {/* Banner Pesan */}
        {error && (
          <div className="form-error" style={{ marginBottom: 'var(--space-6)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <AlertCircle size={16} />
            {error}
          </div>
        )}

        {/* Layanan selector filter */}
        <div className={styles.serviceFilter}>
          <label className="form-label" htmlFor="filterLayanan">Loket Layanan Tujuan:</label>
          <select
            id="filterLayanan"
            className="form-select"
            value={selectedLayananId}
            onChange={(e) => {
              setLoading(true);
              setSelectedLayananId(e.target.value);
              handleResetForm();
            }}
            disabled={layananError}
          >
            {layananList.map((l) => (
              <option key={l.id} value={l.id}>{l.nama}</option>
            ))}
          </select>
        </div>

        {layananError ? (
          <div className={styles.faqListCard} style={{ textAlign: 'center', padding: 'var(--space-10)', color: 'var(--color-danger-600)' }}>
            <AlertCircle size={40} style={{ margin: '0 auto var(--space-2)', opacity: 0.5 }} />
            <p style={{ fontSize: 'var(--text-sm)' }}>Gagal memuat daftar layanan.</p>
          </div>
        ) : (
          <div className={styles.faqLayout}>
            {/* Sisi Kiri: Config & List FAQ */}
            <div>
              {/* Status Chatbot Per-layanan */}
              {getSelectedLayanan() && (
                <div className={styles.serviceCard}>
                  <div className={styles.serviceHeader}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                      <Building2 size={20} style={{ color: 'var(--color-primary-600)' }} />
                      <span className={styles.serviceTitle}>{getSelectedLayanan()?.nama}</span>
                    </div>

                    <div className={styles.toggleContainer}>
                      <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)' }}>
                        Auto-reply Chatbot Bot:
                      </span>
                      <button
                        className={`btn btn--sm ${getSelectedLayanan()?.chatbot_aktif ? 'btn--primary' : 'btn--secondary'}`}
                        onClick={() => handleToggleChatbot(selectedLayananId, getSelectedLayanan()?.chatbot_aktif || false)}
                      >
                        {getSelectedLayanan()?.chatbot_aktif ? 'AKTIF (On)' : 'NONAKTIF (Off)'}
                      </button>
                    </div>
                  </div>
                  <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', margin: 0 }}>
                    Jika chatbot AKTIF, pesan pengunjung yang masuk di layanan ini akan dijawab otomatis oleh bot jika kata kuncinya sesuai FAQ di bawah. Jika tidak aktif, chat langsung diteruskan ke petugas loket.
                  </p>
                </div>
              )}

              {/* List FAQ */}
              <div className={styles.faqListCard}>
                <div className={styles.faqListHeader}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <MessageSquare size={18} style={{ color: 'var(--color-primary-600)' }} />
                    <span className={styles.faqListTitle}>Database Knowledge Base FAQ</span>
                  </div>
                  <button
                    type="button"
                    className="btn btn--secondary btn--sm"
                    onClick={handleGenerateEmbeddings}
                    disabled={embedding || loading}
                  >
                    {embedding ? (
                      <><Loader2 size={14} className="animate-pulse" /> Membuat Embedding...</>
                    ) : (
                      <><Sparkles size={14} /> Generate Embedding</>
                    )}
                  </button>
                </div>

                {loading ? (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-10)' }}>
                    <div className="spinner" />
                  </div>
                ) : (
                  <div className={styles.faqItems}>
                    {faqList.length > 0 ? (
                      faqList.map((faq) => (
                        <div key={faq.id} className={styles.faqItem}>
                          <div className={styles.faqQuestionRow}>
                            <span className={styles.faqQuestion}>Q: {faq.pertanyaan}</span>
                            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                              <button
                                className="btn btn--secondary btn--sm"
                                style={{ padding: '4px 8px' }}
                                onClick={() => handleEdit(faq)}
                              >
                                <Edit2 size={12} />
                              </button>
                              <button
                                className="btn btn--ghost btn--sm"
                                style={{ padding: '4px 8px', color: 'var(--color-danger-600)' }}
                                onClick={() => handleDelete(faq.id)}
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          </div>
                          <p className={styles.faqAnswer}>A: {faq.jawaban}</p>
                          {faq.dasar_hukum && (
                            <div style={{ fontSize: '11px', color: 'var(--color-primary-700)', fontWeight: 600, marginTop: '4px' }}>
                              📜 Dasar Hukum: {faq.dasar_hukum}
                            </div>
                          )}
                          <div className={styles.faqMetaRow}>
                            <span className={`badge ${faq.aktif ? 'badge--published' : 'badge--nonaktif'}`}>
                              {faq.aktif ? 'Aktif' : 'Nonaktif'}
                            </span>
                            <span>Urutan: {faq.urutan}</span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div style={{ textAlign: 'center', padding: 'var(--space-10)', color: 'var(--text-tertiary)' }}>
                        <HelpCircle size={40} style={{ margin: '0 auto var(--space-2)', opacity: 0.5 }} />
                        <p style={{ fontSize: 'var(--text-sm)' }}>Belum ada FAQ untuk layanan ini.</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Sisi Kiri: Form input/edit FAQ */}
            <div className={styles.formCard}>
              <div className={styles.formHeader}>
                <span className={styles.formTitle}>
                  {editingFaqId ? 'Edit FAQ' : 'Tambah FAQ Baru'}
                </span>
                {editingFaqId && (
                  <button className="btn btn--ghost btn--sm" onClick={handleResetForm}>
                    <RotateCcw size={14} /> Reset
                  </button>
                )}
              </div>

              <form className={styles.formBody} onSubmit={handleSubmitFaq}>
                <div className="form-group">
                  <label className="form-label form-label--required" htmlFor="faqQuestion">Pertanyaan (User Chat)</label>
                  <input
                    id="faqQuestion"
                    type="text"
                    className="form-input"
                    placeholder="Contoh: Apa saja syarat membuat NIB?"
                    value={formPertanyaan}
                    onChange={(e) => setFormPertanyaan(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label form-label--required" htmlFor="faqAnswer">Jawaban (Bot Auto-reply)</label>
                  <textarea
                    id="faqAnswer"
                    className="form-textarea"
                    placeholder="Masukkan balasan otomatis chatbot..."
                    value={formJawaban}
                    onChange={(e) => setFormJawaban(e.target.value)}
                    rows={6}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="faqDasarHukum">Dasar Hukum / Peraturan / UU (Opsional)</label>
                  <input
                    id="faqDasarHukum"
                    type="text"
                    className="form-input"
                    placeholder="Contoh: UU No. 6 Tahun 2023 Pasal 12"
                    value={formDasarHukum}
                    onChange={(e) => setFormDasarHukum(e.target.value)}
                  />
                  <span className="form-hint">Disertakan saat AI memberikan rujukan dasar hukum</span>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="faqOrder">Urutan Pencocokan</label>
                  <input
                    id="faqOrder"
                    type="number"
                    className="form-input"
                    value={formUrutan}
                    onChange={(e) => setFormUrutan(parseInt(e.target.value) || 0)}
                  />
                  <span className="form-hint">Makin kecil angkanya, makin awal dicocokkan</span>
                </div>

                <div className="form-group" style={{ flexDirection: 'row', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <input
                    id="faqActive"
                    type="checkbox"
                    checked={formAktif}
                    onChange={(e) => setFormAktif(e.target.checked)}
                  />
                  <label className="form-label" htmlFor="faqActive" style={{ margin: 0, cursor: 'pointer' }}>
                    FAQ Aktif (Siap dicocokkan bot)
                  </label>
                </div>

                <div className={styles.formActions}>
                  <button type="submit" className="btn btn--primary" disabled={saving}>
                    {saving ? (
                      <><Loader2 size={16} className="animate-pulse" /> Menyimpan...</>
                    ) : (
                      <>
                        <Save size={16} />
                        {editingFaqId ? 'Perbarui FAQ' : 'Simpan FAQ'}
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
