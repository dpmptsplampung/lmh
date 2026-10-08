// Migrasi akun staf existing ke login USERNAME (RBAC Tahap 2, docs/RBAC_USULAN_BAGIAN2_DRAFT.md C.7).
//
//   node scripts/migrate-akun-username.mjs                         # DRY-RUN (default): baca-saja, cetak rencana
//   node scripts/migrate-akun-username.mjs --apply --yes [--only <petugas_id>] [--backup <berkas.json>]
//   node scripts/migrate-akun-username.mjs --rollback <berkas.json> --yes
//
// Aturan: sandi TIDAK diubah, sesi aktif tetap berlaku. Email login lama disalin ke petugas.email_notifikasi
// (TANPA tanda terverifikasi) dan dicatat di berkas cadangan (default: folder HOME, di LUAR repo; berisi
// email -> jangan di-commit). --apply menyentuh Auth PRODUKSI: hanya atas izin CEO, mulai dengan --only <1 akun uji>.
// Prasyarat --apply: migrasi 202610090002 sudah diterapkan (kolom petugas.username).
// Nama pengguna: petugas = slug nama layanan; front_office = fo-<slug nama>; admin = adm-<slug nama>; bentrok -> -2, -3.
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  readFileSync(join(root, '.env.local'), 'utf8').split(/\r?\n/)
    .filter((l) => l && !l.trim().startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }),
);
const DOMAIN = env.NEXT_PUBLIC_STAFF_LOGIN_DOMAIN || process.env.NEXT_PUBLIC_STAFF_LOGIN_DOMAIN || 'staf.lmh.internal';
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY tidak ada di .env.local'); process.exit(2); }

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const apply = flag('--apply');
const rollbackFile = opt('--rollback');
const yes = flag('--yes');
const only = opt('--only');

const sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
const mask = (e) => (e && e.includes('@') ? `${e[0]}***${e.slice(e.indexOf('@'))}` : String(e));
const slug = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const USERNAME_RE = /^[a-z0-9][a-z0-9-]{2,31}$/;
const TERLARANG = ['admin', 'root', 'support', 'system', 'api', 'null', 'undefined'];

function bangunRencana(rows, pakai) {
  const dipakai = new Set(pakai);
  return rows.map((r) => {
    const dasar = r.role === 'petugas' ? slug(r.layanan?.nama ?? r.nama)
      : r.role === 'front_office' ? `fo-${slug(r.nama)}` : `adm-${slug(r.nama)}`;
    let base = (dasar || 'akun').slice(0, 28).replace(/-+$/g, '');
    if (!USERNAME_RE.test(base) || TERLARANG.includes(base)) base = `akun-${base}`.slice(0, 28);
    let u = base, n = 2;
    while (dipakai.has(u)) u = `${base}-${n++}`;
    dipakai.add(u);
    return { ...r, username_baru: u };
  });
}

async function muat() {
  const { data, error } = await sb.from('petugas')
    .select('id, auth_user_id, nama, role, aktif, layanan(nama)').order('role').order('nama');
  if (error) throw new Error(`baca petugas: ${error.message}`);
  const out = [];
  for (const p of data) {
    const { data: u, error: ue } = await sb.auth.admin.getUserById(p.auth_user_id);
    if (ue) throw new Error(`baca auth user ${p.id}: ${ue.message}`);
    out.push({ ...p, layanan: Array.isArray(p.layanan) ? p.layanan[0] : p.layanan, email_lama: u.user?.email ?? null, last_sign_in_at: u.user?.last_sign_in_at ?? null });
  }
  return out;
}

async function kolomUsernameAda() {
  const { error } = await sb.from('petugas').select('username').limit(1);
  return !error;
}

