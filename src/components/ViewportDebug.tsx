'use client';

import { useEffect, useState } from 'react';

/**
 * iPhone Safari 全屏延伸调试面板（仅 URL 带 ?vt=1 时显示，不影响正常用户）。
 * 显示运行时 viewport 数据 + 顶部/底部 fixed 色条，判断 viewport-fit=cover 是否生效。
 */
export default function ViewportDebug() {
  const [data, setData] = useState<Record<string, string>>({});
  const enabled = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('vt');

  useEffect(() => {
    if (!enabled) return;

    const read = () => {
      const de = document.documentElement;
      setData({
        innerWidth: String(window.innerWidth),
        innerHeight: String(window.innerHeight),
        docClientWidth: String(de.clientWidth),
        docClientHeight: String(de.clientHeight),
        docScrollHeight: String(de.scrollHeight),
        visualViewportH: String(window.visualViewport?.height ?? 'n/a'),
        htmlComputedH: getComputedStyle(de).height,
        htmlOverflow: `${getComputedStyle(de).overflowX} / ${getComputedStyle(de).overflowY}`,
        bodyBg: getComputedStyle(document.body).backgroundColor,
        bodyComputedH: getComputedStyle(document.body).height,
        scrollY: String(window.scrollY),
      });
    };
    read();
    window.addEventListener('resize', read);
    window.visualViewport?.addEventListener('resize', read);
    return () => {
      window.removeEventListener('resize', read);
      window.visualViewport?.removeEventListener('resize', read);
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99999, pointerEvents: 'none', fontFamily: 'monospace' }}>
      {/* 顶部安全区色条 */}
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, height: '6px', background: '#ff4d4f', zIndex: 1 }} />
      {/* 底部安全区色条 */}
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, height: '6px', background: '#1677ff', zIndex: 1 }} />
      {/* 数据面板 */}
      <div style={{ position: 'fixed', top: 10, right: 10, zIndex: 2, background: 'rgba(0,0,0,0.85)', color: '#fff', padding: '10px 12px', borderRadius: 8, fontSize: 12, lineHeight: 1.6, pointerEvents: 'auto', maxWidth: '70vw' }}>
        <div style={{ fontWeight: 700, marginBottom: 4, color: '#7dd3fc' }}>Viewport Debug (?vt=1)</div>
        {Object.entries(data).map(([k, v]) => (
          <div key={k}><span style={{ color: '#93c5fd' }}>{k}:</span> {v}</div>
        ))}
        <div style={{ marginTop: 6, color: '#fbbf24', fontSize: 11 }}>
          红条=fixed top:0（应进入状态栏区域）｜蓝条=fixed bottom:0（应进入地址栏区域）
        </div>
      </div>
    </div>
  );
}
