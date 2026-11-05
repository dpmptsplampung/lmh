// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss, { type AtRule, type Node } from 'postcss';
import { expect, it } from 'vitest';

const css = postcss.parse(readFileSync(resolve(__dirname, 'cetak.module.css'), 'utf8'));
const tema = postcss.parse(readFileSync(resolve(__dirname, '../../../../styles/tema-dasbor.css'), 'utf8'));
const token: Record<string, string> = {};
tema.walkDecls(/^--/, (d) => { token[d.prop] = d.value; });

function gaya(selector: string, media: 'screen' | 'print') {
  const hasil: Record<string, string> = {};
  css.walkRules(selector, (rule) => {
    for (let p: Node | undefined = rule.parent; p; p = p.parent) {
      if (p.type === 'atrule' && (p as AtRule).name === 'media') {
        const params = (p as AtRule).params;
        if (params.includes('print') && media !== 'print') return;
        if (params.includes('screen') && media !== 'screen') return;
      }
    }
    rule.walkDecls((d) => { hasil[d.prop] = d.value; });
  });
  return hasil;
}

function warna(nilai: string) {
  const hex = nilai.replace(/var\((--[^)]+)\)/g, (_, nama: string) => token[nama]);
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

function luminansi(rgb: number[]) {
  const linier = rgb.map((n) => n / 255).map((n) => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4);
  return linier[0] * 0.2126 + linier[1] * 0.7152 + linier[2] * 0.0722;
}

it('PP-1: batang laporan di layar mempunyai kontras minimal 3:1 terhadap jalurnya', () => {
  const batang = gaya('.batangIsi', 'screen');
  const latar = warna(gaya('.batang', 'screen').background);
  const alpha = Number(batang.opacity ?? 1);
  const isi = warna(batang.background).map((n, i) => n * alpha + latar[i] * (1 - alpha));
  const terang = Math.max(luminansi(isi), luminansi(latar));
  const gelap = Math.min(luminansi(isi), luminansi(latar));
  expect((terang + 0.05) / (gelap + 0.05)).toBeGreaterThanOrEqual(3);
});

it('PP-1: cetak hitam putih tetap memakai batang tipis dan label angka', () => {
  expect(gaya('.batangIsi', 'print')).toMatchObject({ background: 'currentColor', opacity: '.2' });
  expect(gaya('.batangNilai', 'print').display).toBe('flex');
  expect(gaya('.kertas', 'print')).toMatchObject({ padding: '0', border: '0' });
});

it('PP-1: label angka tetap terbaca ketika batang penuh melewati label', () => {
  const label = gaya('.batangNilai', 'screen');
  const latar = warna(label.background ?? gaya('.batangIsi', 'screen').background);
  const teks = warna(label.color);
  const terang = Math.max(luminansi(teks), luminansi(latar));
  const gelap = Math.min(luminansi(teks), luminansi(latar));
  expect((terang + 0.05) / (gelap + 0.05)).toBeGreaterThanOrEqual(4.5);
});
