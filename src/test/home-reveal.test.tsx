import { cleanup, render } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Reveal from '@/components/home/Reveal';
import { heroParallaxOffset } from '@/components/home/hero-parallax';

function mockMatchMedia(reduced: boolean) {
  class MockObserver {
    observe() {}
    disconnect() {}
    unobserve() {}
    takeRecords() { return []; }
  }
  vi.stubGlobal('IntersectionObserver', MockObserver);
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-reduced-motion') ? reduced : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  }));
}

function mockRect(rect: Partial<DOMRect>) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    toJSON() { return {}; },
    ...rect,
  }));
}

describe('homepage Reveal', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps server markup visible', () => {
    const html = renderToString(
      <Reveal stagger={40}>
        <p>可见正文</p>
      </Reveal>,
    );
    expect(html).toContain('可见正文');
    expect(html).not.toContain('data-home-reveal');
    expect(html).not.toContain('opacity:0');
    expect(html).not.toContain('opacity: 0');
  });

  it('hides offscreen content only after hydration', () => {
    mockMatchMedia(false);
    mockRect({ top: 1400, bottom: 1800, height: 400, width: 320 });
    const { container } = render(
      <Reveal>
        <p>下文</p>
      </Reveal>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.dataset.homeReveal).toBe('hidden');
    expect(root.style.opacity).toBe('0');
    expect(root.style.transform).toContain('16px');
  });

  it('leaves in-view content untouched', () => {
    mockMatchMedia(false);
    mockRect({ top: 40, bottom: 240, height: 200, width: 320 });
    const { container } = render(<Reveal><p>首屏</p></Reveal>);
    const root = container.firstElementChild as HTMLElement;
    expect(root.dataset.homeReveal).toBe('idle');
    expect(root.style.opacity).toBe('');
  });

  it('does not hide content when reduced motion is requested', () => {
    mockMatchMedia(true);
    mockRect({ top: 1400, bottom: 1800, height: 400, width: 320 });
    const { container } = render(
      <Reveal stagger={50}>
        <p>静止</p>
        <p>仍然可见</p>
      </Reveal>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.dataset.homeReveal).toBe('idle');
    expect(root.innerHTML).not.toContain('opacity: 0');
    expect(root.innerHTML).not.toContain('opacity:0');
  });

  it('staggers direct children instead of the wrapper', () => {
    mockMatchMedia(false);
    mockRect({ top: 1400, bottom: 1800, height: 400, width: 320 });
    const { container } = render(
      <Reveal stagger={80}>
        <p>一</p>
        <p>二</p>
      </Reveal>,
    );
    const root = container.firstElementChild as HTMLElement;
    const [first, second] = Array.from(root.children) as HTMLElement[];
    expect(root.style.opacity).toBe('');
    expect(first.style.opacity).toBe('0');
    expect(second.style.opacity).toBe('0');
  });
});

describe('hero parallax offset', () => {
  it('stays at rest until scroll and caps the drift', () => {
    expect(heroParallaxOffset(0, 0.05, true)).toBe(0);
    expect(heroParallaxOffset(-40, 0.05, true)).toBe(0);
    expect(heroParallaxOffset(200, 0.05, true)).toBeCloseTo(10);
    expect(heroParallaxOffset(800, 0.05, true)).toBe(16);
  });

  it('is disabled when motion is not allowed', () => {
    expect(heroParallaxOffset(400, 0.05, false)).toBe(0);
    expect(heroParallaxOffset(400, Number.NaN, true)).toBe(0);
  });
});
