'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  ArrowLeft,
  Bot,
  MessageSquare,
  Loader2,
  CheckCircle2,
  AlertCircle,
  LayoutDashboard,
} from 'lucide-react';
import Field from '@/components/ui/Field';
import Galat from '@/components/ui/Galat';
import Skeleton from '@/components/ui/Skeleton';
import Tombol from '@/components/ui/Tombol';
import IkonGoogle from '@/components/chat/IkonGoogle';
import styles from './chat.module.css';
import ui from './chat-ui.module.css';
import { JENIS_PENUTUP_SURVEI } from '@/lib/chat-staf';
import { bersihkanPenutup } from '@/lib/chat/percakapan';
import { teksPetugasTidakTersedia } from '@/lib/chat/status-layanan';
import GambarLampiran from '@/components/chat/GambarLampiran';
import { petugasLabel, senderLabel, waktuLabel } from './merge';
import DaftarPercakapan from './DaftarPercakapan';
import { modeBot, modePercakapan } from './_logika/mesinChat';
import {
  TEKS_OFFLINE,
  hanyaBaca as hitungHanyaBaca,
  idPesanPengunjungTerakhir,
  layananPercakapan,
  placeholderPesan,
  tampilanAktif as hitungTampilanAktif,
} from './_logika/turunan';
import { useDaring } from './_hook/useDaring';
import { usePengunjung } from './_hook/usePengunjung';
import { useReferensiChat } from './_hook/useReferensiChat';
import { useMesinChat } from './_hook/useMesinChat';
import { usePesan } from './_hook/usePesan';
import { bacaParamLayanan, useSesiChat, type PersetujuanChat } from './_hook/useSesiChat';
import { useDaftarPercakapan } from './_hook/useDaftarPercakapan';
import { useStatusLayanan } from './_hook/useStatusLayanan';
import { useKirim } from './_hook/useKirim';
import '@chatscope/chat-ui-kit-styles/dist/default/styles.min.css';
import {
  MainContainer,
  ChatContainer,
  MessageList,
  Message as ChatMessage,
  MessageInput,
  TypingIndicator,
} from '@chatscope/chat-ui-kit-react';

const CONSENT_VERSION = '1.0';
const CONSENT_TEXT = 'Saya setuju data saya diproses sesuai Kebijakan Privasi.';
const PII_DISCLAIMER =
  'Asisten virtual menjawab berdasarkan FAQ resmi. Jangan membagikan data pribadi sensitif (NIK, nomor dokumen, kata sandi) melalui chat.';

