'use client';

import { useState, useEffect, useMemo } from 'react';
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
import { mutasiInsert, mutasiWajibBaris, pesanMutasi } from '@/lib/supabase/mutate';
import { perluMuatUlang } from '@/components/admin/mutasi-ui';
import { layananFaqBolehDikelola, type OpsiFaqLayanan } from '@/lib/faq-scope';
import { useToast } from '@/components/Toast';
import ErrorRetry from '@/components/ErrorRetry';
import RoleNote from '@/components/admin/RoleNote';
import CobaTanyaBot from '@/components/admin/settings/CobaTanyaBot';
import styles from './faq.module.css';

const ACK_KEY = 'lmh_faq_tanggung_jawab';
const readAck = () => {
  try { return sessionStorage.getItem(ACK_KEY) === '1'; } catch { return false; }
};

// Nilai <option> untuk FAQ umum (layanan_id NULL); id layanan sungguhan adalah UUID sehingga tak bisa bentrok.
const UMUM_KEY = '__umum__';
const keyOpsi = (o: OpsiFaqLayanan) => o.id ?? UMUM_KEY;

interface Layanan {
  id: string;
  nama: string;
  chatbot_aktif: boolean;
}

interface FAQ {
  id: string;
  layanan_id: string | null; // null = FAQ umum (semua layanan)
  pertanyaan: string;
  jawaban: string;
  dasar_hukum?: string | null;
  aktif: boolean;
  urutan: number;
}

