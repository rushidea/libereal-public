import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MobileSiteMenu from '@/components/mobile/MobileSiteMenu';

vi.mock('@/components/mobile/BottomPopup', () => ({
  default: ({ isOpen, placement, children }: { isOpen: boolean; placement?: string; children: ReactNode }) => (
    isOpen ? <div data-testid="mobile-site-menu-popup" data-placement={placement}>{children}</div> : null
  ),
}));

describe('MobileSiteMenu', () => {
  afterEach(() => cleanup());

  it('renders from the top-left popup placement', () => {
    render(<MobileSiteMenu isOpen onClose={vi.fn()} onQuickOrder={vi.fn()} />);

    expect(screen.getByTestId('mobile-site-menu-popup')).toHaveAttribute('data-placement', 'top-left');
  });

  it('expands from the label and navigates from the right arrow', () => {
    render(<MobileSiteMenu isOpen onClose={vi.fn()} onQuickOrder={vi.fn()} />);

    expect(screen.getByRole('link', { name: '前往研究工具' })).toHaveAttribute('href', '/research-tools');
    fireEvent.click(screen.getByRole('button', { name: '研究工具' }));

    expect(screen.getByRole('button', { name: '公共工具与分析软件' })).toBeInTheDocument();
  });

  it('closes the menu when the right arrow link is clicked', () => {
    const onClose = vi.fn();
    render(<MobileSiteMenu isOpen onClose={onClose} onQuickOrder={vi.fn()} />);

    fireEvent.click(screen.getByRole('link', { name: '前往研究工具' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('uses the same interaction for nested links with children', () => {
    render(<MobileSiteMenu isOpen onClose={vi.fn()} onQuickOrder={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '研究工具' }));

    const publicTools = screen.getByRole('button', { name: '公共工具与分析软件' });
    fireEvent.click(publicTools);

    expect(screen.getByText('抗体验证与选型')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '前往公共工具与分析软件' })).toHaveAttribute('href', '/scenes#public-tools');
  });
});
