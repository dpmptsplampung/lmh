type Dasar = { namaPemohon: string; namaPetugas: string; tautanMasuk: string };
const peringatan = 'DPMPTSP tidak menjamin transaksi; jangan mengirim uang sebelum ada kesepakatan tertulis.';

export function templatPemberitahuanPemohon(
  input: Dasar & { kodePermintaan: string; namaUmkm: string },
): string {
  return `Halo ${input.namaPemohon}, saya ${input.namaPetugas}, petugas UMKM DPMPTSP. ` +
    `Permintaan ${input.kodePermintaan} untuk ${input.namaUmkm} disetujui. ` +
    `Silakan masuk ke akun LMH untuk melihat nomornya: ${input.tautanMasuk}. ${peringatan}`;
}

export function templatKodeTautan(input: Dasar & { kodeTautan: string }): string {
  return `Halo ${input.namaPemohon}, saya ${input.namaPetugas}, petugas UMKM DPMPTSP. ` +
    `Kode permintaan bantuan Anda: ${input.kodeTautan}. Silakan buka ${input.tautanMasuk}, ` +
    `lalu masuk, isi data perusahaan, masukkan kode. ${peringatan}`;
}
