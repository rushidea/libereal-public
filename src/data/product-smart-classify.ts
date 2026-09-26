import { uniqueCanonicalSubcategory } from '@/data/category-aliases';
import { productCategories, type Category } from '@/data/categories';

export const UNCATEGORIZED_CATEGORY = '新产品';

export type ProductClassifyInput = {
  name: string;
  brand?: string | null;
  catalogNumber?: string;
  spec?: string | null;
  category?: string | null;
  subcategory?: string | null;
  type?: string | null;
};

export type ProductClassifyPlacement = {
  category: string;
  subcategory: string;
  type: string | null;
};

export type ProductClassifyHit = ProductClassifyPlacement & {
  confidence: number;
  reason: string;
};

export type ProductClassifyResult =
  | (ProductClassifyHit & { ok: true })
  | { ok: false; confidence: number; reason: string };

export type ProductClassifyExample = {
  name: string;
  brand?: string | null;
  category: string | null;
  subcategory: string | null;
  type?: string | null;
};

export type ProductClassifyIndex = {
  buckets: Map<string, Map<string, number>>;
  size: number;
};

export const DEFAULT_CLASSIFY_MIN_CONFIDENCE = 0.58;

const GENERIC_LABELS = new Set([
  '其他', '其它', '其他检测试剂盒', '其它化合物', '其它二抗', '其他设备', '配件', '其他试剂',
]);

const LABEL_ALIASES: Record<string, string[]> = {
  离心管: ['centrifuge tube', 'conical tube'],
  '微量离心管/EP 管': ['microcentrifuge tube', 'eppendorf tube'],
  移液器吸头: ['pipette tip', 'pipet tip'],
  滤芯吸头: ['filter tip'],
  无菌吸头: ['sterile pipette tip'],
  丁腈手套: ['nitrile glove'],
  乳胶手套: ['latex glove'],
  细胞培养板: ['cell culture plate', 'tissue culture plate'],
  细胞培养皿: ['cell culture dish', 'petri dish'],
  细胞培养瓶: ['cell culture flask'],
  酶标板: ['elisa plate'],
  'PCR 八排/八连管': ['pcr八排管', 'pcr八连管', 'pcr strip', '8-strip pcr', 'eight strip pcr'],
  '96 孔 PCR/qPCR 板': ['pcr plate', 'qpcr plate', '96 well pcr plate', '96-well pcr plate'],
  'PVDF 膜': ['pvdf membrane'],
};

const TOKEN_STOPWORDS = new Set([
  'antibody', 'antibodies', 'anti', 'primary', 'clone', 'recombinant', 'protein',
  'peptide', 'kit', 'assay', 'buffer', 'solution', 'reagent', 'sample',
  'human', 'mouse', 'rat', 'rabbit', 'goat', 'the', 'and', 'for', 'with', 'from',
  'ul', 'ml', 'mg', 'ug', 'nm', 'mm', 'pbs', 'dmem', 'edta', 'rna', 'dna',
  '抗体', '试剂', '试剂盒', '蛋白', '检测', '样品', '规格',
]);

const ANTI_PREFIX_EXCLUSIONS = /anti[-\s]?(?:fade|foam|static|seize|freeze|bacterial|fungal|viral)/i;

type PrecisionRule = (text: string, input: ProductClassifyInput) => ProductClassifyHit | null;

type TaxonomyMatcher = {
  category: string;
  subcategory: string;
  type: string | null;
  label: string;
  needle: string;
};

let taxonomyCache: {
  tree: Category[];
  matchers: TaxonomyMatcher[];
  l1: Map<string, Set<string>>;
  l2Children: Map<string, Set<string>>;
  l3ByName: Map<string, ProductClassifyPlacement[]>;
} | null = null;

function compact(value: string): string {
  return value.toLocaleLowerCase().replace(/[\s_\-./（）()（）·•]/g, '');
}

function haystackOf(input: ProductClassifyInput): string {
  return input.name?.trim() || '';
}

function bucketKey(placement: ProductClassifyPlacement): string {
  return `${placement.category}\t${placement.subcategory}\t${placement.type ?? ''}`;
}

function parseBucketKey(key: string): ProductClassifyPlacement {
  const [category, subcategory, type] = key.split('\t');
  return { category, subcategory, type: type || null };
}

function hit(
  category: string,
  subcategory: string,
  reason: string,
  confidence: number,
  type: string | null = null,
): ProductClassifyHit {
  return { category, subcategory, type, confidence, reason };
}

function looksLikeAntibody(text: string): boolean {
  if (ANTI_PREFIX_EXCLUSIONS.test(text)) return false;
  return /antibody|antibodies|mab\b|pab\b|抗体|一抗|二抗|单抗|多抗|\bcd\d+/i.test(text);
}

function labelSupportedByName(name: string, label: string): boolean {
  const compactedName = compact(name);
  const full = compact(label);
  if (full.length >= 2 && compactedName.includes(full)) return true;
  const head = compact(label.split(/[/\s]/)[0] || '');
  return head.length >= 3 && compactedName.includes(head);
}

