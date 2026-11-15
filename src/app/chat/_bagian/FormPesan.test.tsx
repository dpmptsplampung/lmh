// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ChatContainer } from '@chatscope/chat-ui-kit-react';
import { elemenMasukanPesan, InputFoto } from './FormPesan';

afterEach(cleanup);

describe('FormPesan', () => {
  it('MessageInput dikenali ChatContainer: placeholder, status nonaktif, dan tombol lampir ada', () => {
    const { container, rerender } = render(
      <ChatContainer>{elemenMasukanPesan({ placeholder: 'Ketik pertanyaan Anda...', nonaktif: false, onKirim: vi.fn() })}</ChatContainer>,
    );
    expect(container.querySelector('.cs-message-input')).not.toBeNull();
    expect(container.querySelector('.cs-message-input__content-editor-wrapper [data-placeholder]')?.getAttribute('data-placeholder'))
      .toBe('Ketik pertanyaan Anda...');
    expect(container.querySelector('.cs-button--attachment')).not.toBeNull();
    expect(container.querySelector('.cs-message-input--disabled')).toBeNull();
    rerender(<ChatContainer>{elemenMasukanPesan({ placeholder: 'x', nonaktif: true, onKirim: vi.fn() })}</ChatContainer>);
    expect(container.querySelector('.cs-message-input--disabled')).not.toBeNull();
  });

  it('InputFoto: hanya jpeg/png/webp, meneruskan berkas terpilih lalu mereset nilainya', () => {
    const onPilih = vi.fn();
    const { container } = render(<InputFoto onPilih={onPilih} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.accept).toBe('image/jpeg,image/png,image/webp');
    expect(input.hidden).toBe(true);
    const berkas = new File(['x'], 'foto.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [berkas] } });
    expect(onPilih).toHaveBeenCalledWith(berkas);
  });
});
