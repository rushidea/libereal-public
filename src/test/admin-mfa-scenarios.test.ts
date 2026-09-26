import { describe, expect, it } from 'vitest';
import {
  ADMIN_MFA_SCENARIO_GROUPS,
  DEFAULT_ADMIN_MFA_SCENARIOS,
  normalizeAdminMfaScenarioConfig,
  parseAdminMfaScenarioConfig,
} from '@/lib/admin-mfa-scenarios';

describe('admin MFA scenario configuration', () => {
  it('defines independent scenarios across each category', () => {
    expect(ADMIN_MFA_SCENARIO_GROUPS).toHaveLength(5);
    expect(ADMIN_MFA_SCENARIO_GROUPS.flatMap((group) => group.items.map((item) => item.id))).toEqual(expect.arrayContaining([
      'pricing.write',
      'credit.adjust',
      'roles.manage',
      'customers.write',
    ]));
  });

  it('keeps omitted values at their safe defaults while accepting individual changes', () => {
    const normalized = normalizeAdminMfaScenarioConfig({ 'customers.write': true, 'roles.manage': false });

    expect(normalized['customers.write']).toBe(true);
    expect(normalized['roles.manage']).toBe(false);
    expect(normalized['finance.write']).toBe(DEFAULT_ADMIN_MFA_SCENARIOS['finance.write']);
  });

  it('falls back to defaults for malformed stored configuration', () => {
    expect(parseAdminMfaScenarioConfig('{invalid')).toEqual(DEFAULT_ADMIN_MFA_SCENARIOS);
  });
});