function aliasSupportedByName(input: ProductClassifyInput, aliasHit: ProductClassifyHit): boolean {
  if (aliasHit.reason === 'alias-remap') return true;
  if (aliasHit.reason !== 'alias-l3') return true;
  const name = input.name || '';
  if (aliasHit.type && labelSupportedByName(name, aliasHit.type)) return true;
  if (input.subcategory && labelSupportedByName(name, input.subcategory)) return true;
  return false;
}

function candidateRank(reason: string): number {
  if (reason === 'instrument-general') return 0;
  if (reason === 'catalog-example') return 1;
  if (reason === 'alias-l3') return 2;
  if (reason === 'taxonomy-l2') return 3;
  if (reason === 'taxonomy-l3') return 4;
  if (reason === 'ab-primary-generic') return 4;
  return 5;
}

export function taxonomyIndex(tree: Category[] = productCategories) {
  if (taxonomyCache?.tree === tree) return taxonomyCache;
  const matchers: TaxonomyMatcher[] = [];
  const l1 = new Map<string, Set<string>>();
  const l2Children = new Map<string, Set<string>>();
  const l3ByName = new Map<string, ProductClassifyPlacement[]>();

  for (const category of tree) {
    if (category.name === UNCATEGORIZED_CATEGORY) continue;
    const subs = new Set(category.sub.map((item) => item.name));
    l1.set(category.name, subs);
    for (const sub of category.sub) {
      const children = new Set(sub.child ?? []);
      l2Children.set(`${category.name}\t${sub.name}`, children);
      if (!GENERIC_LABELS.has(sub.name) && sub.name.length >= 2) {
        matchers.push({
          category: category.name,
          subcategory: sub.name,
          type: null,
          label: sub.name,
          needle: compact(sub.name),
        });
      }
      for (const child of sub.child ?? []) {
        if (GENERIC_LABELS.has(child) || child.length < 2) continue;
        const placements = l3ByName.get(child) ?? [];
        placements.push({ category: category.name, subcategory: sub.name, type: child });
        l3ByName.set(child, placements);
        const labels = [child, ...(LABEL_ALIASES[child] ?? [])];
        for (const label of labels) {
          matchers.push({
            category: category.name,
            subcategory: sub.name,
            type: child,
            label,
            needle: compact(label),
          });
        }
      }
    }
  }

  matchers.sort((left, right) => right.needle.length - left.needle.length || right.label.length - left.label.length);
  taxonomyCache = { tree, matchers, l1, l2Children, l3ByName };
  return taxonomyCache;
}

export function isCanonicalPlacement(placement: {
  category?: string | null;
  subcategory?: string | null;
  type?: string | null;
}): boolean {
  const category = placement.category?.trim() || '';
  if (!category || category === UNCATEGORIZED_CATEGORY) return false;
  const index = taxonomyIndex();
  const subs = index.l1.get(category);
  if (!subs) return false;
  const subcategory = placement.subcategory?.trim() || '';
  if (!subcategory) return subs.size === 0;
  if (!subs.has(subcategory)) {
    const mapped = uniqueCanonicalSubcategory(subcategory);
    if (!mapped || !subs.has(mapped)) return false;
  }
  const resolvedSub = subs.has(subcategory) ? subcategory : uniqueCanonicalSubcategory(subcategory);
  if (!resolvedSub) return false;
  const type = placement.type?.trim() || '';
  if (!type) return true;
  const children = index.l2Children.get(`${category}\t${resolvedSub}`);
  if (!children || children.size === 0) return true;
  return children.has(type);
}

export function remapExistingPlacement(input: ProductClassifyInput): ProductClassifyHit | null {
  const category = input.category?.trim() || '';
  const subcategory = input.subcategory?.trim() || '';
  if (!subcategory) return null;
  const index = taxonomyIndex();

  const l3Hits = index.l3ByName.get(subcategory) ?? [];
  const scopedL3 = category ? l3Hits.filter((item) => item.category === category) : l3Hits;
  const uniqueL3 = scopedL3.length === 1 ? scopedL3[0] : (l3Hits.length === 1 ? l3Hits[0] : null);
  if (uniqueL3 && (uniqueL3.subcategory !== subcategory || uniqueL3.category !== category || (input.type || null) !== uniqueL3.type)) {
    return hit(uniqueL3.category, uniqueL3.subcategory, 'alias-l3', 0.86, uniqueL3.type);
  }

  if (!category || category === UNCATEGORIZED_CATEGORY) return null;
  if (!index.l1.has(category)) return null;
  if (index.l1.get(category)?.has(subcategory)) return null;
  const mapped = uniqueCanonicalSubcategory(subcategory);
  if (!mapped || !index.l1.get(category)?.has(mapped)) return null;
  const children = index.l2Children.get(`${category}\t${mapped}`);
  const type = input.type?.trim() || null;
  const nextType = type && children && children.size > 0 && !children.has(type) ? null : type;
  return hit(category, mapped, 'alias-remap', 0.91, nextType);
}