export default function PublicChatPage() {
  const isOnline = useDaring();
  const pengunjung = usePengunjung();
  const referensi = useReferensiChat();
  const mesin = useMesinChat();
  const { keadaan } = mesin;
  const { sesiId, status: sesiStatus, layananId: selectedLayananId } = keadaan;
  const pesan = usePesan(mesin);

  // I8: persetujuan PDP wajib sebelum percakapan baru. Percakapan yang dibuka dari daftar menandainya tercentang.
  const [consentGiven, setConsentGiven] = useState(false);
  const sesi = useSesiChat({
    mesin,
    pesan,
    layanan: referensi.layanan,
    muatFaq: referensi.muatFaq,
    pengunjungId: pengunjung.pengunjungId,
    namaPengunjung: pengunjung.nama,
    daring: isOnline,
    onPercakapanDibuka: () => setConsentGiven(true),
  });
  const daftar = useDaftarPercakapan({
    aktif: !pengunjung.memeriksa && !referensi.memuatLayanan && pengunjung.masuk,
    pengunjungId: pengunjung.pengunjungId,
    layanan: referensi.layanan,
    onPertama: sesi.putuskanAwal,
  });
  const jadwal = useStatusLayanan({ aktif: keadaan.tampilan === 'percakapan', layananId: selectedLayananId });
  const { status: statusLayanan, tutup } = jadwal;

  const sesiLayanan = layananPercakapan(referensi.layanan, keadaan.sesiLayananId, selectedLayananId);
  const botAktif = sesiLayanan?.chatbot_aktif === true;
  const sesiLayananNama = referensi.layanan.find((l) => l.id === keadaan.sesiLayananId)?.nama;
  // Layanan yang sudah diarsipkan / tidak lagi punya chat: percakapan hanya bisa dibaca.
  const hanyaBaca = hitungHanyaBaca({
    tampilan: keadaan.tampilan,
    memuatLayanan: referensi.memuatLayanan,
    galatLayanan: referensi.galatLayanan,
    adaLayanan: !!sesiLayanan,
  });
  const kiriman = useKirim({
    mesin,
    pesan,
    pastikanSesi: sesi.pastikanSesi,
    daring: isOnline,
    hanyaBaca,
    botAktif,
    tutupRef: jadwal.tutupRef,
  });
  const berkasRef = useRef<HTMLInputElement>(null);

  // S1/K11: baris consent_log yang di-insert useSesiChat SEBELUM sesi dibuat (gagal = sesi tidak dibuat). subjek_ref diisi
  // hook dari baris pengunjung/auth (bukan 'anon'). Tanpa centang tidak ada baris, sehingga percakapan baru tidak dimulai.
  const persetujuan = (): PersetujuanChat | null => {
    if (!consentGiven) return null;
    return { tujuan: 'chat_followup', disetujui: true, versi_kebijakan: CONSENT_VERSION };
  };
  const percakapanTerpilih = daftar.daftar.find((d) => d.layananId === selectedLayananId);
  const mulaiSesi = () => void sesi.mulaiSesi({ persetujuan: persetujuan(), ada: percakapanTerpilih });
  const handleStartSession = (e: React.FormEvent) => {
    e.preventDefault();
    mulaiSesi();
  };

  const kembaliKeDaftar = () => {
    sesi.kembali();
    daftar.muatUlang();
  };

  // Halaman riwayat lebih lama berjangkar pada sesi terbuka, atau sesi terakhir percakapan bila semua sesi selesai.
  const sesiTerakhirPercakapan = percakapanTerpilih?.sesiTerakhirId;

  // Bubble milik pengunjung terakhir yang sudah tersimpan -> status "Terkirim".
  const lastSentId = idPesanPengunjungTerakhir(pesan.pesan);

  // A-10: layanan terpilih yang sudah punya percakapan dibuka langsung (tanpa centang persetujuan lagi).
  const adaPercakapanTerpilih = !!selectedLayananId && !!percakapanTerpilih;

  // A-03: parameter ?layanan= mentah (id atau nama) diteruskan lewat `next` agar konteks tidak hilang saat login.
  const layananUrlMentah = bacaParamLayanan();
  const masukDenganGoogle = () => {
    const next = layananUrlMentah ? encodeURIComponent(`/chat?layanan=${encodeURIComponent(layananUrlMentah)}`) : '/chat';
    pengunjung.masukDenganGoogle(next);
  };

  const tampilanAktif = hitungTampilanAktif({
    tampilan: keadaan.tampilan,
    memeriksa: pengunjung.memeriksa,
    masuk: pengunjung.masuk,
    daftarSiap: daftar.siap,
  });
  const mode = modePercakapan(keadaan, { tutup, hanyaBaca });
  const tampilkanFaq = modeBot(sesiStatus, tutup, botAktif) && !!sesiId;

  return (
    <div className={styles.chatPage} data-tema="dasbor">
      {/* Bilah atas: tanpa sidebar */}
      <header className={styles.chatHeader}>
        <Link href="/" className={styles.brand}>
          <Image
            src="/logo.png"
            alt="Lampung Maju Hub Logo"
            width={120}
            height={50}
            className={styles.brandLogo}
            priority
          />
        </Link>
        <h1 className={styles.judulBar}>Live Chat</h1>
        <nav className={styles.aksiBar} aria-label="Navigasi chat">
          <Link href="/me" className={styles.tautanBar}>
            <LayoutDashboard size={16} strokeWidth={1.75} aria-hidden="true" />
            <span className={styles.teksTautan}>Beranda saya</span>
          </Link>
          <Link href="/" className={styles.backBtn}>
            <ArrowLeft size={16} strokeWidth={1.75} aria-hidden="true" />
            <span className={styles.teksTautan}>Kembali ke Web</span>
          </Link>
        </nav>
      </header>

      {/* Panel percakapan */}
      <div className={styles.chatContainer}>
        {tampilanAktif === 'memuat' && (
          <div role="status" className={styles.memuat}>
            <Skeleton bentuk="baris" jumlah={3} label="Memuat percakapan..." />
          </div>
        )}

        {tampilanAktif === 'daftar' && (
          <DaftarPercakapan
            items={daftar.daftar}
            dibaca={daftar.dibaca}
            onBuka={sesi.bukaPercakapan}
            onBaru={() => sesi.tampilkan('baru', true)}
            memuat={daftar.memuat}
            galat={daftar.galat}
            onCobaLagi={daftar.muatUlang}
          />
        )}

        {tampilanAktif === 'baru' && (
          /* Setup / Formulir Percakapan Baru */
          <div className={styles.setupState}>
            {daftar.daftar.length > 0 && (
              <Tombol
                varian="sekunder"
                ukuran="kecil"
                ikon={ArrowLeft}
                className={styles.kembaliDaftar}
                onClick={() => sesi.tampilkan('daftar')}
              >
                Daftar percakapan
              </Tombol>
            )}
            <div className={styles.setupKepala}>
              <span className={styles.setupIkon}>
                <MessageSquare size={28} strokeWidth={1.75} aria-hidden="true" />
              </span>
              <h2 className={styles.setupTitle}>Mulai Konsultasi Online</h2>
              <p className={styles.setupDesc}>
                Silakan isi data diri singkat dan pilih layanan tujuan Anda untuk memulai sesi chat dengan petugas atau bot FAQ.
              </p>
              <p className={styles.setupCatatan}>{PII_DISCLAIMER}</p>
            </div>

            {!isOnline && (
              <p role="alert" className={styles.galatBaris}>
                <AlertCircle size={16} strokeWidth={1.75} aria-hidden="true" />
                {TEKS_OFFLINE}
              </p>
            )}
            {keadaan.galat.setup && (
              <p role="alert" className={styles.galatBaris}>
                <AlertCircle size={16} strokeWidth={1.75} aria-hidden="true" />
                {keadaan.galat.setup}
              </p>
            )}

            {!pengunjung.memeriksa && !pengunjung.masuk ? (
              /* A-03: chat wajib login Google. Ajakan masuk paling atas; kolom yang tak bisa dipakai tidak ditampilkan. */
              <section aria-labelledby="chatAjakanMasuk" className={styles.ajakan}>
                <h3 id="chatAjakanMasuk" className={styles.ajakanJudul}>Masuk untuk memakai live chat</h3>
                <p className={styles.ajakanTeks}>
                  Live chat hanya untuk pengunjung yang masuk dengan akun Google, supaya percakapan Anda tersimpan dan dapat dilanjutkan.
                  Setelah masuk, Anda kembali ke halaman ini{layananUrlMentah ? ' dengan layanan yang sama' : ''}.
                </p>
                <Tombol onClick={masukDenganGoogle}>
                  <IkonGoogle className={styles.ikonGoogle} />
                  Masuk dengan Google
                </Tombol>
              </section>
            ) : (
            <form onSubmit={handleStartSession} className={styles.formSetup}>
              <Field label="Nama Anda" wajib>
                <input
                  type="text"
                  placeholder={pengunjung.memeriksa ? "Memuat data profil..." : "Masukkan nama lengkap..."}
                  value={pengunjung.nama}
                  onChange={(e) => pengunjung.setNama(e.target.value)}
                  required
                  readOnly={pengunjung.masuk}
                  className={pengunjung.masuk ? styles.inputTerkunci : undefined}
                />
              </Field>

              <div>
                <Field label="Layanan yang Ditanyakan" wajib>
                  <select
                    value={selectedLayananId}
                    onChange={(e) => sesi.pilihLayanan(e.target.value)}
                    disabled={referensi.memuatLayanan || referensi.galatLayanan}
                    required
                  >
                    <option value="">{referensi.galatLayanan ? '— Layanan belum dapat dimuat —' : '— Pilih layanan tujuan —'}</option>
                    {referensi.layanan.map((layanan) => (
                      <option
                        key={layanan.id}
                        value={layanan.id}
                        disabled={layanan.status_tampilan === 'coming_soon'}
                      >
                        {layanan.nama}
                        {layanan.status_tampilan === 'coming_soon' ? ' (Segera hadir)' : ''}
                        {daftar.daftar.some((d) => d.layananId === layanan.id) ? ' (percakapan sudah ada)' : ''}
                      </option>
                    ))}
                  </select>
                </Field>
                {referensi.galatLayanan && (
                  <Galat
                    judul="Daftar layanan belum dapat dimuat"
                    pesan="Anda belum dapat memilih layanan tujuan chat. Tekan Coba lagi untuk memuat ulang daftar layanan."
                    onRetry={referensi.cobaLagiLayanan}
                    memuat={referensi.memuatLayanan}
                  />
                )}
              </div>

              {/* A-10: percakapan yang sudah ada tidak meminta persetujuan lagi (sudah tercatat saat percakapan pertama). */}
              {adaPercakapanTerpilih ? (
                <p role="status" className={styles.catatanStatus}>
                  Anda sudah punya percakapan dengan layanan ini. Persetujuan Anda sudah tercatat; percakapan akan dibuka.
                </p>
              ) : (
                // I8: PDP consent checkbox — required
                <div className={styles.consent}>
                  <input
                    id="chatConsent"
                    type="checkbox"
                    className={styles.consentKotak}
                    checked={consentGiven}
                    onChange={(e) => {
                      setConsentGiven(e.target.checked);
                      sesi.hapusGalatConsent();
                    }}
                    required
                  />
                  <label htmlFor="chatConsent" className={styles.consentTeks}>
                    {CONSENT_TEXT}{' '}
                    <Link href="/kebijakan-privasi" className={styles.consentTautan}>
                      Baca kebijakan
                    </Link>
                  </label>
                </div>
              )}

              {keadaan.galat.consent && (
                <Galat
                  judul="Persetujuan belum tercatat"
                  pesan={keadaan.galat.consent}
                  onRetry={mulaiSesi}
                  memuat={keadaan.memulai}
                />
              )}

              <Tombol
                type="submit"
                className={styles.kirimSetup}
                memuat={keadaan.memulai}
                disabled={keadaan.memulai || referensi.memuatLayanan || referensi.galatLayanan || !pengunjung.masuk || !(adaPercakapanTerpilih || consentGiven) || !isOnline}
              >
                {keadaan.memulai ? 'Memulai Sesi...' : adaPercakapanTerpilih ? 'Buka percakapan' : 'Mulai Sesi Chat'}
              </Tombol>
            </form>
            )}
          </div>
        )}

        {tampilanAktif === 'percakapan' && (
          /* Percakapan: riwayat lintas sesi + sesi berjalan */
          <>
            {/* Status Bar */}
            <div className={`${styles.statusBar} ${
              mode === 'bot'
                ? styles.statusBarBot
                : (mode === 'menunggu' || mode === 'menungguLuarJam' ? styles.statusBarEskalasi : styles.statusBarAktif)
            }`}>
              <Tombol varian="sekunder" ukuran="kecil" ikon={ArrowLeft} onClick={kembaliKeDaftar}>
                Daftar percakapan
              </Tombol>
              {mode === 'bot' && (
                <>
                  <Bot size={14} strokeWidth={1.75} aria-hidden="true" />
                  <span>{tutup ? 'Mode Chatbot FAQ — petugas sedang tidak tersedia' : 'Mode Chatbot FAQ Aktif'}</span>
                  <Tombol varian="sekunder" ukuran="kecil" className={styles.statusAksi} onClick={kiriman.mintaPetugas}>
                    Hubungkan ke Petugas
                  </Tombol>
                </>
              )}
              {mode === 'menungguLuarJam' && (
                <>
                  <Bot size={14} strokeWidth={1.75} aria-hidden="true" />
                  <span>
                    {botAktif
                      ? 'Menunggu petugas — petugas akan menjawab pada jam kerja. Sementara itu asisten virtual tetap menjawab.'
                      : 'Menunggu petugas — petugas akan menjawab pada jam kerja.'}
                  </span>
                </>
              )}
              {mode === 'menunggu' && (
                <>
                  <Loader2 size={14} className="animate-pulse" aria-hidden="true" />
                  <span>Menghubungkan ke petugas operasional loket... Mohon tunggu.</span>
                </>
              )}
              {mode === 'petugas' && (
                <>
                  <CheckCircle2 size={14} strokeWidth={1.75} className={styles.ikonSukses} aria-hidden="true" />
                  <span>Terhubung langsung dengan {petugasLabel(sesiLayananNama)}</span>
                </>
              )}
              {(mode === 'hanyaBaca' || mode === 'selesai') && (
                <>
                  <CheckCircle2 size={14} strokeWidth={1.75} className={styles.ikonSukses} aria-hidden="true" />
                  <span>
                    {hanyaBaca
                      ? 'Layanan ini tidak lagi melayani chat — percakapan hanya dapat dibaca.'
                      : 'Sesi sebelumnya sudah selesai. Kirim pesan untuk memulai sesi baru.'}
                  </span>
                </>
              )}
            </div>

            {statusLayanan && !statusLayanan.buka && !hanyaBaca && (
              <div role="note" data-testid="chat-luar-jam" className={styles.hariTanpaLayananBar}>
                <AlertCircle size={14} strokeWidth={1.75} aria-hidden="true" />
                <span>{teksPetugasTidakTersedia(sesiLayananNama ?? 'layanan ini', statusLayanan, { tanpaBot: !botAktif })}</span>
              </div>
            )}

            {/* Offline Banner */}
            {!isOnline && (
              <div role="alert" className={styles.offlineBar}>
                <AlertCircle size={14} strokeWidth={1.75} aria-hidden="true" />
                <span>{TEKS_OFFLINE}</span>
              </div>
            )}

            {/* Chatscope UI Container */}
            <div className={ui.shell}>
              <MainContainer responsive>
                <ChatContainer>
                  <MessageList
                    typingIndicator={kiriman.mengetik ? <TypingIndicator content="Bot FAQ sedang mengetik…" /> : undefined}
                  >
                    <div className={styles.catatanPii}>{PII_DISCLAIMER}</div>
                    {pesan.galatRiwayat && (
                      <Galat
                        pesan={
                          pesan.galatRiwayat === 'awal'
                            ? 'Riwayat percakapan belum dapat dimuat. Pesan lama mungkin belum tampil.'
                            : 'Pesan sebelumnya belum dapat dimuat.'
                        }
                        onRetry={() => pesan.cobaLagiRiwayat(sesiTerakhirPercakapan)}
                        memuat={pesan.memuatRiwayat}
                      />
                    )}
                    {pesan.adaLebih && (
                      <div className={styles.muatLebih}>
                        <Tombol
                          varian="sekunder"
                          ukuran="kecil"
                          onClick={() => void pesan.muatLebihLama(sesiTerakhirPercakapan)}
                          disabled={pesan.memuatRiwayat}
                        >
                          {pesan.memuatRiwayat ? 'Memuat...' : 'Muat pesan sebelumnya'}
                        </Tombol>
                      </div>
                    )}
                    {pesan.pesan.map((msg) => (
                      msg.jenis_jawaban === JENIS_PENUTUP_SURVEI ? (
                        // Pesan penutup sesi dari RPC chat_selesai / tutup otomatis (Q24: tanpa kalimat survei).
                        <div key={msg.id} role="note" className={styles.penutupSurvei} data-testid="penutup-sesi">
                          <span className={styles.penutupSurveiJudul}>Sesi selesai</span>
                          {bersihkanPenutup(msg.isi)}
                        </div>
                      ) : (
                      <ChatMessage
                        // client_uuid stabil dari optimistic -> pesan server: tidak remount/berkedip.
                        key={msg.client_uuid ?? msg.id}
                        model={{
                          message: msg.isi,
                          sentTime: waktuLabel(msg.created_at),
                          sender: senderLabel(msg.pengirim, sesiLayananNama),
                          direction: msg.pengirim === 'pengunjung' ? 'outgoing' : 'incoming',
                          position: 'single',
                        }}
                      >
                        <ChatMessage.Header sender={senderLabel(msg.pengirim, sesiLayananNama)} sentTime={waktuLabel(msg.created_at)} />
                        {msg.lampiran_kunci && (
                          <ChatMessage.CustomContent><GambarLampiran pesanId={msg.id} nama={msg.lampiran_nama} /></ChatMessage.CustomContent>
                        )}
                        {msg.local === 'pending' && (
                          <ChatMessage.Footer><span className={ui.msgStatus} role="status">Mengirim…</span></ChatMessage.Footer>
                        )}
                        {!msg.local && msg.id === lastSentId && (
                          <ChatMessage.Footer><span className={ui.msgStatus}>Terkirim</span></ChatMessage.Footer>
                        )}
                        {msg.local === 'failed' && (
                          <ChatMessage.Footer>
                            <span className={ui.msgStatusFailed}>Gagal terkirim. </span>
                            <Tombol varian="sekunder" ukuran="kecil" onClick={() => kiriman.kirimUlang(msg)}>
                              Kirim ulang
                            </Tombol>
                          </ChatMessage.Footer>
                        )}
                      </ChatMessage>
                      )
                    ))}

                    {/* S14: FAQ gagal dimuat -> pesan jelas + Coba lagi (bukan daftar kosong senyap) */}
                    {tampilkanFaq && referensi.galatFaq && (
                      <div className={styles.faqError}>
                        <Galat
                          judul="FAQ belum dapat dimuat"
                          pesan="Pertanyaan cepat tidak tersedia untuk sementara. Anda tetap dapat mengetik pertanyaan langsung."
                          onRetry={() => void referensi.muatFaq(keadaan.sesiLayananId ?? selectedLayananId)}
                          memuat={referensi.memuatFaq}
                        />
                      </div>
                    )}

                    {/* Quick FAQ Chips embedded in MessageList as custom component if active */}
                    {tampilkanFaq && !referensi.galatFaq && referensi.faq.length > 0 && (
                      <div className={styles.quickFaqSection}>
                        <span className={styles.quickFaqTitle}>FAQ Cepat:</span>
                        <div className={styles.quickFaqGrid}>
                          {referensi.faq.map((faq) => (
                            <button
                              key={faq.id}
                              type="button"
                              className={styles.quickFaqBtn}
                              onClick={() => kiriman.kirimTeks(faq.pertanyaan)}
                            >
                              {faq.pertanyaan}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </MessageList>

                  <MessageInput
                    placeholder={placeholderPesan({ daring: isOnline, hanyaBaca, sesiId, status: sesiStatus })}
                    disabled={hanyaBaca || !isOnline || kiriman.mengirimFoto}
                    attachButton
                    onAttachClick={() => berkasRef.current?.click()}
                    onSend={(_html, _text, innerText) => kiriman.kirimTeks(innerText)} // innerText: baris baru (Shift+Enter) ikut terkirim
                  />
                </ChatContainer>
              </MainContainer>
              <input
                ref={berkasRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                hidden
                onChange={(e) => { void kiriman.kirimFoto(e.target.files?.[0]); e.target.value = ''; }}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
