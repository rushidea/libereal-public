import { describe, expect, it } from 'vitest';
import { CACHED_TOOL_FAVICON_HOSTS, getToolFaviconSrc } from '@/lib/tool-favicon';
import { scenes } from '@/data/scenes';

describe('tool favicon cache', () => {
  it('resolves cached hostnames to same-origin paths', () => {
    expect(getToolFaviconSrc('https://scanpy.readthedocs.io/en/stable/')).toBe(
      '/images/tool-favicons/scanpy.readthedocs.io.png',
    );
    expect(getToolFaviconSrc('https://mole.fit/?atp=libereal')).toBe(
      '/images/tool-favicons/mole.fit.png',
    );
  });

  it('prefers explicit local iconUrl over hostname lookup', () => {
    expect(
      getToolFaviconSrc('https://example.com/', '/images/tool-favicons/custom.png'),
    ).toBe('/images/tool-favicons/custom.png');
  });

  it('does not return third-party favicon URLs', () => {
    expect(
      getToolFaviconSrc(
        'https://unknown-tool.example/',
        'https://www.google.com/s2/favicons?sz=64&domain=unknown-tool.example',
      ),
    ).toBeNull();
    expect(getToolFaviconSrc('/support/elisa-curve-fit')).toBeNull();
  });

  it('covers every external analysisSoftware hostname', () => {
    const missing = new Set<string>();
    for (const scene of scenes) {
      for (const tool of scene.analysisSoftware ?? []) {
        if (!/^https?:\/\//.test(tool.href)) continue;
        const host = new URL(tool.href).hostname;
        if (!CACHED_TOOL_FAVICON_HOSTS.has(host)) missing.add(host);
      }
    }
    expect([...missing].sort()).toEqual([]);
  });
});
