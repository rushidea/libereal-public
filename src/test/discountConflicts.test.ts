import { describe, it, expect } from 'vitest';
import { detectDiscountConflicts } from '@/lib/discountConflicts';

describe('detectDiscountConflicts', () => {
  it('counts users with personal unified discount', () => {
    const users = [
      { id: 'u1', name: '张三', email: 'a@x.com', discountRate: 0.85, brandDiscounts: null, sourceTemplateId: null },
      { id: 'u2', name: '李四', email: 'b@x.com', discountRate: null, brandDiscounts: null, sourceTemplateId: null },
      { id: 'u3', name: '王五', email: 'c@x.com', discountRate: 0.90, brandDiscounts: null, sourceTemplateId: null },
    ];
    const info = detectDiscountConflicts(users, { id: 't1', discountRate: '0.80', brandDiscounts: null });
    expect(info.withPersonalDiscount).toBe(2);
  });

  it('counts users with brand discounts (any brand key)', () => {
    const users = [
      { id: 'u1', email: 'a@x.com', discountRate: null, brandDiscounts: '{"Abcam": 0.7}', sourceTemplateId: null },
      { id: 'u2', email: 'b@x.com', discountRate: null, brandDiscounts: '{}', sourceTemplateId: null }, // 空对象不算
      { id: 'u3', email: 'c@x.com', discountRate: null, brandDiscounts: null, sourceTemplateId: null },
    ];
    const info = detectDiscountConflicts(users, { id: 't1', brandDiscounts: null });
    expect(info.withBrandDiscounts).toBe(1);
  });

  it('counts users who already have a different template applied', () => {
    const users = [
      { id: 'u1', email: 'a@x.com', discountRate: 0.85, brandDiscounts: null, sourceTemplateId: 't1' }, // 当前模板
      { id: 'u2', email: 'b@x.com', discountRate: 0.85, brandDiscounts: null, sourceTemplateId: 't2' }, // 其他模板
      { id: 'u3', email: 'c@x.com', discountRate: null, brandDiscounts: null, sourceTemplateId: null },
    ];
    const info = detectDiscountConflicts(users, { id: 't1', discountRate: '0.80', brandDiscounts: null });
    expect(info.hasOtherTemplate).toBe(1); // 只 u2
  });

  it('detects brand-level conflicts (same brand, different rate)', () => {
    const users = [
      { id: 'u1', email: 'a@x.com', discountRate: null, brandDiscounts: '{"Abcam": 0.85, "Fisher": 0.90}', sourceTemplateId: null },
    ];
    const info = detectDiscountConflicts(users, {
      id: 't1',
      brandDiscounts: '{"Abcam": 0.75, "Fisher": 0.90, "Sigma": 0.80}',
    });
    expect(info.brandConflicts).toEqual([
      { userName: 'a@x.com', brand: 'Abcam', existing: 0.85, incoming: 0.75 },
    ]);
    // Fisher 同 rate 不算冲突
  });

  it('uses user name in conflict report, falls back to email', () => {
    const users = [
      { id: 'u1', name: null, email: 'a@x.com', discountRate: null, brandDiscounts: '{"Abcam": 0.85}', sourceTemplateId: null },
    ];
    const info = detectDiscountConflicts(users, {
      id: 't1',
      brandDiscounts: '{"Abcam": 0.75}',
    });
    expect(info.brandConflicts[0].userName).toBe('a@x.com');
  });

  it('handles invalid brandDiscounts JSON gracefully', () => {
    const users = [
      { id: 'u1', email: 'a@x.com', discountRate: null, brandDiscounts: 'not-json', sourceTemplateId: null },
    ];
    const info = detectDiscountConflicts(users, { id: 't1', brandDiscounts: null });
    expect(info.withBrandDiscounts).toBe(0);
  });

  it('handles null/undefined discount template brandDiscounts', () => {
    const users = [{ id: 'u1', email: 'a@x.com', discountRate: null, brandDiscounts: null, sourceTemplateId: null }];
    expect(() => detectDiscountConflicts(users, { id: 't1' })).not.toThrow();
    expect(() => detectDiscountConflicts(users, { id: 't1', brandDiscounts: '' })).not.toThrow();
  });

  it('returns zero conflicts when no overlap', () => {
    const users = [
      { id: 'u1', email: 'a@x.com', discountRate: null, brandDiscounts: null, sourceTemplateId: null },
    ];
    const info = detectDiscountConflicts(users, { id: 't1', discountRate: '0.80', brandDiscounts: '{"Abcam": 0.70}' });
    expect(info.withPersonalDiscount).toBe(0);
    expect(info.withBrandDiscounts).toBe(0);
    expect(info.brandConflicts).toEqual([]);
    expect(info.hasOtherTemplate).toBe(0);
  });

  it('treats rate difference > 0.001 as conflict (avoids float precision noise)', () => {
    const users = [
      { id: 'u1', email: 'a@x.com', discountRate: null, brandDiscounts: '{"Abcam": 0.85}', sourceTemplateId: null },
    ];
    // 模板 0.8501 vs 用户 0.85 - 差 0.0001，不算冲突
    const info1 = detectDiscountConflicts(users, { id: 't1', brandDiscounts: '{"Abcam": 0.8501}' });
    expect(info1.brandConflicts).toEqual([]);

    // 模板 0.86 vs 用户 0.85 - 差 0.01，算冲突
    const info2 = detectDiscountConflicts(users, { id: 't1', brandDiscounts: '{"Abcam": 0.86}' });
    expect(info2.brandConflicts).toHaveLength(1);
  });

  it('handles null template id (defensive coding)', () => {
    const users = [{ id: 'u1', email: 'a@x.com', discountRate: 0.8, brandDiscounts: null, sourceTemplateId: 't1' }];
    const info = detectDiscountConflicts(users, { id: '', discountRate: '0.80', brandDiscounts: null });
    // sourceTemplateId 't1' vs template id '' - different → hasOtherTemplate = 1
    expect(info.hasOtherTemplate).toBe(1);
  });
});
