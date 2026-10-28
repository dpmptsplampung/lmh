<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Akun Mitra

Model akun mitra: **individual account** (satu akun per individu), bukan akun bersama per instansi. Setiap petugas/pegawai mitra login dengan akun pribadinya sendiri. Lihat `docs/KEBIJAKAN_AKUN_MITRA.md` untuk rasional, alur invite (K4), dan panduan migrasi akun bersama.

## Repository dan autentikasi GitHub

- Repository resmi: `https://github.com/dpmptsplampung/lmh.git`.
- Semua operasi GitHub untuk repository ini—`fetch`, `pull`, `push`, branch, tag, release, issue, pull request, dan pemeriksaan remote—dilakukan lewat GitHub CLI (`gh`) di terminal, dengan akun DPMPTSP (`dpmptsplampung`) yang sudah login via `gh auth`.
- Jangan memakai akun lain atau token yang ditempelkan ke URL remote.
- Gunakan remote HTTPS resmi.
- Jangan menyimpan token, password, credential, atau output secret ke file, commit, log, prompt, atau chat.
- Jangan menjalankan `git push`, membuat release, atau operasi remote yang mengubah state tanpa instruksi eksplisit pengguna.
- Sebelum push, periksa branch, remote, diff, status, test, lint, typecheck, dan build.
- Jika `gh` belum login atau autentikasi gagal, berhenti dan laporkan blocker; jangan menebak token.

## Workflow dan skill

- Baca file ini, `README.md`, `LMH-AGENT-SPEC.md`, `TASKS.md` bila relevan, `SECURITY.md`, serta spesifikasi teknis terkait sebelum bekerja.
- Sebelum coding, baca guide Next.js yang relevan di `node_modules/next/dist/docs/`; API Next.js pada project ini dapat berbeda dari pengetahuan umum.
- Sebelum implementasi, lihat skill yang tersedia dan muat skill yang relevan melalui native `skill` tool. Jangan memuat semua skill secara membabi buta.
- Fitur baru: gunakan `brainstorming` atau `writing-plans`, skill domain, `test-driven-development`, lalu `verification-before-completion`.
- Bug/error: gunakan `systematic-debugging` sebelum mengubah kode.
- Backend/API/security: gunakan `architecture-patterns`, `api-design-principles`, `error-handling-patterns`, `auth-implementation-patterns`, dan `security-requirement-extraction` sesuai kebutuhan.
- Frontend/Next.js/UI: gunakan `ui-ux-pro-max`, `nextjs-app-router-patterns`, `react-state-management`, `design-system`, `design-system-patterns`, `responsive-design`, dan `accessibility-compliance` sesuai kebutuhan.
- Review/QA: gunakan `code-review-excellence`, `e2e-testing-patterns`, `javascript-testing-patterns`, `wcag-audit-patterns`, dan `verification-before-completion` sesuai kebutuhan.
- Ikuti TASK claim/evidence dan aturan project; jangan mengerjakan task yang belum eligible atau sudah diklaim agent lain.
- Sebelum mengubah file, rencanakan scope dan cek status/diff. Jangan membuat dua writer mengubah file yang sama.
- Setelah perubahan, jalankan gate yang relevan: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, atau `npm run verify:baseline`.
- Sebelum menyatakan selesai, baca diff aktual, scan secret, dan laporkan skill yang dipakai serta bukti test/lint/typecheck/build.
- Jangan mengubah data nyata, `.env`, credential, backup, atau konfigurasi deployment tanpa instruksi eksplisit.

## Keamanan data dan server (mode develop)

Berlaku untuk semua AI agent, di laptop maupun di server. Selama tahap develop aturan sengaja dilonggarkan supaya agent bisa membantu lebih banyak. Daftar yang dilonggarkan ada di `/opt/serverkit/docs/DECISIONS.md` D-37 dan wajib dikencangkan lagi sebelum go-live.

1. **Tidak pernah, ke database selain lokal atau container percobaan (termasuk production):** menghapus atau mengosongkan database. Contoh: `prisma migrate reset`, `prisma db push --force-reset`, `supabase db reset --linked`, `DROP DATABASE`, `DROP SCHEMA`, `DROP TABLE`, `TRUNCATE`, `DELETE` tanpa `WHERE`. Tampilkan host tujuan (tanpa password) sebelum perintah apa pun yang mengubah database.
2. **Migration ke production boleh dibantu agent, dengan syarat:** migration sudah diterapkan dan lolos di staging lebih dulu; hanya migration maju (`prisma migrate deploy`, `supabase db push` tanpa reset); host dan daftar migration ditampilkan sebelum dijalankan. Tidak ada migration ke production tanpa staging.
3. Agent boleh memakai Doppler yang sudah login di server dan membaca atau memindahkan secret. Jangan commit secret ke git dan jangan menaruhnya di file yang ikut di-track.
4. Jangan menghapus atau menimpa isi `/backup`, `backup2`, dan `/srv/data`.
5. Jangan menghentikan, mengubah, atau merapikan `9router`, `9remote`, `hermes-gateway`, dan Tramo.
6. Jika ragu apakah sebuah perintah merusak data tanpa bisa dibatalkan, berhenti dan tanya pemilik.

## Remote safety

- Jangan mengubah URL remote tanpa persetujuan pengguna.
- Jangan meng-commit `.env` atau file berisi secret; jangan mencetak nilai secret.
- Jangan memakai `git credential approve` untuk menyimpan token permanen.
