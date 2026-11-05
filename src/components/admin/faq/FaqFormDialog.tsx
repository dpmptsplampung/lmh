'use client';

// Dialog tambah/ubah FAQ (satu bentuk untuk keduanya): lima langkah berurutan, aman di ponsel
// karena dialog menggulir di dalam dirinya sendiri. Penyimpanan dan pemrosesan bot dilakukan halaman;
// dialog hanya memvalidasi isian dan menampilkan galat yang dikembalikan.
import { useId, useState } from 'react';
import FormDialog from '@/components/admin/FormDialog';
import Field from '@/components/ui/Field';
import type { OpsiFaqLayanan } from '@/lib/faq-scope';
import { UMUM_KEY, type FAQ, type IsianFaq } from './types';
import styles from './faqDialog.module.css';

interface Props {
  /** null = tambah pertanyaan baru. */
  faq: FAQ | null;
  /** Cakupan yang boleh dipilih peran ini (sudah di-scope sesuai RLS). */
  opsi: OpsiFaqLayanan[];
  /** Cakupan terpilih awal saat menambah. */
  kunciAwal: string;
  /** Pertanyaan awal (dari Log AI Chat). */
  pertanyaanAwal?: string;
  urutanAwal: number;
  /** Petugas yang belum menyatakan tanggung jawab pada sesi ini. */
  perluPernyataan: boolean;
  onClose: () => void;
  /** Mengembalikan pesan galat, atau null bila berhasil (halaman menutup dialog). */
  onSimpan: (isian: IsianFaq) => Promise<string | null>;
}

const kunciOpsi = (o: OpsiFaqLayanan) => o.id ?? UMUM_KEY;
const keteranganCakupan = (umum: boolean) =>
  umum ? 'Bot memakai FAQ ini di semua layanan.' : 'Bot hanya memakai FAQ ini untuk pengunjung layanan ini.';