async function main() {
  if (rollbackFile) return rollback();
  const ada = await kolomUsernameAda();
  let existing = [];
  if (ada) existing = (await sb.from('petugas').select('username').not('username', 'is', null)).data?.map((r) => r.username) ?? [];
  const semua = await muat();
  const sudah = (r) => r.email_lama?.toLowerCase().endsWith(`@${DOMAIN}`);
  const target = bangunRencana(semua.filter((r) => !sudah(r) && (!only || r.id === only)), existing);

  console.log(`${apply ? 'APPLY' : 'DRY-RUN (baca-saja)'}  domain=${DOMAIN}  kolom username ${ada ? 'ADA' : 'BELUM ADA (migrasi 0002 belum diterapkan)'}`);
  console.log(`akun total=${semua.length}  sudah sintetis=${semua.filter(sudah).length}  akan dimigrasi=${target.length}`);
  for (const t of target) {
    console.log(`- ${t.id.slice(0, 8)} [${t.role}${t.aktif ? '' : ',NONAKTIF'}] ${t.nama} | layanan=${t.layanan?.nama ?? '-'} | login lama=${mask(t.email_lama)} -> ${t.username_baru}@${DOMAIN} | pernah login=${t.last_sign_in_at ? 'ya' : 'BELUM'}`);
  }
  if (!apply) { console.log('\nTidak ada yang diubah. Jalankan dengan --apply --yes [--only <id>] hanya atas izin CEO.'); return; }

  if (!yes) { console.error('--apply butuh --yes'); process.exit(2); }
  if (!ada) { console.error('DITOLAK: terapkan migrasi 202610090002 dulu.'); process.exit(2); }
  if (!target.length) { console.log('Tidak ada yang dimigrasi.'); return; }
  const backup = resolve(opt('--backup') ?? join(homedir(), `lmh-akun-backup-${Date.now()}.json`));
  const rel = relative(root, backup);
  if (!rel.startsWith('..') && !isAbsolute(rel)) { console.error('DITOLAK: berkas cadangan harus di luar repo (berisi email).'); process.exit(2); }
  // Cadangan ditulis SEBELUM perubahan apa pun.
  writeFileSync(backup, JSON.stringify(target.map((t) => ({ petugas_id: t.id, auth_user_id: t.auth_user_id, email_lama: t.email_lama, username_baru: t.username_baru })), null, 2), { flag: 'wx' });
  console.log(`cadangan: ${backup}`);

  for (const t of target) {
    const emailBaru = `${t.username_baru}@${DOMAIN}`;
    const notif = t.email_lama && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t.email_lama) ? t.email_lama.toLowerCase() : null;
    const { error: e1 } = await sb.from('petugas').update({ username: t.username_baru, email_notifikasi: notif, email_notifikasi_verified_at: null }).eq('id', t.id);
    if (e1) { console.error(`GAGAL petugas ${t.id}: ${e1.message}`); process.exit(1); }
    const { error: e2 } = await sb.auth.admin.updateUserById(t.auth_user_id, { email: emailBaru, email_confirm: true });
    if (e2) {
      await sb.from('petugas').update({ username: null, email_notifikasi: null }).eq('id', t.id);
      console.error(`GAGAL auth ${t.id}: ${e2.message} (petugas dikembalikan). Berhenti.`);
      process.exit(1);
    }
    console.log(`OK ${t.id.slice(0, 8)} -> ${t.username_baru}`);
  }
}

async function rollback() {
  if (!yes) { console.error('--rollback butuh --yes'); process.exit(2); }
  if (!existsSync(rollbackFile)) { console.error('berkas cadangan tidak ada'); process.exit(2); }
  for (const t of JSON.parse(readFileSync(rollbackFile, 'utf8'))) {
    const { error } = await sb.auth.admin.updateUserById(t.auth_user_id, { email: t.email_lama, email_confirm: true });
    if (error) { console.error(`GAGAL auth ${t.petugas_id}: ${error.message}`); continue; }
    await sb.from('petugas').update({ username: null }).eq('id', t.petugas_id);
    await sb.from('petugas').update({ email_notifikasi: null, email_notifikasi_verified_at: null }).eq('id', t.petugas_id).eq('email_notifikasi', t.email_lama?.toLowerCase());
    console.log(`kembali ${t.petugas_id.slice(0, 8)}`);
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
