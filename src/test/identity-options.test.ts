import { describe, expect, it } from 'vitest';
import {
  ADVISOR_REQUIRED_IDENTITIES,
  CUSTOMER_IDENTITY_OPTIONS,
  INTERNAL_IDENTITY_OPTIONS,
  customerCanChooseIdentity,
  identityRequiresAdvisor,
  isCustomerIdentityOption,
  normalizeAdminIdentity,
  parseCustomerIdentityChoice,
} from '@/lib/identity-options';

describe('customer identity self-select', () => {
  it('allows one choice when identity is empty or legacy, and locks listed or internal values', () => {
    expect(customerCanChooseIdentity(null)).toBe(true);
    expect(customerCanChooseIdentity('')).toBe(true);
    expect(customerCanChooseIdentity('   ')).toBe(true);
    expect(customerCanChooseIdentity('资深副教授')).toBe(true);
    expect(customerCanChooseIdentity('研究生')).toBe(true);
    expect(customerCanChooseIdentity('其他')).toBe(true);

    for (const option of CUSTOMER_IDENTITY_OPTIONS) {
      expect(customerCanChooseIdentity(option)).toBe(false);
      expect(customerCanChooseIdentity(` ${option} `)).toBe(false);
    }
    for (const option of INTERNAL_IDENTITY_OPTIONS) {
      expect(customerCanChooseIdentity(option)).toBe(false);
    }
  });

  it('accepts only customer-selectable values', () => {
    expect(parseCustomerIdentityChoice(' 教授 ')).toBe('教授');
    expect(parseCustomerIdentityChoice('医师')).toBe('医师');
    expect(parseCustomerIdentityChoice('研究生')).toBeNull();
    expect(parseCustomerIdentityChoice('其他')).toBeNull();
    expect(parseCustomerIdentityChoice('内部员工')).toBeNull();
    expect(parseCustomerIdentityChoice('')).toBeNull();
    expect(parseCustomerIdentityChoice(null)).toBeNull();
    expect(isCustomerIdentityOption('渠道/经销商')).toBe(false);
  });
});

describe('admin identity allowlist', () => {
  it('accepts customer identities, internal roles, and clearing', () => {
    expect(normalizeAdminIdentity(' 博士后 ', '学生')).toEqual({ ok: true, identity: '博士后' });
    expect(normalizeAdminIdentity('渠道/经销商', null)).toEqual({ ok: true, identity: '渠道/经销商' });
    expect(normalizeAdminIdentity('', '教授')).toEqual({ ok: true, identity: null });
    expect(normalizeAdminIdentity('   ', '教授')).toEqual({ ok: true, identity: null });
    expect(normalizeAdminIdentity(null, '教授')).toEqual({ ok: true, identity: null });
  });

  it('rejects values outside the list unless they are the unchanged current value', () => {
    expect(normalizeAdminIdentity('研究生', '教授').ok).toBe(false);
    expect(normalizeAdminIdentity('其他', '学生').ok).toBe(false);
    expect(normalizeAdminIdentity('不存在身份', null).ok).toBe(false);
    expect(normalizeAdminIdentity(12, '教授').ok).toBe(false);
    expect(normalizeAdminIdentity('研究生', '研究生')).toEqual({ ok: true, identity: '研究生' });
    expect(normalizeAdminIdentity(' 资深副教授 ', '资深副教授')).toEqual({ ok: true, identity: '资深副教授' });
  });
});

describe('advisor field identities', () => {
  it('requires an advisor for 学生, 博士研究生 and 硕士研究生 only', () => {
    expect(ADVISOR_REQUIRED_IDENTITIES).toEqual(['学生', '博士研究生', '硕士研究生']);
    expect(identityRequiresAdvisor('学生')).toBe(true);
    expect(identityRequiresAdvisor(' 博士研究生 ')).toBe(true);
    expect(identityRequiresAdvisor('硕士研究生')).toBe(true);

    expect(identityRequiresAdvisor('研究生')).toBe(false);
    expect(identityRequiresAdvisor('教授')).toBe(false);
    expect(identityRequiresAdvisor('医师')).toBe(false);
    expect(identityRequiresAdvisor('内部员工')).toBe(false);
    expect(identityRequiresAdvisor('测试账号')).toBe(false);
    expect(identityRequiresAdvisor('资深副教授')).toBe(false);
    expect(identityRequiresAdvisor('')).toBe(false);
    expect(identityRequiresAdvisor(null)).toBe(false);
  });
});