export default function AdminFAQPage() {
  const { toast } = useToast();
  const [layananList, setLayananList] = useState<Layanan[]>([]);
  const [layananSelesai, setLayananSelesai] = useState(false); // daftar layanan sudah dimuat (sukses/gagal)
  const [pilihKey, setPilihKey] = useState(''); // pilihan pengguna di dropdown ('' = belum memilih)
  const [faqList, setFaqList] = useState<FAQ[]>([]);
  const [loading, setLoading] = useState(true);
  const [layananError, setLayananError] = useState(false);
  const [layananMuatKe, setLayananMuatKe] = useState(0); // dinaikkan tombol "Muat ulang" untuk memuat ulang layanan
  const [layananMemuat, setLayananMemuat] = useState(false); // muat ulang layanan sedang berjalan
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [role, setRole] = useState<string | null>(null); // null = belum dimuat (atau gagal dimuat: lihat roleError)
  const [roleError, setRoleError] = useState(false); // gagal membaca peran (jaringan/galat DB) != memang tanpa akses
  const [roleMuatKe, setRoleMuatKe] = useState(0);
  const [roleMemuat, setRoleMemuat] = useState(false);
  const [layananPetugasId, setLayananPetugasId] = useState<string | null>(null);
  const [togglingBot, setTogglingBot] = useState(false);
  const isAdmin = role === 'admin';
  const isPetugas = role === 'petugas';
  const isFrontOffice = role === 'front_office';

  // Opsi dropdown = layanan yang BOLEH dikelola peran ini (selaras RLS; lihat lib/faq-scope.ts).
  const opsiLayanan = useMemo(
    () => (role === null ? [] : layananFaqBolehDikelola(role, layananPetugasId, layananList)),
    [role, layananPetugasId, layananList],
  );
  // Pilihan efektif diturunkan (bukan di-set lewat effect): pilihan pengguna bila masih valid, kalau tidak
  // layanan pertama (perilaku lama) atau, bila hanya ada Umum, Umum.
  const selectedKey = useMemo(() => {
    if (opsiLayanan.some((o) => keyOpsi(o) === pilihKey)) return pilihKey;
    const awal = opsiLayanan.find((o) => o.id !== null) ?? opsiLayanan[0];
    return awal ? keyOpsi(awal) : '';
  }, [opsiLayanan, pilihKey]);
  const selectedLayananId: string | null = selectedKey && selectedKey !== UMUM_KEY ? selectedKey : null;
  // Admin dan petugas (berlayanan) butuh daftar layanan; Front Office hanya mengelola "Umum" sehingga gagal
  // memuat layanan tidak boleh memblokirnya.
  const butuhDaftarLayanan = isAdmin || (isPetugas && !!layananPetugasId);
  const layananGagalBlokir = layananError && butuhDaftarLayanan;
  const tanpaAkses = role !== null && layananSelesai && !layananGagalBlokir && opsiLayanan.length === 0;
  // Petugas wajib mencentang pernyataan tanggung jawab sekali per sesi sebelum menyimpan FAQ.
  const [acked, setAcked] = useState(false);
  const [ackChecked, setAckChecked] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAcked(readAck());
  }, []);

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

  // /api/admin/faq/embed khusus Admin (403 untuk Front Office/petugas): dipanggil HANYA bila isAdmin.
  const generateEmbeddings = async (): Promise<boolean> => {
    if (!isAdmin) return false;
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

  // Load Layanan (diulang saat layananMuatKe naik). Kegagalan tidak memblokir Front Office (hanya butuh "Umum");
  // untuk admin/petugas ditampilkan ErrorRetry (lihat layananGagalBlokir), bukan toast saja.
  useEffect(() => {
    let batal = false;
    async function loadLayanan() {
      try {
        const supabase = createClient();
        const { data, error: fetchErr } = await supabase
          .from('layanan')
          .select('id, nama, chatbot_aktif')
          .order('nama');

        if (fetchErr) throw fetchErr;

        if (!batal) {
          setLayananList(data || []);
          setLayananError(false);
        }
      } catch {
        if (!batal) {
          setLayananList([]);
          setLayananError(true);
        }
      } finally {
        if (!batal) {
          setLayananSelesai(true);
          setLayananMemuat(false);
        }
      }
    }
    loadLayanan();
    return () => {
      batal = true;
    };
  }, [layananMuatKe]);

  const handleMuatUlangLayanan = () => {
    if (layananMemuat) return;
    setLayananMemuat(true);
    setLayananMuatKe((n) => n + 1);
  };

  // Load FAQs when selected service changes or refresh triggered.
  // "Umum" = layanan_id IS NULL (bukan eq: `= NULL` tidak pernah cocok di SQL).
  useEffect(() => {
    if (!selectedKey) return;
    let batal = false;

    async function loadFAQs() {
      try {
        const supabase = createClient();
        const dasar = supabase
          .from('faq_knowledge_base')
          .select('id, layanan_id, pertanyaan, jawaban, dasar_hukum, aktif, urutan');
        const { data, error: fetchErr } = await (
          selectedKey === UMUM_KEY ? dasar.is('layanan_id', null) : dasar.eq('layanan_id', selectedKey)
        ).order('urutan', { ascending: true });

        if (fetchErr) throw fetchErr;
        if (!batal) setFaqList(data || []);
      } catch {
        if (!batal) {
          setFaqList([]);
          toast('Gagal memuat FAQ', 'error');
        }
      } finally {
        if (!batal) setLoading(false);
      }
    }
    loadFAQs();
    return () => {
      batal = true;
    };
  }, [selectedKey, refreshTrigger, toast]);

  // RBAC Tahap 0: bot hidup/mati = Admin saja (tabel `layanan` hanya boleh ditulis Admin).
  // Role (+ layanan_id untuk petugas) dibaca dari tabel petugas; selama belum terbukti, semua jalur tulis ditolak.
  // Galat baca (jaringan/DB) dibedakan dari "memang tanpa akses": galat -> roleError (ErrorRetry), baris tak ada -> 'unknown'.
  useEffect(() => {
    let batal = false;
    async function loadRole() {
      try {
        const supabase = createClient();
        const { data: { user }, error: userErr } = await supabase.auth.getUser();
        // Tanpa sesi = tidak ada akses; galat lain (mis. jaringan) = gagal memuat, bukan tanpa akses.
        if (userErr && userErr.name !== 'AuthSessionMissingError') throw userErr;
        if (!user) {
          if (!batal) setRole('unknown');
          return;
        }
        const { data: p, error: pErr } = await supabase
          .from('petugas').select('role, layanan_id').eq('auth_user_id', user.id).maybeSingle();
        if (pErr) throw pErr;
        if (!batal) {
          setLayananPetugasId(p?.layanan_id ?? null);
          setRole(p?.role ?? 'unknown');
          setRoleError(false);
        }
      } catch {
        if (!batal) {
          setRoleError(true);
          toast('Gagal memuat hak akses Anda', 'error');
        }
      } finally {
        if (!batal) setRoleMemuat(false);
      }
    }
    loadRole();
    return () => {
      batal = true;
    };
  }, [roleMuatKe, toast]);

  const handleMuatUlangRole = () => {
    if (roleMemuat) return;
    setRoleMemuat(true);
    setRoleMuatKe((n) => n + 1);
  };

  // Toggle chatbot state per-service (Admin saja; dijaga di handler, bukan hanya di UI)
  const handleToggleChatbot = async (id: string, currentVal: boolean) => {
    if (!isAdmin || togglingBot) return;
    setTogglingBot(true);
    const supabase = createClient();
    try {
      const newVal = !currentVal;
      // RLS yang menolak update = 0 baris tanpa error -> mutasiWajibBaris melempar, tak ada sukses palsu.
      await mutasiWajibBaris(
        supabase.from('layanan').update({ chatbot_aktif: newVal }).eq('id', id).select('id'),
      );

      setLayananList((prev) =>
        prev.map((l) => (l.id === id ? { ...l, chatbot_aktif: newVal } : l))
      );
      toast('Status chatbot layanan berhasil diperbarui', 'success');
    } catch (e) {
      toast(`Gagal memperbarui status chatbot. ${pesanMutasi(e)}`, 'error');
    } finally {
      setTogglingBot(false);
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

    if (!selectedKey) {
      setError('Pilih loket layanan terlebih dahulu.');
      return;
    }

    if (isPetugas && !acked && !ackChecked) {
      setError('Centang pernyataan tanggung jawab isi FAQ terlebih dahulu.');
      return;
    }
    if (isPetugas && !acked) {
      try { sessionStorage.setItem(ACK_KEY, '1'); } catch { /* sesi privat: tanya lagi berikutnya */ }
      setAcked(true);
    }

    setSaving(true);
    setError('');

    const supabase = createClient();

    try {
      if (editingFaqId) {
        // .select('id') + mutasiWajibBaris: RLS yang menolak update = 0 baris tanpa error (audit T2a).
        await mutasiWajibBaris(
          supabase
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
            .eq('id', editingFaqId)
            .select('id'),
        );
        toast('FAQ berhasil diperbarui', 'success');
      } else {
        // selectedLayananId null = FAQ umum (kolom layanan_id NULL).
        await mutasiInsert(
          supabase.from('faq_knowledge_base').insert({
            layanan_id: selectedLayananId,
            pertanyaan: formPertanyaan.trim(),
            jawaban: formJawaban.trim(),
            dasar_hukum: formDasarHukum.trim() || null,
            aktif: formAktif,
            urutan: formUrutan,
          }),
        );
        toast('FAQ baru berhasil ditambahkan', 'success');
      }

      handleResetForm();
      setRefreshTrigger((prev) => prev + 1);

      // Auto-generate embedding RAG untuk FAQ baru/diubah (best-effort) -- hanya Admin yang berhak memanggilnya.
      // Front Office/petugas tidak: embedding baru terisi setelah Admin menjalankannya (lihat catatan di daftar FAQ).
      if (isAdmin) await generateEmbeddings();
    } catch (err) {
      // Isian form sengaja dipertahankan agar pengguna tidak kehilangan tulisannya.
      const errorMsg = pesanMutasi(err, 'Gagal menyimpan FAQ.');
      setError(errorMsg);
      toast(errorMsg, 'error');
      if (perluMuatUlang(err)) setRefreshTrigger((prev) => prev + 1);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Apakah Anda yakin ingin menghapus FAQ ini?')) return;

    const supabase = createClient();
    try {
      // 0 baris terhapus (RLS menolak diam-diam / FAQ sudah tidak ada) = gagal, bukan sukses.
      await mutasiWajibBaris(
        supabase.from('faq_knowledge_base').delete().eq('id', id).select('id'),
      );

      toast('FAQ berhasil dihapus', 'success');
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      toast(pesanMutasi(err, 'Gagal menghapus FAQ'), 'error');
      if (perluMuatUlang(err)) setRefreshTrigger((prev) => prev + 1);
    }
  };

  // Undefined untuk "Umum": kartu status bot per layanan tidak berlaku bagi FAQ umum.
  const getSelectedLayanan = () => {
    return selectedLayananId ? layananList.find((l) => l.id === selectedLayananId) : undefined;
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
            value={selectedKey}
            onChange={(e) => {
              setLoading(true);
              setPilihKey(e.target.value);
              handleResetForm();
            }}
            disabled={layananGagalBlokir || roleError}
          >
            {opsiLayanan.map((o) => (
              <option key={keyOpsi(o)} value={keyOpsi(o)}>{o.nama}</option>
            ))}
          </select>
        </div>

        {roleError ? (
          <ErrorRetry
            judul="Hak akses Anda belum dapat dimuat"
            pesan="Peran akun Anda gagal dibaca sehingga halaman FAQ belum bisa dipakai. Ini bukan berarti Anda tidak punya akses."
            onRetry={handleMuatUlangRole}
            memuat={roleMemuat}
            labelTombol="Muat ulang"
          />
        ) : layananGagalBlokir ? (
          <ErrorRetry
            judul="Daftar layanan belum dapat dimuat"
            pesan="Layanan yang dapat dikelola FAQ-nya belum bisa ditampilkan. Periksa koneksi lalu muat ulang."
            onRetry={handleMuatUlangLayanan}
            memuat={layananMemuat}
            labelTombol="Muat ulang"
          />
        ) : tanpaAkses ? (
          <div
            className={styles.faqListCard}
            data-testid="faq-tanpa-akses"
            style={{ textAlign: 'center', padding: 'var(--space-10)', color: 'var(--text-secondary)' }}
          >
            <AlertCircle size={40} style={{ margin: '0 auto var(--space-2)', opacity: 0.5 }} />
            <p style={{ fontSize: 'var(--text-sm)' }}>
              Tidak ada layanan yang dapat Anda kelola FAQ-nya. Hubungi Admin bila peran atau layanan Anda belum terdaftar.
            </p>
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
                      {isAdmin ? (
                        <button
                          type="button"
                          className={`btn btn--sm ${getSelectedLayanan()?.chatbot_aktif ? 'btn--primary' : 'btn--secondary'}`}
                          onClick={() => selectedLayananId && handleToggleChatbot(selectedLayananId, getSelectedLayanan()?.chatbot_aktif || false)}
                          disabled={togglingBot}
                          aria-busy={togglingBot}
                        >
                          {getSelectedLayanan()?.chatbot_aktif ? 'AKTIF (On)' : 'NONAKTIF (Off)'}
                        </button>
                      ) : (
                        <span
                          className={`badge ${getSelectedLayanan()?.chatbot_aktif ? 'badge--selesai' : 'badge--nonaktif'}`}
                          data-testid="bot-status"
                        >
                          {getSelectedLayanan()?.chatbot_aktif ? 'AKTIF (On)' : 'NONAKTIF (Off)'}
                        </span>
                      )}
                    </div>
                  </div>
                  {role !== null && !isAdmin && (
                    <p role="note" style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', margin: '0 0 var(--space-2)' }}>
                      Pengaturan bot dikelola Admin. Untuk menangani satu percakapan gunakan tombol Ambil alih di Live Chat.
                    </p>
                  )}
                  <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', margin: 0 }}>
                    Jika chatbot AKTIF, pesan pengunjung yang masuk di layanan ini akan dijawab otomatis oleh bot jika kata kuncinya sesuai FAQ di bawah. Jika tidak aktif, chat langsung diteruskan ke petugas loket.
                  </p>
                </div>
              )}

              {(isAdmin || isPetugas) && selectedLayananId && (
                <CobaTanyaBot layananId={selectedLayananId} layananNama={getSelectedLayanan()?.nama} />
              )}

              {/* List FAQ */}
              <div className={styles.faqListCard}>
                {isPetugas && (
                  <RoleNote>
                    Anda dapat menonaktifkan FAQ yang keliru. Penghapusan permanen hanya oleh Admin.
                  </RoleNote>
                )}
                {isFrontOffice && (
                  <RoleNote>
                    Anda mengelola FAQ umum yang berlaku untuk semua layanan. FAQ khusus tiap layanan dikelola Admin dan petugas layanan.
                  </RoleNote>
                )}
                <div className={styles.faqListHeader}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <MessageSquare size={18} style={{ color: 'var(--color-primary-600)' }} />
                    <span className={styles.faqListTitle}>Database Knowledge Base FAQ</span>
                  </div>
                  {isAdmin && (
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
                  )}
                </div>
                {(isPetugas || isFrontOffice) && (
                  <RoleNote>
                    Pencarian cepat bot (embedding) untuk FAQ yang Anda simpan baru aktif setelah Admin menjalankan embedding.
                  </RoleNote>
                )}

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
                                type="button"
                                aria-label={`Edit FAQ: ${faq.pertanyaan}`}
                                className="btn btn--secondary btn--sm"
                                style={{ padding: '4px 8px' }}
                                onClick={() => handleEdit(faq)}
                              >
                                <Edit2 size={12} />
                              </button>
                              {!isPetugas && (
                                <button
                                  type="button"
                                  aria-label={`Hapus FAQ: ${faq.pertanyaan}`}
                                  className="btn btn--ghost btn--sm"
                                  style={{ padding: '4px 8px', color: 'var(--color-danger-600)' }}
                                  onClick={() => handleDelete(faq.id)}
                                >
                                  <Trash2 size={12} />
                                </button>
                              )}
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
                        <p style={{ fontSize: 'var(--text-sm)' }}>
                          {selectedLayananId ? 'Belum ada FAQ untuk layanan ini.' : 'Belum ada FAQ umum.'}
                        </p>
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

                {isPetugas && !acked && (
                  <div className="form-group" role="note">
                    <p style={{ fontSize: 'var(--text-sm)', margin: 0 }}>
                      <strong>Isi FAQ ini akan dipakai bot dan dibaca pengunjung sebagai informasi resmi layanan Anda.</strong>{' '}
                      Jika ada kesalahan informasi, itu menjadi tanggung jawab Anda sebagai petugas. Setiap perubahan tercatat atas nama akun Anda.
                    </p>
                    <label style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={ackChecked}
                        onChange={(e) => setAckChecked(e.target.checked)}
                      />
                      Saya memahami dan bertanggung jawab atas isi FAQ ini.
                    </label>
                  </div>
                )}

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
