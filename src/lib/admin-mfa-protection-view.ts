export type AdminMfaProtectionTone = 'unavailable' | 'off' | 'on';

export interface AdminMfaProtectionView {
  badge: string;
  tone: AdminMfaProtectionTone;
  scenariosEnforced: boolean;
  hint: string;
  sensitiveOperations: string;
}

export function getAdminMfaProtectionView(input: {
  available: boolean;
  enabled: boolean;
}): AdminMfaProtectionView {
  if (!input.available) {
    return {
      badge: '双因素认证功能未开放',
      tone: 'unavailable',
      scenariosEnforced: false,
      hint: '验证器功能尚未开放，本页场景处于待用状态。',
      sensitiveOperations: '验证器功能尚未开放，本页场景处于待用状态。',
    };
  }

  if (input.enabled) {
    return {
      badge: '系统保护已开启',
      tone: 'on',
      scenariosEnforced: true,
      hint: '下方开启的场景会在对应后台写操作前要求再次确认身份。',
      sensitiveOperations: '按照下方设置，在指定操作前再次确认身份',
    };
  }

  return {
    badge: '双因素认证功能已开放',
    tone: 'off',
    scenariosEnforced: false,
    hint: '验证器功能已经开放；管理员敏感操作保护仍由管理员强制开关控制。当前可保存下方场景配置，启用强制保护后生效。',
    sensitiveOperations: '管理员强制保护开启后，按照下方设置在指定操作前再次确认身份。',
  };
}

export function formatAdminMfaScenarioCount(count: number, scenariosEnforced: boolean): string {
  return scenariosEnforced ? `${count} 项开启` : `已配置 ${count} 项`;
}
