const SUPPRESS_ATTR = 'data-suppress-chatway';
const SUPPRESS_COUNT_ATTR = 'data-suppress-chatway-count';

/**
 * Chatway 气泡 z-index 极高，无法压过。需要规格选择等关键 UI 可见时，临时隐藏聊天气泡。
 * 返回释放函数，支持多层嵌套调用。
 */
export function acquireChatwaySuppression(): () => void {
  if (typeof document === 'undefined') return () => {};

  const next = Number(document.body.getAttribute(SUPPRESS_COUNT_ATTR) || '0') + 1;
  document.body.setAttribute(SUPPRESS_COUNT_ATTR, String(next));
  document.body.setAttribute(SUPPRESS_ATTR, 'true');

  return () => {
    const remaining = Math.max(
      Number(document.body.getAttribute(SUPPRESS_COUNT_ATTR) || '1') - 1,
      0,
    );
    if (remaining === 0) {
      document.body.removeAttribute(SUPPRESS_COUNT_ATTR);
      document.body.removeAttribute(SUPPRESS_ATTR);
      return;
    }
    document.body.setAttribute(SUPPRESS_COUNT_ATTR, String(remaining));
  };
}
