<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Akun Mitra

Model akun mitra: **individual account** (satu akun per individu), bukan akun bersama per instansi. Setiap petugas/pegawai mitra login dengan akun pribadinya sendiri. Lihat `docs/KEBIJAKAN_AKUN_MITRA.md` untuk rasional, alur invite (K4), dan panduan migrasi akun bersama.

## Repository dan autentikasi GitHub

- Repository resmi: `https://github.com/dpmptsplampung/lmh.git`.
- Semua operasi GitHub untuk repository ini—`fetch`, `pull`, `push`, branch, tag, release, issue, pull request, dan pemeriksaan remote—wajib memakai akun DPMPTSP melalui secret Doppler `GHTOKEN_DPMPTSP`.
- Jangan memakai akun lain, token personal lain, credential interaktif, atau token yang ditempelkan ke URL remote.
- Gunakan remote HTTPS resmi. Credential helper lokal repository mengambil token secara ephemeral dari Doppler saat Git memerlukan autentikasi.
- Untuk GitHub CLI/API, gunakan helper DPMPTSP atau `GH_TOKEN` ephemeral dari Doppler. Jangan mencetak nilainya.
- Jangan menyimpan token, password, credential, atau output secret ke file, commit, log, prompt, atau chat.
- Jangan menjalankan `git push`, membuat release, atau operasi remote yang mengubah state tanpa instruksi eksplisit pengguna.
- Sebelum push, periksa branch, remote, diff, status, test, lint, typecheck, dan build.
- Jika `GHTOKEN_DPMPTSP` tidak tersedia atau autentikasi gagal, berhenti dan laporkan blocker; jangan menebak token.

## Workflow OpenCode dan skill

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

## Doppler dan launcher OpenCode

- Project ini menggunakan Doppler project `lmh`, config `prd`, dengan scope direktori `/home/ubuntu/Project/LMH`.
- Secret wajib diakses melalui `doppler run -- <command>` atau environment yang diinjeksi launcher; jangan membuat atau meng-commit `.env` berisi secret.
- Launcher `/usr/local/bin/opencode-lmh` otomatis menginjeksi `DOPPLER_TOKEN` dan `NINE_ROUTER_KEY` secara ephemeral.
- `DOPPLER_TOKEN` dibaca dari `/root/.doppler/tokens/personal` dan `NINE_ROUTER_KEY` dari `/root/.9router/.opencode-key`; jangan mencetak, menyalin, atau menyimpan nilainya.
- Launcher menjalankan model `9router/orchestrator` pada port OpenCode `4098`.
- Jangan menjalankan `doppler login` dari project ini dan jangan menyimpan token Doppler di repository.
- Untuk memeriksa secret, tampilkan nama saja dengan `doppler secrets --only-names`; jangan memakai perintah yang mencetak nilai secret.

## Remote safety

- Jangan mengubah URL remote tanpa persetujuan pengguna.
- Jangan menonaktifkan credential helper repository.
- Jangan memakai `git credential approve` untuk menyimpan token permanen.