export default function FaqFormDialog({ faq, opsi, kunciAwal, pertanyaanAwal, urutanAwal, perluPernyataan, onClose, onSimpan }: Props) {
  const idDasar = useId();
  const mengubah = faq !== null;
  const [kunci, setKunci] = useState(kunciAwal);
  const [pertanyaan, setPertanyaan] = useState(faq?.pertanyaan ?? pertanyaanAwal ?? '');
  const [jawaban, setJawaban] = useState(faq?.jawaban ?? '');
  const [dasarHukum, setDasarHukum] = useState(faq?.dasar_hukum ?? '');
  const [urutan, setUrutan] = useState(faq?.urutan ?? urutanAwal);
  const [pernyataan, setPernyataan] = useState(false);
  const [mengirim, setMengirim] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);

  const kunciFaq = faq ? (faq.layanan_id ?? UMUM_KEY) : kunci;
  const opsiTerpilih = opsi.find((o) => kunciOpsi(o) === kunciFaq);

  const simpan = async () => {
    if (!pertanyaan.trim() || !jawaban.trim()) {
      setGalat('Pertanyaan pengunjung dan jawaban bot wajib diisi.');
      return;
    }
    if (!kunciFaq) {
      setGalat('Pilih untuk siapa FAQ ini.');
      return;
    }
    if (perluPernyataan && !pernyataan) {
      setGalat('Centang pernyataan tanggung jawab terlebih dahulu.');
      return;
    }
    setGalat(null);
    setMengirim(true);
    try {
      const pesan = await onSimpan({ kunci: kunciFaq, pertanyaan, jawaban, dasarHukum, urutan, pernyataan });
      if (pesan) setGalat(pesan);
    } finally {
      setMengirim(false);
    }
  };

  const idPertanyaan = `${idDasar}-pertanyaan`;
  const idJawaban = `${idDasar}-jawaban`;
  const idDasarHukum = `${idDasar}-dasar-hukum`;

  return (
    <FormDialog
      judul={mengubah ? 'Ubah pertanyaan' : 'Tambah pertanyaan'}
      deskripsi="Isi berurutan dari 1 sampai 4, lalu simpan."
      labelKirim="Simpan"
      mengirim={mengirim}
      galat={galat}
      onClose={onClose}
      onSubmit={simpan}
      maxWidth={600}
    >
      {({ galat: idGalat }) => (
        <>
          {opsi.length > 1 && !mengubah ? (
            <fieldset className={styles.langkah}>
              <legend className={styles.judulLangkah}>
                <span className={styles.nomor} aria-hidden="true">1</span> Untuk siapa FAQ ini?
              </legend>
              {opsi.map((o) => {
                const k = kunciOpsi(o);
                return (
                  <label key={k} className={styles.pilihan}>
                    <input
                      type="radio"
                      name={`${idDasar}-cakupan`}
                      value={k}
                      checked={kunci === k}
                      onChange={() => setKunci(k)}
                      aria-labelledby={`${idDasar}-cakupan-${k}-nama`}
                      aria-describedby={`${idDasar}-cakupan-${k}-ket`}
                    />
                    <span className={styles.pilihanTeks}>
                      <span id={`${idDasar}-cakupan-${k}-nama`} className={styles.pilihanNama}>{o.id === null ? 'Semua layanan' : o.nama}</span>
                      <span id={`${idDasar}-cakupan-${k}-ket`} className={styles.keterangan}>{keteranganCakupan(o.id === null)}</span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
          ) : (
            <div className={styles.langkah}>
              <p className={styles.judulLangkah}>
                <span className={styles.nomor} aria-hidden="true">1</span> Untuk siapa FAQ ini?
              </p>
              <div className={styles.tetap}>
                <span className={styles.pilihanNama}>
                  {kunciFaq === UMUM_KEY ? 'Semua layanan' : (opsiTerpilih?.nama ?? 'Layanan ini')}
                </span>
                <span className={styles.keterangan}>{keteranganCakupan(kunciFaq === UMUM_KEY)}</span>
              </div>
            </div>
          )}

          <div className={styles.langkah}>
            <label className={styles.judulLangkah} htmlFor={idPertanyaan}>
              <span className={styles.nomor} aria-hidden="true">2</span> Pertanyaan pengunjung
            </label>
            <input
              id={idPertanyaan}
              type="text"
              className="form-input"
              placeholder="Contoh: Apa saja syarat membuat NIB?"
              value={pertanyaan}
              onChange={(e) => setPertanyaan(e.target.value)}
              aria-required="true"
              aria-describedby={galat ? idGalat : undefined}
            />
            <span className="form-hint">Tulis seperti pengunjung biasa menanyakannya, bukan dengan bahasa peraturan.</span>
            {!mengubah && pertanyaanAwal && pertanyaan === pertanyaanAwal && (
              <p className={styles.catatanAsal}>Pertanyaan ini terisi dari Log AI Chat.</p>
            )}
          </div>

          <div className={styles.langkah}>
            <label className={styles.judulLangkah} htmlFor={idJawaban}>
              <span className={styles.nomor} aria-hidden="true">3</span> Jawaban bot
            </label>
            <textarea
              id={idJawaban}
              className="form-textarea"
              placeholder="Tulis jawaban yang akan disampaikan bot kepada pengunjung."
              value={jawaban}
              onChange={(e) => setJawaban(e.target.value)}
              rows={6}
              aria-required="true"
            />
            <span className={styles.hitung} aria-live="polite">{jawaban.length} karakter</span>
          </div>

          <div className={styles.langkah}>
            <label className={styles.judulLangkah} htmlFor={idDasarHukum}>
              <span className={styles.nomor} aria-hidden="true">4</span> Dasar hukum (opsional)
            </label>
            <input
              id={idDasarHukum}
              type="text"
              className="form-input"
              placeholder="Contoh: UU No. 6 Tahun 2023 Pasal 12"
              value={dasarHukum}
              onChange={(e) => setDasarHukum(e.target.value)}
            />
            <span className="form-hint">Ditampilkan bot sebagai rujukan.</span>
            <Field label="Urutan" bantuan="Angka lebih kecil ditampilkan lebih dahulu pada daftar FAQ pengunjung.">
              <input type="number" className="input" min={0} value={urutan} onChange={(e) => setUrutan(parseInt(e.target.value) || 0)} />
            </Field>
          </div>

          <div className={styles.langkah}>
            <p className={styles.judulLangkah}>
              <span className={styles.nomor} aria-hidden="true">5</span> Simpan
            </p>
            <span className="form-hint">Setelah disimpan, FAQ diproses otomatis agar bot dapat memakainya.</span>
            {perluPernyataan && (
              <div className={styles.pernyataan} role="note">
                <p>
                  <strong>Isi FAQ ini akan dipakai bot dan dibaca pengunjung sebagai informasi resmi layanan Anda.</strong>{' '}
                  Jika ada kesalahan informasi, itu menjadi tanggung jawab Anda sebagai petugas. Setiap perubahan tercatat atas nama akun Anda.
                </p>
                <label className={styles.pernyataanCentang}>
                  <input type="checkbox" checked={pernyataan} onChange={(e) => setPernyataan(e.target.checked)} />
                  Saya memahami dan bertanggung jawab atas isi FAQ ini.
                </label>
              </div>
            )}
          </div>
        </>
      )}
    </FormDialog>
  );
}
