import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import anggaran from './anggaran-kode.json'

/**
 * Penjaga anggaran kode (SPEC refaktor arsitektur-UI §3, §5, §7).
 * Angka di anggaran-kode.json adalah batas atas: test merah bila ada yang naik.
 * Bila angka turun, perbarui JSON ke angka baru supaya tidak bisa naik lagi.
 */

const AKAR = join(process.cwd(), 'src')

function semuaBerkas(dir: string, keluar: string[] = []): string[] {
  for (const nama of readdirSync(dir)) {
    const p = join(dir, nama)
    if (statSync(p).isDirectory()) semuaBerkas(p, keluar)
    else keluar.push(p)
  }
  return keluar
}

const rel = (p: string) => relative(AKAR, p).split(sep).join('/')
const bukanTest = (p: string) => !/\.test\.[tj]sx?$/.test(p)
const BERKAS = semuaBerkas(AKAR).filter(bukanTest)
const baca = (p: string) => readFileSync(p, 'utf8')
const hitung = (teks: string, re: RegExp) => (teks.match(re) ?? []).length
const tanpaKomentarCss = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '')
const tanpaKomentarJs = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const css = BERKAS.filter((p) => p.endsWith('.module.css'))
const tsx = BERKAS.filter((p) => p.endsWith('.tsx'))
const kode = BERKAS.filter((p) => /\.(ts|tsx)$/.test(p))
const pages = BERKAS.filter((p) => /^app\/.*page\.tsx$/.test(rel(p)))

const SKALA = new Set([640, 1024, 1280])
const PAGE_RAKSASA = [
  'app/admin/antrian/page.tsx',
  'app/chat/page.tsx',
  'app/admin/chat/page.tsx',
  'app/admin/chat/faq/page.tsx',
  'app/me/reservasi/page.tsx',
]

/**
 * Token yang dipakai lewat var(--x) TANPA nilai cadangan tetapi tidak didefinisikan di mana pun: bukan di
 * src/styles/token.css (lingkup apa pun), bukan sebagai custom property lokal di modul CSS, dan bukan sebagai
 * kunci gaya inline ('--x') di TS/TSX. Dihitung per nama (bukan per pemakaian). Awalan dinamis
 * (var(--chart-${i})) dilewati.
 */
function hitungTokenTakTerdefinisi(): number {
  const didefinisikan = new Set<string>()
  const dipakai = new Set<string>()
  const token = baca(join(AKAR, 'styles/token.css'))
  for (const m of tanpaKomentarCss(token).matchAll(/(--[\w-]+)\s*:/g)) didefinisikan.add(m[1])
  for (const p of BERKAS) {
    const css = p.endsWith('.css')
    const kode = /\.(ts|tsx)$/.test(p)
    if (!css && !kode) continue
    if (p.endsWith('styles/token.css')) continue
    const teks = css ? tanpaKomentarCss(baca(p)) : tanpaKomentarJs(baca(p))
    if (css) {
      for (const m of teks.matchAll(/(?:^|[;{\s])(--[\w-]+)\s*:/g)) didefinisikan.add(m[1])
    } else {
      for (const m of teks.matchAll(/['"`](--[\w-]+)['"`]/g)) didefinisikan.add(m[1])
    }
    for (const m of teks.matchAll(/var\(\s*(--[\w-]+)\s*(,)?/g)) {
      if (!m[2] && !m[1].endsWith('-')) dipakai.add(m[1])
    }
  }
  return [...dipakai].filter((n) => !didefinisikan.has(n)).length
}

function ukur() {
  let hex = 0
  let rgb = 0
  let zIndexLiteral = 0
  let breakpointLuarSkala = 0
  for (const p of css) {
    const teks = tanpaKomentarCss(baca(p))
    // di luar deklarasi custom property (--x: ...)
    const tanpaVar = teks
      .split('\n')
      .filter((l) => !/^\s*--[\w-]+\s*:/.test(l))
      .join('\n')
    hex += hitung(tanpaVar, /#[0-9a-fA-F]{3,8}\b/g)
    rgb += hitung(tanpaVar, /\brgba?\(/g)
    for (const m of tanpaVar.matchAll(/z-index\s*:\s*(\d+)/g)) {
      if (Number(m[1]) >= 100) zIndexLiteral++
    }
    if (!p.endsWith('layar-token.module.css')) {
      for (const m of teks.matchAll(/@media[^{]*/g)) {
        for (const w of m[0].matchAll(/(?:max|min)-width\s*:\s*(\d+)px/g)) {
          if (!SKALA.has(Number(w[1]))) breakpointLuarSkala++
        }
      }
    }
  }

  const tokenTakTerdefinisi = hitungTokenTakTerdefinisi()

  let kelasBtn = 0
  for (const p of tsx) {
    for (const l of baca(p).split('\n')) {
      if (l.includes('className') && /(^|[\s"'`{])btn([\s"'`}-]|$)/.test(l)) kelasBtn++
    }
  }

  let windowConfirm = 0
  let selectBintang = 0
  for (const p of kode) {
    const teks = tanpaKomentarJs(baca(p))
    windowConfirm += hitung(teks, /(?:^|[^.\w])(?:window\.)?confirm\s*\(/gm)
    for (const m of teks.matchAll(/\.select\(\s*(['"`])\*\1\s*(,[^)]*)?\)/g)) {
      if (!/head\s*:\s*true/.test(m[2] ?? '')) selectBintang++
    }
  }

  let kueriDiPage = 0
  for (const p of pages) kueriDiPage += hitung(tanpaKomentarJs(baca(p)), /\.(from|rpc)\(/g)

  let barisPageRaksasa = 0
  for (const r of PAGE_RAKSASA) {
    const p = join(AKAR, r)
    barisPageRaksasa += baca(p).replace(/\n$/, '').split('\n').length
  }

  return {
    hex,
    rgb,
    zIndexLiteral,
    breakpointLuarSkala,
    tokenTakTerdefinisi,
    kelasBtn,
    windowConfirm,
    selectBintang,
    kueriDiPage,
    barisPageRaksasa,
  }
}

describe('anggaran kode (hanya boleh turun)', () => {
  const sekarang = ukur()
  const batas = anggaran as Record<string, number>

  it('JSON memuat semua metrik', () => {
    expect(Object.keys(batas).sort()).toEqual(Object.keys(sekarang).sort())
  })

  for (const [kunci, nilai] of Object.entries(sekarang)) {
    it(`${kunci} tidak naik`, () => {
      const dasar = batas[kunci]
      expect(
        nilai,
        `${kunci} naik: ${nilai} > anggaran ${dasar}. Kurangi pelanggaran, jangan naikkan angka.`,
      ).toBeLessThanOrEqual(dasar)
      expect(
        nilai,
        `${kunci} turun ke ${nilai} (anggaran ${dasar}): perbarui src/test/anggaran-kode.json ke ${nilai}.`,
      ).toBeGreaterThanOrEqual(dasar)
    })
  }

  it('lima page.tsx raksasa ada', () => {
    for (const r of PAGE_RAKSASA) expect(BERKAS.map(rel)).toContain(r)
  })
})