export function productNeedsSmartClassify(input: ProductClassifyInput): boolean {
  if (remapExistingPlacement(input)) return true;
  return !isCanonicalPlacement(input);
}

function elisaApplicationType(text: string): string {
  if (/il[-\s]?\d|interleukin|\btnf\b|\bifn\b|interferon|vegf|chemokine|cxcl|ccl|细胞因子|趋化因子/i.test(text)) {
    return '细胞因子和趋化因子';
  }
  if (/psa\b|cea\b|bnp\b|troponin|肿瘤|心血管|cancer marker/i.test(text)) {
    return '肿瘤和心血管标志物';
  }
  if (/insulin|hormone|thyroid|estradiol|皮质醇|激素|内分泌/i.test(text)) {
    return '激素和内分泌';
  }
  if (/\big[agm]\b|complement|免疫球蛋白|补体/i.test(text)) {
    return '免疫球蛋白和补体';
  }
  return '其他检测试剂盒';
}

function isSecondaryAntibody(text: string): boolean {
  if (/tyramide|superboost|聚合物/i.test(text)) return false;
  if (/isotype/i.test(text)) return false;
  if (/secondary(?:\s+antibody)?|二抗/i.test(text)) return true;
  if (/(?:山羊|绵羊|驴|马|鸡)抗(?:兔|小鼠|大鼠|人|山羊|豚鼠|绵羊)/.test(text)) return true;
  if (/羊抗(?:兔|小鼠|大鼠|人|鼠)/.test(text)) return true;
  if (/抗(?:兔|小鼠|大鼠|人|山羊|鼠)\/?(?:兔|小鼠|鼠)?\s*(?:igg|igm|iga|lgG|lgg)?/i.test(text) && /羊抗|山羊|驴抗|hrp标/i.test(text)) {
    return true;
  }
  if (/抗(?:兔|小鼠|大鼠|人|山羊)\s*(?:igg|igm|iga)/i.test(text)) return true;
  if (/anti[-\s]?(?:rabbit|mouse|rat|human|goat|guinea\s*pig|chicken|donkey|sheep|horse|cow|bovine|pig)\s+(?:igg|igm|iga|ig\s*kappa|ig\s*lambda|kappa chain)\b/i.test(text)) {
    return true;
  }
  if (
    /(?:goat|donkey|sheep|chicken|horse)\s+anti[-\s]?(?:rabbit|mouse|rat|human|goat|cow|bovine|sheep|pig|horse|guinea)/i.test(text)
    && /igg|igm|iga|h\s*&\s*l|h\s*\+\s*l|antibody|抗体|kappa/i.test(text)
    && !/\bcd\d+/i.test(text)
  ) {
    return true;
  }
  if (/\b(?:horse|goat|donkey|sheep)\s+igg\b/i.test(text) && /peroxidase|hrp|f\(ab|fab/i.test(text)) {
    return true;
  }
  return false;
}

function secondaryHit(text: string): ProductClassifyHit {
  if (/hrp|horseradish|peroxidase|过氧化物酶/i.test(text)) {
    return hit('二抗', 'HRP偶联二抗', 'secondary-hrp', 0.94);
  }
  if (/alexa\s*fluor|atto\s*\d+/i.test(text)) {
    return hit('二抗', 'Alexa Fluor偶联二抗', 'secondary-alexa', 0.94);
  }
  if (/fitc|cy[35]|rhodamine|fluorescein|荧光/i.test(text)) {
    return hit('二抗', '荧光偶联二抗', 'secondary-fluor', 0.92);
  }
  return hit('二抗', '其它二抗', 'secondary-other', 0.9);
}

function isChipApplication(text: string): boolean {
  return /chromatin immunoprecipitation|(?:for\s+)chip\b|chip[-\s]?(?:grade|kit|reagent|assay)|chipab|chip经验证|chip级|免疫沉淀|co[-\s]?ip/i.test(text);
}

const PRECISION_RULES: PrecisionRule[] = [
  (text) => {
    if (/液氮罐|液氮生物容器|液氮储存罐|液氮杜瓦/i.test(text) && !/液氮标签|冻存管/i.test(text)) {
      return hit('仪器设备', '液氮储存', 'instrument-ln2', 0.95);
    }
    if (/低温冰箱|超低温冰箱|超低温保存箱|医用冰箱|血液冷藏箱|药品冷藏箱|ult\s*freezer|-86\s*℃?\s*冰箱|-80\s*℃?\s*冰箱/i.test(text)) {
      return hit('仪器设备', '低温冰箱', 'instrument-freezer', 0.95);
    }
    if (/离心机|pcr\s*仪|荧光定量pcr仪|显微镜|天平|水浴锅|酶标仪|电泳仪|涡旋|混匀仪|振荡器/i.test(text)) {
      if (/离心管|冻存管|天平刷|载玻片|盖玻片|血球计数板/.test(text)) return null;
      if (/显微镜/.test(text) && /载玻|盖玻|玻片/.test(text)) return null;
      if (/天平/.test(text) && /刷/.test(text)) return null;
      return hit('仪器设备', '实验室常规仪器', 'instrument-general', 0.82);
    }
    return null;
  },
  (text) => {
    if (/吸头/.test(text) && /低吸附/.test(text)) {
      return hit('材料合成', '移液与液体处理', 'tip-low-retention', 0.88, '低吸附吸头');
    }
    if (/试剂瓶/.test(text)) {
      return hit('材料合成', '样品瓶与容器', 'reagent-bottle', 0.84, '试剂瓶/滴瓶');
    }
    if (/pcr\s*板|pcr板/i.test(text)) {
      return hit('材料合成', '微孔板与反应板', 'pcr-plate', 0.86, '96 孔 PCR/qPCR 板');
    }
    if (/平盖薄壁管/.test(text)) {
      return hit('材料合成', '微孔板与反应板', 'pcr-tube', 0.86, 'PCR 平盖薄壁管');
    }
    if (/针头式滤器|针头过滤器/.test(text)) {
      return hit('材料合成', '过滤与分离耗材', 'syringe-filter', 0.86, '针头过滤器');
    }
    if (/滤纸/.test(text)) {
      return hit('材料合成', '过滤与分离耗材', 'filter-paper', 0.82, '滤膜/滤器');
    }
    if (/侵袭小室/.test(text)) {
      return hit('材料合成', '细胞培养器皿', 'invasion-chamber', 0.86, '细胞培养小室');
    }
    return null;
  },
  (text) => {
    if (!/偶联试剂盒|conjugation\s*kit|labeling\s*kit|antibody\s+labeling/i.test(text)) return null;
    if (/alexa\s*fluor/i.test(text)) return hit('抗体偶联试剂盒', 'Alexa Fluor偶联试剂盒', 'conjugation-alexa', 0.93);
    if (/hrp|alkaline\s*phosphatase|ap\s*(?:conjugat|偶联)/i.test(text)) {
      return hit('抗体偶联试剂盒', 'HRP和AP偶联试剂盒', 'conjugation-hrp', 0.93);
    }
    if (/biotin|生物素/i.test(text)) return hit('抗体偶联试剂盒', 'Biotin偶联试剂盒', 'conjugation-biotin', 0.93);
    if (/fitc|cy[35]|fluorescein|荧光/i.test(text)) return hit('抗体偶联试剂盒', '荧光偶联试剂盒', 'conjugation-fluor', 0.9);
    return hit('抗体偶联试剂盒', '荧光偶联试剂盒', 'conjugation-kit', 0.84);
  },
  (text) => {
    const isElisa = /elisa|酶联免疫|酶标检测/i.test(text);
    const isKit = /kit|试剂盒|assay/i.test(text);
    if (!isElisa) {
      if (/tmb|stop\s*solution/i.test(text) && !looksLikeAntibody(text)) {
        return hit('ELISA试剂盒', 'ELISA辅助试剂', 'elisa-tmb', 0.84);
      }
      if (
        /\bstandard\b/i.test(text)
        && /(human|mouse|rat|人|小鼠|大鼠)/i.test(text)
        && !looksLikeAntibody(text)
        && !/nitrite|sulfate|chloride|solution\s*$/i.test(text)
      ) {
        return hit('ELISA试剂盒', '抗体对和蛋白标准品', 'elisa-standard-name', 0.84, elisaApplicationType(text));
      }
      return null;
    }
    if (isChipApplication(text) && /kit|reagent|assay/i.test(text)) return null;
    if (/competitive|竞争法/i.test(text)) {
      return hit('ELISA试剂盒', '竞争法ELISA', 'elisa-competitive', 0.92, elisaApplicationType(text));
    }
    if (/array|芯片/i.test(text)) {
      return hit('ELISA试剂盒', '抗体芯片', 'elisa-array', 0.9, elisaApplicationType(text));
    }
    if (/\bstandard(?:\s+set)?\b|蛋白标准品|抗体对/i.test(text) && !/elisa\s*kit/i.test(text)) {
      return hit('ELISA试剂盒', '抗体对和蛋白标准品', 'elisa-standard', 0.88, elisaApplicationType(text));
    }
    if (/tmb|substrate|stop\s*solution|wash\s*buffer|洗涤液|封闭缓冲液|酶标板拍板/i.test(text) && !/elisa\s*kit/i.test(text)) {
      return hit('ELISA试剂盒', 'ELISA辅助试剂', 'elisa-accessory', 0.9);
    }
    if (isKit) {
      return hit('ELISA试剂盒', '夹心法ELISA', 'elisa-sandwich', 0.9, elisaApplicationType(text));
    }
    return hit('ELISA试剂盒', 'ELISA辅助试剂', 'elisa-plain', 0.72);
  },
  (text) => {
    if (isChipApplication(text) && /kit|reagent|assay|试剂/i.test(text) && !looksLikeAntibody(text)) {
      return hit('样本制备和检测试剂盒', 'ChIP和IP试剂', 'chip-reagent', 0.9);
    }
    if (/\bwb\b|western\s*blot|pbs[-\s]?t\b|ecls?\s*substrate|上样缓冲液|sds.{0,12}缓冲|tris[-\s]?甘氨酸|nativemark|protein\s*(?:standard|ladder)|supersignal|化学发光|电泳液|转印缓冲|running\s*buffer/i.test(text)
      && /buffer|substrate|ecls?|转膜|转印|电泳|wash|上样|standard|ladder|kit|试剂|底物/i.test(text)
    ) {
      return hit('样本制备和检测试剂盒', 'WB辅助试剂', 'wb-reagent', 0.86);
    }
    if (/tyramide|superboost|hrex|聚合物/i.test(text) && /kit|reagent|试剂|标/i.test(text) && !/chipab/i.test(text)) {
      return hit('样本制备和检测试剂盒', 'IHC和成像试剂', 'ihc-amplify', 0.88);
    }
    if (/prolong|slowfade|mountant|抗淬灭|封片/i.test(text) && !looksLikeAntibody(text)) {
      return hit('样本制备和检测试剂盒', 'IHC和成像试剂', 'ihc-mount', 0.86);
    }
    if (/ihc\s*(kit|reagent)|immunohistochem.*reagent|antigen\s*retrieval|免疫组化试剂|抗原修复|封片剂/i.test(text) && !looksLikeAntibody(text)) {
      return hit('样本制备和检测试剂盒', 'IHC和成像试剂', 'ihc-reagent', 0.86);
    }
    if (
      (/flow\s*cytometry\s*(buffer|kit)|流式.*(缓冲|破膜|固定)|破膜剂/i.test(text) || (/固定液/i.test(text) && /流式|flow/i.test(text)))
      && !looksLikeAntibody(text)
      && !/多聚甲醛|福尔马林|组织固定|病理固定/i.test(text)
    ) {
      return hit('样本制备和检测试剂盒', '流式实验试剂', 'flow-reagent', 0.84);
    }
    if (/protease\s*inhibitor|蛋白酶抑制剂/i.test(text) && !looksLikeAntibody(text)) {
      return hit('样本制备和检测试剂盒', '样本制备', 'sample-protease', 0.86);
    }
    return null;
  },
  (text) => {
    if (/annexin\s*v/i.test(text) && /conjugate|conjugat|kit|试剂盒|pe\b|apc|fitc|alexa/i.test(text) && !/antibody|抗体/i.test(text)) {
      return hit('生化和细胞检测试剂盒', '细胞健康检测试剂盒', 'assay-annexin', 0.86);
    }
    if (!/kit|试剂盒|assay/i.test(text)) return null;
    if (/elisa/i.test(text) || looksLikeAntibody(text)) return null;
    if (/mtt|cck[-\s]?8|viability|cytotoxicity|细胞凋亡检测|annexin\s*v|xtt|衰老细胞/i.test(text)) {
      return hit('生化和细胞检测试剂盒', '细胞健康检测试剂盒', 'assay-viability', 0.9);
    }
    if (/activity\s*assay|酶活|phosphatase\s*assay|kinase\s*assay|胱天蛋白酶|caspase|过氧化氢酶|catalase|碱性磷酸酶/i.test(text)) {
      return hit('生化和细胞检测试剂盒', '酶活检测试剂盒', 'assay-enzyme', 0.88);
    }
    if (/glucose|atp\b|nadh?|\bcamp\b|cholesterol|代谢检测|lactate|\bbca\b|蛋白定量|fluo[-\s]?8|calcium\s*assay/i.test(text)) {
      return hit('生化和细胞检测试剂盒', '代谢检测试剂盒', 'assay-metabolic', 0.86);
    }
    return null;
  },
  (text) => {
    if (/限制性内切酶|restriction\s*enzyme|\bnoti\b|\becor[iv]\b/i.test(text)) {
      return hit('分子生物学', '限制性内切酶', 'molbio-re', 0.9);
    }
    if (/reverse\s*transcript|反转录|rt[-\s]?pcr\s*(mix|kit|enzyme)/i.test(text)) {
      return hit('分子生物学', '反转录试剂', 'molbio-rt', 0.9);
    }
    if (
      /\bpcr\b|q\s*pcr|荧光定量|聚合酶|polymerase\s*mix/i.test(text)
      && !/pcr\s*(板|管|八排|八连|plate|tube|strip)|封板膜|eight[-\s]?strip/i.test(text)
    ) {
      return hit('分子生物学', 'PCR试剂', 'molbio-pcr', 0.88);
    }
    if (/dna\s*(ladder|marker)|分子量标准|核酸标准/i.test(text)) {
      return hit('分子生物学', 'DNA分子量标准', 'molbio-marker', 0.9);
    }
    if (/核酸纯化|plasmid\s*mini|rna\s*isolation|胶回收|rna\s*纯化|(?:rnase|rna).*(?:去污|纯化|增强)/i.test(text)) {
      return hit('分子生物学', '核酸纯化', 'molbio-purify', 0.86);
    }
    if (/\bedta\b.*ph|ph.*\bedta\b|tris[-\s]?hcl|tae\b|tbe\b/i.test(text)) {
      return hit('分子生物学', '分子生物学试剂', 'molbio-buffer', 0.82);
    }
    if (/感受态细胞|competent\s*cell/i.test(text)) {
      return hit('分子生物学', '分子生物学试剂', 'molbio-competent', 0.86);
    }
    if (/rnase\s*inhibitor|核酸酶抑制剂/i.test(text) && !looksLikeAntibody(text)) {
      return hit('分子生物学', '分子生物学试剂', 'molbio-rnase-inhibitor', 0.86);
    }
    if (/核糖核酸|nucleic\s*acid/i.test(text) && !looksLikeAntibody(text) && !/纯化|isolation/i.test(text)) {
      return hit('分子生物学', '分子生物学试剂', 'molbio-na', 0.8);
    }
    if (
      /\binhibitor\b|抑制剂/i.test(text)
      && !looksLikeAntibody(text)
      && !/elisa/i.test(text)
      && !/protease|蛋白酶|rnase|核酸酶/i.test(text)
    ) {
      return hit('分子生物学', '小分子化合物', 'molbio-inhibitor', 0.8, '抑制剂');
    }
    return null;
  },
  (text) => {
    if (/cell\s*line|细胞系|hybridoma/i.test(text) && !looksLikeAntibody(text) && !/elisa/i.test(text)) {
      return hit('蛋白和细胞系', '细胞系', 'protein-cell-line', 0.88);
    }
    if (/lysate|裂解液/i.test(text) && !/buffer\s*kit/i.test(text) && !looksLikeAntibody(text)) {
      return hit('蛋白和细胞系', '裂解液', 'protein-lysate', 0.86);
    }
    if (/blocking\s*peptide|封闭肽|多肽/i.test(text) && !/elisa|树脂|合成/i.test(text)) {
      return hit('蛋白和细胞系', '多肽和封闭肽', 'protein-peptide', 0.84);
    }
    if (/cytokine|生长因子|growth\s*factor|肿瘤坏死因子|干扰素|白介素/i.test(text) && !looksLikeAntibody(text) && !/elisa/i.test(text)) {
      return hit('蛋白和细胞系', '细胞因子', 'protein-cytokine', 0.86);
    }
    if (
      (
        /重组蛋白|bioactive\s+protein|生物活性蛋白/i.test(text)
        || (/recombinant/i.test(text) && /\bproteins?\b/i.test(text))
        || /重组.{0,24}蛋白/.test(text)
        || /牛血清白蛋白|\bbsa\b|albumin/i.test(text)
      )
      && !looksLikeAntibody(text)
      && !/elisa/i.test(text)
    ) {
      const bioactive = /bioactive|生物活性/i.test(text);
      return hit('蛋白和细胞系', bioactive ? '生物活性蛋白' : '重组蛋白', bioactive ? 'protein-bioactive' : 'protein-recombinant', 0.9);
    }
    return null;
  },
  (text) => {
    if (!isSecondaryAntibody(text)) return null;
    return secondaryHit(text);
  },
  (text) => {
    if (ANTI_PREFIX_EXCLUSIONS.test(text)) return null;
    if (!/antibody|antibodies|mab\b|pab\b|抗体|一抗|单抗|多抗|\bcd\d+/i.test(text)) return null;
    if (/isotype\s*control|同型对照/i.test(text)) {
      return hit('一抗', '同型对照抗体', 'ab-isotype', 0.92);
    }
    if (/carrier[-\s]?free|bsa[-\s]?free|无载体|无蛋白/i.test(text)) {
      return hit('一抗', '无载体抗体', 'ab-carrier-free', 0.9);
    }
    if (/panel|sampler\s*kit|抗体组合|套装/i.test(text)) {
      return hit('一抗', '抗体组合套装', 'ab-panel', 0.88);
    }
    if (/phospho|phosphorylat|磷酸化/i.test(text)) {
      return hit('一抗', '磷酸化抗体', 'ab-phospho', 0.92);
    }
    if (isChipApplication(text)) {
      return hit('一抗', 'ChIP和IP抗体', 'ab-chip', 0.88);
    }
    if (/\bihc\b|immunohistochem|immunofluorescence|免疫组化|免疫荧光/i.test(text)) {
      return hit('一抗', 'IHC和成像抗体', 'ab-ihc', 0.88);
    }
    if (/his[-\s]?tag|gst[-\s]?tag|flag[-\s]?tag|ha[-\s]?tag|myc[-\s]?tag|v5[-\s]?tag|\bgfp\b|标签抗体/i.test(text)) {
      return hit('一抗', '标签抗体', 'ab-tag', 0.92);
    }
    if (/gapdh|beta[-\s]?actin|β[-\s]?actin|tubulin|vinculin|loading\s*control|housekeeping|内参/i.test(text)) {
      return hit('一抗', '内参抗体', 'ab-loading', 0.92);
    }
    if (/apoptosis|annexin|caspase|细胞凋亡/i.test(text)) {
      return hit('一抗', '细胞凋亡', 'ab-apoptosis', 0.86);
    }
    if (/\bcd\d+|cluster of differentiation|流式抗体/i.test(text)) {
      return hit('一抗', '流式抗体', 'ab-flow', 0.9);
    }
    if (/alexa\s*fluor|fitc|apc\b|pe[-\s]?cy|percp|直标/i.test(text)) {
      return hit('一抗', '直标抗体', 'ab-conjugated', 0.86);
    }
    if (/\bpab\b|polyclonal|多克隆|多抗|ascites/i.test(text)) {
      return hit('一抗', '重组多抗和传统多抗', 'ab-poly', 0.82);
    }
    if (/\bmab\b|monoclonal|单克隆|重组抗体|\[epr\d/i.test(text) || (/recombinant/i.test(text) && /antibody|抗体/i.test(text))) {
      return hit('一抗', '单抗和重组抗体', 'ab-mono', 0.82);
    }
    return hit('一抗', 'WB抗体', 'ab-primary-generic', 0.62);
  },
  (text) => {
    if (looksLikeAntibody(text)) return null;
    if (/pbs[-\s]?t\b|wash\s*buffer|tween|western/i.test(text)) return null;
    if (/\bdmem\b|\brpmi\b|\bmem\b|\bimdm\b|opti[-\s]?mem|nctc|胎牛血清|\bfbs\b|fetal\s*bovine|胰酶|胰蛋白酶|trypsin|双抗.*青霉素|青霉素|链霉素|penicillin|streptomycin|细胞培养基|培养基|平衡盐|\bpbs\b|\bdpbs\b|\bhbss\b|冻存液|cryopreserv|台盼蓝|trypan\s*blue|潮霉素|嘌呤霉素|杀稻瘟菌素|hygromycin|puromycin|blasticidin|\bg418\b/i.test(text)) {
      return hit('细胞生物学', '细胞培养试剂', 'cell-culture', 0.9);
    }
    return null;
  },
  (text) => {
    if (/分析纯|优级纯|化学纯|acs\s*reagent|色谱纯/i.test(text)) {
      return hit('化学试剂', '常规化学试剂', 'chemical-grade', 0.84);
    }
    if (/缓冲液/.test(text) && !looksLikeAntibody(text) && !/elisa|上样|裂解/i.test(text)) {
      return hit('化学试剂', '常规化学试剂', 'chemical-buffer', 0.72);
    }
    if (/标准品|reference\s*standard/i.test(text) && !/elisa|antibody|抗体|蛋白标准/i.test(text)) {
      return hit('化学试剂', '标准品', 'chemical-standard', 0.8);
    }
    return null;
  },
];

function matchTaxonomyLabels(text: string): ProductClassifyHit | null {
  const compacted = compact(text);
  if (compacted.length < 2) return null;
  const matchers = taxonomyIndex().matchers;
  for (const matcher of matchers) {
    if (matcher.needle.length < 2) continue;
    if (matcher.needle.length <= 3 && matcher.type && !text.includes(matcher.label)) continue;
    if (matcher.label === '试管' && /测试管/.test(text)) continue;
    if (compacted.includes(matcher.needle)) {
      const confidence = matcher.type
        ? Math.min(0.93, 0.7 + matcher.needle.length * 0.02)
        : Math.min(0.88, 0.64 + matcher.needle.length * 0.015);
      return hit(matcher.category, matcher.subcategory, matcher.type ? 'taxonomy-l3' : 'taxonomy-l2', confidence, matcher.type);
    }
  }
  return null;
}

function tokenize(text: string): string[] {
  const prepared = text.toLocaleLowerCase().replace(/([a-z])-(\d)/g, '$1$2');
  const tokens = new Set<string>();
  for (const part of prepared.split(/[^a-z0-9\u4e00-\u9fff]+/)) {
    if (!part || TOKEN_STOPWORDS.has(part)) continue;
    if (/[a-z]/.test(part) && part.length >= 4) tokens.add(part);
    if (/\d/.test(part) && part.length >= 2 && /[a-z]/.test(part)) tokens.add(part);
    if (/[\u4e00-\u9fff]/.test(part)) {
      if (part.length >= 2 && part.length <= 12 && !TOKEN_STOPWORDS.has(part)) tokens.add(part);
      if (part.length >= 4) {
        for (let index = 0; index < part.length - 1; index += 1) {
          const gram = part.slice(index, index + 2);
          if (!TOKEN_STOPWORDS.has(gram)) tokens.add(gram);
        }
      }
    }
  }
  return [...tokens];
}

export function buildProductClassifyIndex(examples: ProductClassifyExample[]): ProductClassifyIndex {
  const buckets = new Map<string, Map<string, number>>();
  let size = 0;
  for (const example of examples) {
    const remapped = remapExistingPlacement(example) ?? (
      isCanonicalPlacement(example)
        ? {
            category: example.category as string,
            subcategory: example.subcategory as string,
            type: example.type ?? null,
            confidence: 1,
            reason: 'canonical',
          }
        : null
    );
    if (!remapped) continue;
    const key = bucketKey(remapped);
    let counts = buckets.get(key);
    if (!counts) {
      counts = new Map();
      buckets.set(key, counts);
    }
    for (const token of tokenize(example.name)) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
    size += 1;
  }
  return { buckets, size };
}

function classifyByExamples(text: string, index: ProductClassifyIndex | undefined): ProductClassifyHit | null {
  if (!index || index.size < 20 || index.buckets.size === 0) return null;
  const tokens = tokenize(text);
  if (tokens.length === 0) return null;

  const global = new Map<string, number>();
  for (const counts of index.buckets.values()) {
    for (const [token, count] of counts) {
      global.set(token, (global.get(token) ?? 0) + count);
    }
  }

  let best: { key: string; score: number } | null = null;
  let second = 0;
  for (const [key, counts] of index.buckets) {
    let score = 0;
    for (const token of tokens) {
      const inBucket = counts.get(token) ?? 0;
      if (inBucket < 2) continue;
      const everywhere = global.get(token) ?? 0;
      if (everywhere <= 0) continue;
      const share = inBucket / everywhere;
      if (share < 0.35) continue;
      score += share * Math.log(1 + inBucket);
    }
    if (!best || score > best.score) {
      second = best?.score ?? 0;
      best = { key, score };
    } else if (score > second) {
      second = score;
    }
  }
  if (!best || best.score < 1.6) return null;
  if (best.score < second * 1.35 && second > 0) return null;
  const placement = parseBucketKey(best.key);
  const confidence = Math.min(0.72, 0.56 + Math.min(best.score, 4) * 0.03);
  return { ...placement, confidence, reason: 'catalog-example' };
}

export function classifyProduct(
  input: ProductClassifyInput,
  options?: { index?: ProductClassifyIndex; minConfidence?: number },
): ProductClassifyResult {
  const minConfidence = options?.minConfidence ?? DEFAULT_CLASSIFY_MIN_CONFIDENCE;
  const aliasHit = remapExistingPlacement(input);
  const text = haystackOf(input);

  const candidates: ProductClassifyHit[] = [];
  for (const rule of PRECISION_RULES) {
    const matched = rule(text, input);
    if (matched) {
      candidates.push(matched);
      break;
    }
  }
  const taxonomyHit = matchTaxonomyLabels(text);
  if (taxonomyHit) candidates.push(taxonomyHit);
  const exampleHit = classifyByExamples(text, options?.index);
  if (exampleHit) candidates.push(exampleHit);
  if (aliasHit && aliasSupportedByName(input, aliasHit)) {
    const nameHit = candidates[0];
    const aliasConflicts = Boolean(
      nameHit
      && aliasHit.reason === 'alias-l3'
      && nameHit.category !== aliasHit.category
      && nameHit.confidence >= 0.8,
    );
    if (!aliasConflicts) candidates.push(aliasHit);
  }

  candidates.sort((left, right) => {
    if (right.confidence !== left.confidence) return right.confidence - left.confidence;
    return candidateRank(right.reason) - candidateRank(left.reason);
  });
  const best = candidates[0];
  if (!best || best.confidence < minConfidence) {
    return { ok: false, confidence: best?.confidence ?? 0, reason: best?.reason ?? 'unclassified' };
  }
  if (best.category === UNCATEGORIZED_CATEGORY) {
    return { ok: false, confidence: best.confidence, reason: 'rejected-uncategorized' };
  }
  return { ok: true, ...best };
}

export function applyClassifyFallback(
  result: ProductClassifyResult,
  fallback?: { category?: string; subcategory?: string },
): ProductClassifyHit | null {
  if (result.ok) return result;
  const category = fallback?.category?.trim() || '';
  if (!category || category === UNCATEGORIZED_CATEGORY) return null;
  const subcategory = fallback?.subcategory?.trim() || '';
  const mapped = subcategory && uniqueCanonicalSubcategory(subcategory);
  const index = taxonomyIndex();
  const resolvedSub = subcategory && index.l1.get(category)?.has(subcategory)
    ? subcategory
    : mapped && index.l1.get(category)?.has(mapped)
      ? mapped
      : subcategory || null;
  return {
    category,
    subcategory: resolvedSub || '',
    type: null,
    confidence: 0.4,
    reason: 'fallback',
  };
}
