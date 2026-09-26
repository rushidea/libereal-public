import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ToastProvider, useToast } from '@/context/ToastContext';

function Probe() {
  const { show } = useToast();
  return (
    <button type="button" onClick={() => show('购物车已临时保存在本机', 'info')}>
      trigger
    </button>
  );
}

describe('ToastProvider night-safe tones', () => {
  afterEach(() => {
    cleanup();
  });

  it('uses brand token surfaces instead of pale blue/gray utilities', () => {
    render(
      <ToastProvider>
        <Probe />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'trigger' }));
    const toast = screen.getByRole('status');
    expect(toast.className).toContain('bg-[var(--brand-color-info-bg)]');
    expect(toast.className).toContain('border-[var(--brand-color-info-border)]');
    expect(screen.getByText('购物车已临时保存在本机').className).toContain(
      'text-[var(--brand-color-text)]',
    );
  });
});
