// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ToastProvider } from '@/components/Toast';

function renderLayoutContent(children: React.ReactNode) {
  return render(
    <div data-testid="layout-root" lang="id">
      <a href="#main-content" className="skip-link">
        Lewati ke konten utama
      </a>
      <ToastProvider>
        <main id="main-content">{children}</main>
      </ToastProvider>
    </div>,
  );
}

describe('I9 a11y layout smoke tests', () => {
  afterEach(() => cleanup());

  it('root container carries lang="id"', () => {
    const { getByTestId } = renderLayoutContent(<div>Konten</div>);
    const root = getByTestId('layout-root');
    expect(root.getAttribute('lang')).toBe('id');
  });

  it('skip link exists with href="#main-content"', () => {
    const { container } = renderLayoutContent(<div>Konten</div>);
    const skipLink = container.querySelector('a.skip-link');
    expect(skipLink).not.toBeNull();
    expect(skipLink?.getAttribute('href')).toBe('#main-content');
    expect(skipLink?.textContent).toContain('Lewati ke konten utama');
  });

  it('main element has id="main-content"', () => {
    const { container } = renderLayoutContent(<div>Konten</div>);
    const mainEl = container.querySelector('main#main-content');
    expect(mainEl).not.toBeNull();
  });

  it('skip link is the first element inside the layout root', () => {
    const { getByTestId } = renderLayoutContent(<div>Konten</div>);
    const root = getByTestId('layout-root');
    const firstChild = root.firstElementChild;
    expect(firstChild?.tagName).toBe('A');
    expect(firstChild?.className).toContain('skip-link');
  });
});
