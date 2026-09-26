import { describe, expect, it } from 'vitest';
import {
  matchesLiquidNitrogenStorage,
  matchesLowTempFreezer,
  needsInstrumentCryoReclassify,
  resolveInstrumentCryoTarget,
} from '@/lib/instrument-cryo-reclassify';

describe('instrument cryo reclassify', () => {
  it('maps liquid nitrogen tanks to 液氮储存', () => {
    const product = {
      catalogNumber: 'YDS-65-216-FS',
      name: '65L 液氮罐（216mm 大口径）',
      category: '仪器设备',
      subcategory: '低温储存设备',
      type: '液氮罐',
    };
    expect(matchesLiquidNitrogenStorage(product)).toBe(true);
    expect(resolveInstrumentCryoTarget(product)).toBe('液氮储存');
    expect(needsInstrumentCryoReclassify(product)).toBe(true);
  });

  it('skips liquid nitrogen labels and cryovials', () => {
    expect(
      matchesLiquidNitrogenStorage({
        catalogNumber: 'P3201',
        name: 'P3201 液氮标签',
        category: '材料合成',
        subcategory: '其他耗材',
        type: null,
      }),
    ).toBe(false);
    expect(
      matchesLiquidNitrogenStorage({
        catalogNumber: 'CV-002-200-EX',
        name: 'CV-002-200-EX 2.0mL可立外旋冻存管',
        category: '材料合成',
        subcategory: '管类与样本储存',
        type: null,
      }),
    ).toBe(false);
  });

  it('maps freezer names to 低温冰箱', () => {
    const product = {
      catalogNumber: 'ULT-86-500',
      name: '-86℃超低温冰箱 500L',
      category: '其他设备',
      subcategory: '其他设备',
      type: null,
    };
    expect(matchesLowTempFreezer(product)).toBe(true);
    expect(resolveInstrumentCryoTarget(product)).toBe('低温冰箱');
    expect(needsInstrumentCryoReclassify(product)).toBe(true);
  });

  it('is idempotent when already classified', () => {
    const product = {
      catalogNumber: 'YDS-2-30S',
      name: '2L 液氮罐（30mm 口径）',
      category: '仪器设备',
      subcategory: '液氮储存',
      type: '液氮罐',
    };
    expect(needsInstrumentCryoReclassify(product)).toBe(false);
  });
});
