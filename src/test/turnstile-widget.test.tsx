import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TurnstileWidget from '@/components/TurnstileWidget';

type TurnstileOptions = {
  callback: (token: string) => void;
  'error-callback'?: (code?: string) => boolean | void;
};

describe('TurnstileWidget', () => {
  const renderMock = vi.fn();
  const removeMock = vi.fn();
  const resetMock = vi.fn();

  beforeEach(() => {
    document.querySelectorAll('script[src*="cloudflare.com/turnstile"]').forEach((script) => script.remove());
    renderMock.mockReset().mockReturnValue('widget-1');
    removeMock.mockReset();
    resetMock.mockReset();
    Reflect.deleteProperty(window, 'turnstile');
  });

  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, 'turnstile');
  });

  it('lets Turnstile automatically retry a recoverable 600 error', async () => {
    const onVerify = vi.fn();
    render(<TurnstileWidget onVerify={onVerify} siteKey="test-site-key" />);

    await waitFor(() => expect(document.querySelector('script[src*="cloudflare.com/turnstile"]')).not.toBeNull());
    Object.defineProperty(window, 'turnstile', {
      configurable: true,
      writable: true,
      value: { render: renderMock, remove: removeMock, reset: resetMock },
    });
    const callbackName = Object.keys(window).find((key) => key.startsWith('turnstileOnLoad_')) as `turnstileOnLoad_${number}`;
    window[callbackName]?.();

    await waitFor(() => expect(renderMock).toHaveBeenCalledTimes(1));
    const options = renderMock.mock.calls[0][1] as TurnstileOptions;

    expect(options['error-callback']?.('600010')).toBe(false);
    expect(onVerify).toHaveBeenCalledWith('');
    expect(resetMock).not.toHaveBeenCalled();
  });
});
