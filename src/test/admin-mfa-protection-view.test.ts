import { describe, expect, it } from 'vitest';
import {
  formatAdminMfaScenarioCount,
  getAdminMfaProtectionView,
} from '@/lib/admin-mfa-protection-view';

describe('admin MFA protection view', () => {
  it('marks scenarios inactive when the feature is closed', () => {
    expect(getAdminMfaProtectionView({ available: false, enabled: false })).toMatchObject({
      badge: '双因素认证功能未开放',
      tone: 'unavailable',
      scenariosEnforced: false,
    });
    expect(formatAdminMfaScenarioCount(6, false)).toBe('已配置 6 项');
  });

  it('distinguishes available MFA from enforced admin protection', () => {
    const view = getAdminMfaProtectionView({ available: true, enabled: false });
    expect(view.badge).toBe('双因素认证功能已开放');
    expect(view.tone).toBe('off');
    expect(view.scenariosEnforced).toBe(false);
    expect(view.hint).toContain('管理员强制开关');
    expect(view.hint).toContain('启用强制保护后生效');
    expect(view.sensitiveOperations).toContain('管理员强制保护开启后');
    expect(formatAdminMfaScenarioCount(6, view.scenariosEnforced)).toBe('已配置 6 项');
  });

  it('treats scenario switches as live only when the master switch is on', () => {
    const view = getAdminMfaProtectionView({ available: true, enabled: true });
    expect(view.badge).toBe('系统保护已开启');
    expect(view.tone).toBe('on');
    expect(view.scenariosEnforced).toBe(true);
    expect(formatAdminMfaScenarioCount(6, view.scenariosEnforced)).toBe('6 项开启');
  });
});
