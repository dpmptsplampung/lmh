'use client';

// Kotak ketik pesan dan pemilih foto lampiran. Hanya tampilan dari props.
//
// `elemenMasukanPesan` adalah FUNGSI yang mengembalikan elemen MessageInput, bukan komponen: ChatContainer milik
// chatscope memilih anaknya menurut TIPE elemen (ConversationHeader / MessageList / MessageInput), jadi MessageInput harus
// muncul langsung sebagai anak ChatContainer; komponen pembungkus tidak akan dikenali.
import type { ReactElement } from 'react';
import { MessageInput } from '@chatscope/chat-ui-kit-react';

const ID_INPUT_FOTO = 'chatInputFoto';

/** Membuka dialog pemilih foto (tombol lampir di MessageInput). Lewat id DOM agar tidak ada ref yang dioper saat render. */
const bukaPemilihFoto = () => document.getElementById(ID_INPUT_FOTO)?.click();

export interface MasukanPesanProps {
  placeholder: string;
  nonaktif: boolean;
  /** Teks dengan baris baru (Shift+Enter) ikut terkirim. */
  onKirim: (teks: string) => void;
}

export function elemenMasukanPesan({ placeholder, nonaktif, onKirim }: MasukanPesanProps): ReactElement {
  return (
    <MessageInput
      placeholder={placeholder}
      disabled={nonaktif}
      attachButton
      onAttachClick={bukaPemilihFoto}
      onSend={(_html, _text, innerText) => onKirim(innerText)} // innerText: baris baru (Shift+Enter) ikut terkirim
    />
  );
}

export interface InputFotoProps {
  onPilih: (berkas: File | undefined) => void;
}

/** Input berkas tersembunyi (jpeg/png/webp). Nilai direset agar foto yang sama bisa dipilih ulang. */
export function InputFoto({ onPilih }: InputFotoProps) {
  return (
    <input
      id={ID_INPUT_FOTO}
      type="file"
      accept="image/jpeg,image/png,image/webp"
      hidden
      onChange={(e) => { onPilih(e.target.files?.[0]); e.target.value = ''; }}
    />
  );
}
