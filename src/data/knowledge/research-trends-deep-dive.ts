import { getB01TopicBySlug } from './research-trends-b01';
import { getB02TopicBySlug } from './research-trends-b02';
import { getB03TopicBySlug } from './research-trends-b03';
import { getB04TopicBySlug } from './research-trends-b04';
import { getB05TopicBySlug } from './research-trends-b05';
import { getB06TopicBySlug } from './research-trends-b06';
import { getB07TopicBySlug } from './research-trends-b07';
import { getB08TopicBySlug } from './research-trends-b08';
import { getB09TopicBySlug } from './research-trends-b09';
import { getB10TopicBySlug } from './research-trends-b10';

export const dedicatedResearchTrendSlugs = ['tumor-spatial-immunity'] as const;

const dedicatedResearchTrendSlugSet = new Set<string>(dedicatedResearchTrendSlugs);

export function hasDedicatedResearchTrendRoute(slug: string): boolean {
  return dedicatedResearchTrendSlugSet.has(slug);
}

export function getResearchDeepDiveTopicBySlug(slug: string) {
  const b01 = getB01TopicBySlug(slug);
  if (b01) return { ...b01, batchId: 'B01', batchTitle: '肿瘤生态与克隆演化' } as const;
  const b02 = getB02TopicBySlug(slug);
  if (b02) return { ...b02, batchId: 'B02', batchTitle: '单细胞扰动与谱系解析' } as const;
  const b03 = getB03TopicBySlug(slug);
  if (b03) return { ...b03, batchId: 'B03', batchTitle: '人体相关模型与转化评价' } as const;
  const b04 = getB04TopicBySlug(slug);
  if (b04) return { ...b04, batchId: 'B04', batchTitle: '微生物组、代谢与慢性炎症' } as const;
  const b05 = getB05TopicBySlug(slug);
  if (b05) return { ...b05, batchId: 'B05', batchTitle: '肿瘤治疗分层与循环监测' } as const;
  const b06 = getB06TopicBySlug(slug);
  if (b06) return { ...b06, batchId: 'B06', batchTitle: '结构、分子设计与候选验证' } as const;
  const b07 = getB07TopicBySlug(slug);
  if (b07) return { ...b07, batchId: 'B07', batchTitle: '计算与组学测量' } as const;
  const b08 = getB08TopicBySlug(slug);
  if (b08) return { ...b08, batchId: 'B08', batchTitle: '衰老、细胞应激与神经图谱' } as const;
  const b09 = getB09TopicBySlug(slug);
  if (b09) return { ...b09, batchId: 'B09', batchTitle: '感染监测、疫苗与核酸递送' } as const;
  const b10 = getB10TopicBySlug(slug);
  if (b10) return { ...b10, batchId: 'B10', batchTitle: '神经技术、分子诊断与数字临床证据' } as const;
  return null;
}
