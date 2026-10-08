// Enkripsi rahasia pengaturan (server-only): AES-256-GCM, kunci induk di env SETTINGS_ENCRYPTION_KEY
// (32 byte, base64). Kunci induk TIDAK pernah disimpan di DB. Tanpa env -> simpan rahasia ditolak,
// sistem tetap jalan dengan env lama. Plaintext tidak pernah di-log.
import crypto from 'node:crypto';

export interface SecretBlob {
  ciphertext: string;
  iv: string;
  tag: string;
  key_id: number;
  last4: string;
}

export class EncryptionNotConfiguredError extends Error {
  constructor() {
    super('SETTINGS_ENCRYPTION_KEY belum diset (32 byte base64). Rahasia tidak dapat disimpan.');
    this.name = 'EncryptionNotConfiguredError';
  }
}

const KEY_ID = 1; // ponytail: satu kunci induk; rotasi = kolom key_id + skrip enkripsi ulang bila perlu.

function masterKey(): Buffer | null {
  const raw = process.env.SETTINGS_ENCRYPTION_KEY?.trim();
  if (!raw) return null;
  const key = Buffer.from(raw, 'base64');
  return key.length === 32 ? key : null;
}

export function isEncryptionConfigured(): boolean {
  return masterKey() !== null;
}

export function encryptSecret(plain: string): SecretBlob {
  const key = masterKey();
  if (!key) throw new EncryptionNotConfiguredError();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return {
    ciphertext: enc.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    key_id: KEY_ID,
    // 4 akhir hanya untuk penanda tampilan; kunci pendek tidak dibocorkan sedikit pun.
    last4: plain.length >= 12 ? plain.slice(-4) : '',
  };
}

export function decryptSecret(blob: Pick<SecretBlob, 'ciphertext' | 'iv' | 'tag'>): string {
  const key = masterKey();
  if (!key) throw new EncryptionNotConfiguredError();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(blob.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(blob.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(blob.ciphertext, 'base64')), decipher.final()]).toString('utf8');
}

/** Tampilan tersamar untuk UI: "••••abcd" (tanpa 4 akhir bila kunci pendek). */
export const maskSecret = (last4: string | null | undefined): string => `••••${last4 ?? ''}`;
