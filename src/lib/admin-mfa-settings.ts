import { prisma } from '@/lib/prisma';
import { isMfaAdminRequired, isMfaPhase1Enabled } from '@/lib/security/mfa-config';
import { getAdminMfaProtectionView } from './admin-mfa-protection-view';
import {
  ADMIN_MFA_PERMISSION_SCENARIOS,
  ADMIN_MFA_SCENARIO_GROUPS,
  normalizeAdminMfaScenarioConfig,
  parseAdminMfaScenarioConfig,
  scenarioConfigToJson,
  type AdminMfaScenarioConfig,
  type AdminMfaScenarioId,
} from './admin-mfa-scenarios';
import type { AdminPermissionKey } from './admin-permissions';

export const ADMIN_MFA_SETTING_ID = 'default';

export async function getAdminMfaScenarioConfig(): Promise<AdminMfaScenarioConfig> {
  const setting = await prisma.adminMfaSetting.findUnique({
    where: { id: ADMIN_MFA_SETTING_ID },
    select: { scenarios: true },
  });
  return parseAdminMfaScenarioConfig(setting?.scenarios);
}

export async function saveAdminMfaScenarioConfig(input: {
  scenarios: unknown;
  updatedByEmail: string;
}): Promise<AdminMfaScenarioConfig> {
  const scenarios = normalizeAdminMfaScenarioConfig(input.scenarios);
  await prisma.adminMfaSetting.upsert({
    where: { id: ADMIN_MFA_SETTING_ID },
    create: { id: ADMIN_MFA_SETTING_ID, scenarios: scenarioConfigToJson(scenarios), updatedByEmail: input.updatedByEmail },
    update: { scenarios: scenarioConfigToJson(scenarios), updatedByEmail: input.updatedByEmail },
  });
  return scenarios;
}

export async function requiresAdminMfaForPermission(permission: AdminPermissionKey): Promise<boolean> {
  if (!isMfaAdminRequired()) return false;
  const scenarioId = ADMIN_MFA_PERMISSION_SCENARIOS[permission];
  if (!scenarioId) return false;
  return isAdminMfaScenarioEnabled(scenarioId);
}

export async function isAdminMfaScenarioEnabled(scenarioId: AdminMfaScenarioId): Promise<boolean> {
  const scenarios = await getAdminMfaScenarioConfig();
  return scenarios[scenarioId];
}

export async function getAdminMfaSettings() {
  const setting = await prisma.adminMfaSetting.findUnique({
    where: { id: ADMIN_MFA_SETTING_ID },
    select: { scenarios: true, updatedAt: true, updatedByEmail: true },
  });
  const available = isMfaPhase1Enabled();
  const enabled = isMfaAdminRequired();
  const protection = getAdminMfaProtectionView({ available, enabled });
  return {
    enabled,
    available,
    scenariosEnforced: protection.scenariosEnforced,
    protection: {
      badge: protection.badge,
      tone: protection.tone,
      hint: protection.hint,
    },
    scenarios: parseAdminMfaScenarioConfig(setting?.scenarios),
    groups: ADMIN_MFA_SCENARIO_GROUPS,
    updatedAt: setting?.updatedAt?.toISOString() || null,
    updatedByEmail: setting?.updatedByEmail || null,
    policySummary: {
      adminLogin: '管理员登录无需再次验证；敏感操作前需要确认身份',
      userLogin: '用户可自行开启；开启后登录需要验证',
      sensitiveOperations: protection.sensitiveOperations,
      ordinaryOperations: '普通组织与账户操作无需再次验证',
      adjustment: '修改本页设置前需要确认身份',
    },
  };
}
