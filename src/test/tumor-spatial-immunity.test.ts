import { describe, expect, it } from 'vitest';
import {
  tumorSpatialImmunitySnapshot,
} from '@/data/knowledge/tumor-spatial-immunity';
import { findForbiddenKnowledgeFields } from '@/lib/knowledge-staging';

describe('H022 tumor spatial immunity public snapshot', () => {
  it('publishes the approved cross-cancer spatial themes', () => {
    expect(tumorSpatialImmunitySnapshot.hotspotId).toBe('H022');
    expect(tumorSpatialImmunitySnapshot.spatialThemes).toHaveLength(5);
    expect(tumorSpatialImmunitySnapshot.spatialThemes.map((theme) => theme.title)).toEqual([
      '肿瘤实质区、侵袭边缘与邻近基质',
      '三级淋巴结构：肿瘤局部形成的免疫组织',
      '血管周围区域：免疫细胞进入肿瘤的通道',
      '纤维化、低氧与髓系细胞富集区',
      '病灶部位与治疗过程会改变空间免疫状态',
    ]);
    expect(tumorSpatialImmunitySnapshot.spatialMethods).toHaveLength(6);
    expect(tumorSpatialImmunitySnapshot.spatialMethods.map((method) => method.category)).toEqual([
      '空间 RNA 测序',
      '空间 RNA 成像',
      '多重蛋白成像',
      '单细胞与空间数据整合',
      '免疫受体组库分析',
      '功能验证',
    ]);
    for (const method of tumorSpatialImmunitySnapshot.spatialMethods) {
      expect(method.workflow.length).toBeGreaterThan(50);
      expect(method.qualityControl.length).toBeGreaterThan(40);
      expect(method.resultInterpretation.length).toBeGreaterThan(40);
    }
    expect(tumorSpatialImmunitySnapshot.references).toHaveLength(26);
    expect(tumorSpatialImmunitySnapshot.references.map((reference) => reference.title).join(' ')).toMatch(
      /lung adenocarcinoma|brain tumours|melanoma|renal cell cancer|ovarian cancer|urothelial/i,
    );
  });

  it('keeps source references and identifiers internally consistent', () => {
    const references = tumorSpatialImmunitySnapshot.references;
    const referenceIds = references.map((reference) => reference.id);
    const referencedIds = [
      ...tumorSpatialImmunitySnapshot.spatialThemes.flatMap((theme) => theme.sourceIds),
      ...tumorSpatialImmunitySnapshot.spatialMethods.flatMap((method) => method.sourceIds),
    ];

    expect(new Set(referenceIds).size).toBe(referenceIds.length);
    expect(references.map((reference) => reference.number)).toEqual(references.map((_, index) => index + 1));
    expect(new Set(referencedIds)).toEqual(new Set(referenceIds));
    for (const reference of references) {
      expect(reference.url).toBe(`https://doi.org/${reference.doi}`);
    }
  });

  it('contains no public product, transaction or scoring fields', () => {
    expect(findForbiddenKnowledgeFields(tumorSpatialImmunitySnapshot)).toEqual([]);
    expect(JSON.stringify(tumorSpatialImmunitySnapshot)).not.toMatch(/productId|catalogNumber|price|stockQuantity/i);
    expect(JSON.stringify(tumorSpatialImmunitySnapshot)).not.toMatch(/scoreAverage|momentum|evidenceQuality/i);
  });

  it('does not expose internal editorial notes in public copy', () => {
    const publicCopy = JSON.stringify(tumorSpatialImmunitySnapshot);

    expect(tumorSpatialImmunitySnapshot.summary).toContain('三级淋巴结构');
    expect(tumorSpatialImmunitySnapshot.summary).toContain('TLS 成熟度');
    expect(tumorSpatialImmunitySnapshot.summary).toContain('血管周围区域');
    expect(tumorSpatialImmunitySnapshot.scopeNote).toContain('多种癌症');
    expect(tumorSpatialImmunitySnapshot.scopeNote).toContain('共性和差异');
    expect(publicCopy).not.toContain('肿瘤巢');
    expect(publicCopy).not.toContain('仅以结直肠癌');
    expect(publicCopy).toContain('B 细胞受体与 T 细胞受体测序追踪淋巴细胞克隆');
    expect(publicCopy).toContain('B 细胞受体（BCR）和 T 细胞受体（TCR）');
    expect(publicCopy).toContain('体细胞高频突变');
    expect(publicCopy).toContain('成像质谱流式（IMC）');
    expect(publicCopy).not.toMatch(
      /readerValue|帮助读者|帮助研究者|保留疾病语境|分析单位|检测面板应覆盖什么|研究面板|独立人类样本|目前可以确认到哪一步/,
    );
  });
});
