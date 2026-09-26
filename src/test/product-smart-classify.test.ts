import { describe, expect, it } from 'vitest';
import { uniqueCanonicalSubcategory } from '@/data/category-aliases';
import {
  applyClassifyFallback,
  buildProductClassifyIndex,
  classifyProduct,
  productNeedsSmartClassify,
  remapExistingPlacement,
} from '@/data/product-smart-classify';

function expectHit(
  name: string,
  category: string,
  subcategory: string,
  extras?: { type?: string | null; brand?: string },
) {
  const result = classifyProduct({ name, brand: extras?.brand });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.category).toBe(category);
  expect(result.subcategory).toBe(subcategory);
  if (extras && 'type' in extras) expect(result.type).toBe(extras.type);
}

describe('product smart classify', () => {
  it('maps secondary HRP antibodies to 二抗 rather than primary catch-alls', () => {
    expectHit('Goat Anti-Rabbit IgG H&L (HRP)', '二抗', 'HRP偶联二抗');
  });

  it('keeps rabbit anti-target antibodies as primary loading controls', () => {
    expectHit('Rabbit Anti-GAPDH Antibody', '一抗', '内参抗体');
  });

  it('splits primary antibodies by application and isotype', () => {
    expectHit('Phospho-AKT (Ser473) Rabbit mAb', '一抗', '磷酸化抗体');
    expectHit('Anti-Human CD3 FITC', '一抗', '流式抗体');
    expectHit('His-Tag Mouse Monoclonal Antibody', '一抗', '标签抗体');
    expectHit('Anti-p53 Mouse Monoclonal Antibody', '一抗', '单抗和重组抗体');
    expectHit('Anti-p53 Rabbit Polyclonal Antibody', '一抗', '重组多抗和传统多抗');
  });

  it('classifies ELISA kits and protein reagents on the canonical tree', () => {
    expectHit('Human IL-6 ELISA Kit', 'ELISA试剂盒', '夹心法ELISA', { type: '细胞因子和趋化因子' });
    expectHit('Mouse Insulin Competitive ELISA Kit', 'ELISA试剂盒', '竞争法ELISA');
    expectHit('Recombinant Human VEGF Protein', '蛋白和细胞系', '重组蛋白');
  });

  it('classifies consumables by catalog L3 names and English aliases', () => {
    expectHit('50mL 离心管 无菌', '材料合成', '管类与样本储存', { type: '离心管' });
    expectHit('15 mL Centrifuge Tube', '材料合成', '管类与样本储存', { type: '离心管' });
    expectHit('丁腈手套 无粉', '材料合成', '个人防护与废弃物', { type: '丁腈手套' });
  });

  it('classifies instruments, cell culture media, and conjugation kits', () => {
    expectHit('65L 液氮罐（216mm 大口径）', '仪器设备', '液氮储存');
    expectHit('DMEM 高糖培养基', '细胞生物学', '细胞培养试剂');
    expectHit('PBS pH7.4', '细胞生物学', '细胞培养试剂');
    expectHit('Alexa Fluor 488 Antibody Labeling Kit', '抗体偶联试剂盒', 'Alexa Fluor偶联试剂盒');
  });

  it('does not assign 新产品 and leaves weak names unclassified', () => {
    const result = classifyProduct({ name: 'Item 001' });
    expect(result.ok).toBe(false);
  });

  it('remaps legacy material subcategories onto the current tree', () => {
    expect(uniqueCanonicalSubcategory('吸头与移液')).toBe('移液与液体处理');
    const remapped = remapExistingPlacement({
      name: '10µL 吸头',
      category: '材料合成',
      subcategory: '吸头与移液',
    });
    expect(remapped).toMatchObject({
      category: '材料合成',
      subcategory: '移液与液体处理',
      reason: 'alias-remap',
    });
    expect(productNeedsSmartClassify({
      name: '10µL 吸头',
      category: '新产品',
      subcategory: null,
    })).toBe(true);
    expect(productNeedsSmartClassify({
      name: 'Rabbit Anti-GAPDH Antibody',
      category: '一抗',
      subcategory: '内参抗体',
    })).toBe(false);
    expect(remapExistingPlacement({
      name: '微量离心管 1.5 mL',
      category: '材料合成',
      subcategory: '微量离心管/EP 管',
    })).toMatchObject({
      category: '材料合成',
      subcategory: '管类与样本储存',
      type: '微量离心管/EP 管',
      reason: 'alias-l3',
    });
  });

  it('uses catalog examples when names are not covered by precision rules', () => {
    const examples = Array.from({ length: 24 }, (_, index) => ({
      name: `FooBar UniqueWidget ${index + 1}`,
      category: '生化和细胞检测试剂盒',
      subcategory: '代谢检测试剂盒',
    }));
    const index = buildProductClassifyIndex(examples);
    const result = classifyProduct({ name: 'FooBar UniqueWidget 99' }, { index });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.category).toBe('生化和细胞检测试剂盒');
    expect(result.subcategory).toBe('代谢检测试剂盒');
    expect(result.reason).toBe('catalog-example');
  });

  it('uses a fallback category only when classification misses', () => {
    const missed = classifyProduct({ name: 'Item 001' });
    const fallback = applyClassifyFallback(missed, { category: '化学试剂', subcategory: '常规化学试剂' });
    expect(fallback).toMatchObject({
      category: '化学试剂',
      subcategory: '常规化学试剂',
      reason: 'fallback',
    });
    expect(applyClassifyFallback(missed, { category: '新产品' })).toBeNull();
  });

  it('does not let spec, catalog number, or PBS tokens override the product name', () => {
    expectHit('Rabbit Anti-GAPDH Antibody in PBS', '一抗', '内参抗体');
    expectHit('Trypsin Inhibitor Antibody', '一抗', 'WB抗体');
    expectHit('PBS-T Wash Buffer', '样本制备和检测试剂盒', 'WB辅助试剂');
    const withSpec = classifyProduct({
      name: 'Anti-p53 Rabbit Polyclonal Antibody',
      spec: 'PBS',
    });
    expect(withSpec).toMatchObject({ ok: true, category: '一抗', subcategory: '重组多抗和传统多抗' });
    const withCatalog = classifyProduct({
      name: 'Restriction digest enzyme',
      catalogNumber: 'PCR-100',
    });
    expect(withCatalog.ok && withCatalog.category === '分子生物学' && withCatalog.subcategory === 'PCR试剂').toBe(false);
  });

  it('keeps name-based antibody class when the stored subcategory is an unrelated L3 label', () => {
    const result = classifyProduct({
      name: 'Rabbit Anti-GAPDH Antibody',
      category: '一抗',
      subcategory: '离心管',
    });
    expect(result).toMatchObject({ ok: true, category: '一抗', subcategory: '内参抗体' });
  });

  it('classifies chinese secondaries, recombinant polyclonals, and CHIP gene targets', () => {
    expectHit('荧光标记山羊抗兔 IgG', '二抗', '荧光偶联二抗');
    expectHit('Recombinant Rabbit Polyclonal Anti-p53 Antibody', '一抗', '重组多抗和传统多抗');
    expectHit('Anti-CHIP Antibody', '一抗', 'WB抗体');
    expectHit('Histone H3 ChIP-grade Antibody', '一抗', 'ChIP和IP抗体');
  });

  it('does not treat fixatives, balance brushes, or PCR plates as the short-word buckets', () => {
    const fixative = classifyProduct({ name: '4% 多聚甲醛固定液' });
    expect(fixative.ok && fixative.subcategory === '流式实验试剂').toBe(false);
    expectHit('天平刷', '材料合成', '温度、冷却与常用工具', { type: '天平刷' });
    expectHit('显微镜载玻片', '材料合成', '显微镜与成像耗材', { type: '显微镜载玻片' });
    expectHit('96 well PCR plate', '材料合成', '微孔板与反应板', { type: '96 孔 PCR/qPCR 板' });
    expectHit('PCR 八排管', '材料合成', '微孔板与反应板', { type: 'PCR 八排/八连管' });
  });

  it('keeps assay kits and inhibitors out of consumable or small-molecule catch-alls', () => {
    expectHit('cAMP microplate assay kit', '生化和细胞检测试剂盒', '代谢检测试剂盒');
    expectHit('Protease Inhibitor Cocktail', '样本制备和检测试剂盒', '样本制备');
    expectHit('RNase Inhibitor', '分子生物学', '分子生物学试剂');
    const resin = classifyProduct({ name: '多肽合成树脂' });
    expect(resin.ok && resin.subcategory === '多肽和封闭肽').toBe(false);
    const fade = classifyProduct({ name: 'anti-fade mounting medium' });
    expect(fade.ok && fade.category === '一抗').toBe(false);
  });

  it('classifies chinese recombinant proteins, elisa standards, and assay kit names from the catalog', () => {
    expectHit('重组人 TREML2蛋白(C-Fc)', '蛋白和细胞系', '重组蛋白');
    expectHit('重组人源肿瘤坏死因子α', '蛋白和细胞系', '细胞因子');
    expectHit('Human TSH Standard', 'ELISA试剂盒', '抗体对和蛋白标准品');
    expectHit('胱天蛋白酶3检测试剂盒，荧光法', '生化和细胞检测试剂盒', '酶活检测试剂盒');
    expectHit('BCA Protein Assay Kit II', '生化和细胞检测试剂盒', '代谢检测试剂盒');
    expectHit('ECL Substrate Kit (High Sensitivity)', '样本制备和检测试剂盒', 'WB辅助试剂');
    expectHit('Tris-甘氨酸 SDS 上样缓冲液 (2X)', '样本制备和检测试剂盒', 'WB辅助试剂');
  });

  it('keeps amplification kits, tips, bottles, media, and instruments on the catalog tree', () => {
    expectHit('Alexa Fluor 555 Tyramide SuperBoost Kit, goat anti-mouse IgG', '样本制备和检测试剂盒', 'IHC和成像试剂');
    expectHit('Anti-TRAP220/MED1 antibody [EPR24656-87]', '一抗', '单抗和重组抗体');
    expectHit('T-R001-LR-20 20μL袋装吸头,低吸附(适配瑞宁LTS)', '材料合成', '移液与液体处理', { type: '低吸附吸头' });
    expectHit('250ml 棕色 HDPE广口试剂瓶,无菌', '材料合成', '样品瓶与容器', { type: '试剂瓶/滴瓶' });
    expectHit('Penicillin − Streptomycin − Neomycin Solution Stabilized', '细胞生物学', '细胞培养试剂');
    expectHit('感应式涡旋混匀仪', '仪器设备', '实验室常规仪器');
    expectHit('Origami B(DE3) 感受态细胞 - Novagen', '分子生物学', '分子生物学试剂');
    expectHit('TNE缓冲液(10×,pH7.4)', '化学试剂', '常规化学试剂');
    expectHit('Goat Anti-Cow IgG H&L preadsorbed', '二抗', '其它二抗');
    expectHit('Horse IgG F(ab\')2 Peroxidase', '二抗', 'HRP偶联二抗');
    expectHit('Mouse Anti-Human Ig kappa chain - Alexa Fluor 568', '二抗', 'Alexa Fluor偶联二抗');
    expectHit('Tris-甘氨酸转印缓冲液（25X）', '样本制备和检测试剂盒', 'WB辅助试剂');
    expectHit('SuperSignal West Pico PLUS Chemiluminescent Substrate', '样本制备和检测试剂盒', 'WB辅助试剂');
    expectHit('ProLong Gold Antifade Mountant with DAPI', '样本制备和检测试剂盒', 'IHC和成像试剂');
    expectHit('胰蛋白酶-EDTA 溶液', '细胞生物学', '细胞培养试剂');
    expectHit('PT-02-FC 0.2mL平盖薄壁管,磨砂盖', '材料合成', '微孔板与反应板', { type: 'PCR 平盖薄壁管' });
  });
});
