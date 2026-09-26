/* eslint-disable no-console */
/**
 * 给 "材料合成" 下 Labselect + Biosharp 共 3903 条产品按 name 关键词分配
 * subcategory（二级大类）和 type（三级细分）。
 *
 * 关键词规则（顺序匹配：先匹配二级 subcategory，再在子规则里匹配 type）：
 *   - 二级: 移液与液体处理 / 管类与样本储存 / 样品瓶与容器 / 微孔板与反应板
 *           / 细胞培养器皿 / 过滤与分离耗材 / 显微镜与成像耗材 / 个人防护与废弃物等
 *   - 三级: 每类下细分 5-12 个具体类型
 *
 * 用法:
 *   npx tsx scripts/classify-material-synth.ts               # dry-run 摘要
 *   npx tsx scripts/classify-material-synth.ts --apply        # 实际 update
 */
import { prisma } from '../src/lib/prisma';

const APPLY = process.argv.includes('--apply');

type Tier2 = string;
type Tier3 = string;
type Classified = { subcategory: Tier2; type: Tier3 };

const CANONICAL_SUBCATEGORY: Record<string, string> = {
  吸头与移液: '移液与液体处理',
  离心管与冻存: '管类与样本储存',
  容器与试剂瓶: '样品瓶与容器',
  PCR与qPCR耗材: '微孔板与反应板',
  酶标板与微孔板: '微孔板与反应板',
  细胞培养耗材: '细胞培养器皿',
  玻璃试管与管类: '管类与样本储存',
  比色皿与光学耗材: '显微镜与成像耗材',
  过滤耗材: '过滤与分离耗材',
  载玻片与包埋: '显微镜与成像耗材',
  防护手套: '个人防护与废弃物',
  磁力与搅拌: '温度、冷却与常用工具',
  冰盒与冷却: '温度、冷却与常用工具',
  果蝇实验耗材: '专用实验耗材',
  其他耗材: '专用实验耗材',
};

function canonicalizeClassified(result: Classified): Classified {
  return {
    ...result,
    subcategory: CANONICAL_SUBCATEGORY[result.subcategory] ?? result.subcategory,
  };
}

// 规则：返回 null 表示不匹配（交给下一个规则）
type Rule = (name: string, spec: string | null) => Classified | null;

const RULES: Rule[] = [
  // ---- 防护手套 (优先：手套/乳胶/丁腈 这类词很特征) ----
  (name) => {
    if (/(乳胶|丁腈|PE手套|PVC手套|手套)/.test(name)) {
      let t: Tier3 = '乳胶手套';
      if (/丁腈/.test(name)) t = '丁腈手套';
      else if (/乳胶/.test(name)) t = '乳胶手套';
      return { subcategory: '防护手套', type: t };
    }
    return null;
  },

  // ---- 载玻片与包埋 ----
  (name) => {
    if (/(载玻片|玻片|包埋|切片盒|染色架|染色缸|腔室载玻片|细胞爬片)/.test(name)) {
      let t: Tier3 = '载玻片';
      if (/包埋/.test(name)) t = '包埋盒';
      else if (/染色/.test(name)) t = '染色器材';
      else if (/腔室载玻片/.test(name)) t = '腔室载玻片';
      else if (/细胞爬片/.test(name)) t = '细胞爬片';
      return { subcategory: '载玻片与包埋', type: t };
    }
    return null;
  },

  // ---- PCR 与 qPCR 耗材 ----
  (name) => {
    if (/(PCR板|qPCR|荧光定量|八排管|八连管|PCR 单管|PCR单管|封板膜|封口膜)/.test(name)) {
      let t: Tier3 = 'PCR 耗材';
      if (/96孔荧光定量|96孔.*PCR板/.test(name)) t = '96 孔 PCR/qPCR 板';
      else if (/384孔荧光定量|384孔.*PCR板/.test(name)) t = '384 孔 PCR/qPCR 板';
      else if (/八排管|八连管/.test(name)) t = 'PCR 八排/八连管';
      else if (/PCR 单管|PCR单管/.test(name)) t = 'PCR 单管';
      else if (/封板膜/.test(name)) t = '封板膜';
      else if (/封口膜/.test(name)) t = '封口膜';
      return { subcategory: 'PCR与qPCR耗材', type: t };
    }
    return null;
  },

  // ---- 酶标板与微孔板 ----
  (name) => {
    if (/(酶标板|微孔板|深孔板|微孔过滤板)/.test(name)) {
      let t: Tier3 = '酶标板';
      if (/深孔板/.test(name)) t = '深孔板';
      else if (/微孔过滤板|微孔板/.test(name)) t = '微孔过滤板';
      else if (/酶标板/.test(name)) t = '酶标板';
      return { subcategory: '酶标板与微孔板', type: t };
    }
    return null;
  },

  // ---- 过滤耗材 ----
  (name) => {
    if (/(真空过滤|超滤|离心管过滤|滤膜|滤纸|一次性针头式滤器|滤器|细胞滤网|转印膜)/.test(name)) {
      let t: Tier3 = '过滤耗材';
      if (/真空/.test(name)) t = '真空过滤器';
      else if (/超滤/.test(name)) t = '超滤';
      else if (/离心管过滤/.test(name)) t = '离心管过滤器';
      else if (/转印膜/.test(name)) t = '转印膜';
      else if (/滤膜|滤纸|滤器/.test(name)) t = '滤膜/滤器';
      else if (/细胞滤网/.test(name)) t = '细胞滤网';
      return { subcategory: '过滤耗材', type: t };
    }
    return null;
  },

  // ---- 容器与试剂瓶 ----
  (name) => {
    if (/(三角瓶|锥形瓶|容量瓶|储液槽|储液桶|试剂瓶|加样槽|玻璃瓶|塑料瓶|烧杯|烧瓶|滴瓶|量筒|血清移液管|细菌培养.*瓶)/.test(name)) {
      let t: Tier3 = '玻璃容器';
      if (/储液槽|加样槽/.test(name)) t = '储液槽/加样槽';
      else if (/试剂瓶|滴瓶/.test(name)) t = '试剂瓶/滴瓶';
      else if (/三角瓶/.test(name)) t = '三角瓶';
      else if (/锥形瓶/.test(name)) t = '锥形瓶';
      else if (/容量瓶/.test(name)) t = '容量瓶';
      else if (/烧杯|烧瓶/.test(name)) t = '烧杯/烧瓶';
      else if (/量筒/.test(name)) t = '量筒';
      else if (/血清移液管/.test(name)) t = '血清移液管';
      else if (/细菌培养.*瓶/.test(name)) t = '细菌培养瓶';
      return { subcategory: '容器与试剂瓶', type: t };
    }
    return null;
  },

  // ---- 离心管与冻存 (优先于吸头, 因为冻存管/2D冻存管/EP管 特征明显) ----
  (name) => {
    if (/(离心管|冻存管|冻存架|冻存盒|冻存板架|EP管|多彩样品管|研磨管|核酸提取|外周血淋巴细胞分离)/.test(name)) {
      let t: Tier3 = '离心管';
      if (/2D冻存盒/.test(name)) t = '2D 冻存盒';
      else if (/SBS.*冻存板架|冻存板架/.test(name)) t = 'SBS 冻存板架';
      else if (/细胞冻存管|冻存管|2D冻存管|SBS冻存管|锥底冻存管/.test(name)) t = '细胞冻存管';
      else if (/冻存架/.test(name)) t = '冻存架';
      else if (/多彩样品管/.test(name)) t = '样品管';
      else if (/微量离心管|EP管|1\.5|2ml/.test(name)) t = '微量离心管/EP 管';
      else if (/外周血淋巴细胞分离/.test(name)) t = '淋巴细胞分离管';
      else if (/研磨管|核酸提取/.test(name)) t = '研磨管/核酸提取';
      else if (/离心管/.test(name)) t = '离心管';
      return { subcategory: '离心管与冻存', type: t };
    }
    return null;
  },

  // ---- 比色皿与光学耗材 (BS/QCV/GCV/FV/QT/MSB/MGS 大量) ----
  (name) => {
    if (/(比色皿|石英|光径|微量石英|半微量|流动石英|比色杯|比色管|皿$)/.test(name)) {
      let t: Tier3 = '比色皿';
      if (/半微量/.test(name)) t = '半微量比色皿';
      else if (/微量/.test(name)) t = '微量比色皿';
      else if (/流动石英|流动/.test(name)) t = '流动比色皿';
      else if (/密闭式/.test(name)) t = '密闭式比色皿';
      else if (/石英|光径/.test(name)) t = '石英比色皿';
      return { subcategory: '比色皿与光学耗材', type: t };
    }
    return null;
  },

  // ---- 过滤耗材 (覆盖过滤板/收集板/空柱管 等) ----
  (name, spec) => {
    const text = (name || '') + ' ' + (spec || '');
    if (/(过滤板|收集板|空柱管|质粒提取过滤)/.test(text)) {
      let t: Tier3 = '过滤耗材';
      if (/过滤板/.test(text)) t = '过滤板';
      else if (/收集板/.test(text)) t = '收集板';
      else if (/空柱管/.test(text)) t = '空柱管';
      return { subcategory: '过滤耗材', type: t };
    }
    return null;
  },

  // ---- 容器与试剂瓶 (覆盖接收瓶/储液瓶 等) ----
  (name) => {
    if (/(接收瓶|储液瓶|储液桶|样品瓶|进样瓶|进样针|血清移液)/.test(name)) {
      let t: Tier3 = '储液瓶';
      if (/接收瓶|储液瓶|储液桶/.test(name)) t = '储液瓶';
      else if (/样品瓶|进样瓶/.test(name)) t = '样品瓶';
      else if (/进样针/.test(name)) t = '进样针';
      return { subcategory: '容器与试剂瓶', type: t };
    }
    return null;
  },

  // ---- 细胞培养耗材 补充 (接触平皿/细胞铲子 等) ----
  (name) => {
    if (/(接触平皿|细胞铲|推刮|细胞推刮|刮刀)/.test(name)) {
      let t: Tier3 = '细胞刮/推刮器';
      if (/接触平皿/.test(name)) t = '接触平皿';
      else if (/细胞铲|细胞推刮|推刮|刮刀/.test(name)) t = '细胞刮/推刮器';
      return { subcategory: '细胞培养耗材', type: t };
    }
    return null;
  },

  // ---- 玻璃试管与管类 ----
  (name) => {
    if (/(玻璃试管|圆底试管|试管盖|试管架|迷你试管|硼硅.*试管)/.test(name)) {
      let t: Tier3 = '玻璃试管';
      if (/试管架/.test(name)) t = '试管架';
      else if (/试管盖/.test(name)) t = '试管盖';
      else if (/迷你试管/.test(name)) t = '迷你试管';
      else if (/圆底试管|玻璃试管|硼硅.*试管/.test(name)) t = '玻璃试管';
      return { subcategory: '玻璃试管与管类', type: t };
    }
    return null;
  },

  // ---- 磁力与搅拌 ----
  (name) => {
    if (/(磁力搅拌|磁力架|磁棒套|搅拌子)/.test(name)) {
      let t: Tier3 = '磁力搅拌子';
      if (/磁力架/.test(name)) t = '磁力架';
      else if (/磁棒套/.test(name)) t = '磁棒套';
      else if (/搅拌子/.test(name)) t = '磁力搅拌子';
      return { subcategory: '磁力与搅拌', type: t };
    }
    return null;
  },

  // ---- 培养基瓶 (PET/PETG 方形/圆形) ----
  (name) => {
    if (/(培养基瓶|方形.*瓶.*PET|圆形.*瓶.*PET|.*mL方形培养基瓶|.*mL圆形培养基瓶)/.test(name)) {
      return { subcategory: '容器与试剂瓶', type: '培养基瓶' };
    }
    return null;
  },

  // ---- 巴氏吸管 ----
  (name) => {
    if (/巴氏吸管/.test(name)) {
      return { subcategory: '吸头与移液', type: '巴氏吸管' };
    }
    return null;
  },

  // ---- PCR 薄壁管/平盖管 ----
  (name) => {
    if (/(薄壁管|平盖薄壁管|平盖管)/.test(name)) {
      return { subcategory: 'PCR与qPCR耗材', type: 'PCR 平盖薄壁管' };
    }
    return null;
  },

  // ---- 实验服与防护服 ----
  (name) => {
    if (/(白大褂|实验服|防护服|隔离衣|无菌服|洁净服)/.test(name)) {
      let t: Tier3 = '白大褂';
      if (/女式/.test(name)) t = '女式白大褂';
      else if (/男式/.test(name)) t = '男式白大褂';
      return { subcategory: '防护手套', type: t };
    }
    return null;
  },

  // ---- 酶标条/紫外分析板/酶标条框 (归酶标板) ----
  (name) => {
    if (/(酶标条|紫外分析板|酶标条框)/.test(name)) {
      let t: Tier3 = '酶标板';
      if (/紫外分析板/.test(name)) t = '紫外分析板';
      else if (/酶标条框/.test(name)) t = '酶标条框';
      else if (/酶标条/.test(name)) t = '酶标条';
      return { subcategory: '酶标板与微孔板', type: t };
    }
    return null;
  },

  // ---- 过滤耗材 补充 (NC膜/PVDF膜/核酸纯化柱/吸附柱) ----
  (name) => {
    if (/(硝酸纤维素膜|硝酸纤维膜|纤维素膜|PVDF膜|尼龙膜|核酸纯化柱|吸附柱|Spin Column)/.test(name)) {
      let t: Tier3 = '转印膜';
      if (/硝酸纤维素膜|硝酸纤维膜|纤维素膜|NC膜/.test(name)) t = 'NC 膜';
      else if (/PVDF膜/.test(name)) t = 'PVDF 膜';
      else if (/尼龙膜/.test(name)) t = '尼龙膜';
      else if (/核酸纯化柱|吸附柱|Spin Column/.test(name)) t = '核酸纯化柱';
      return { subcategory: '过滤耗材', type: t };
    }
    return null;
  },

  // ---- 程序降温盒/冻存耗材 补充 ----
  (name) => {
    if (/(程序降温盒|降温盒|NFS)/.test(name)) {
      return { subcategory: '离心管与冻存', type: '程序降温盒' };
    }
    return null;
  },

  // ---- PCR 冰盒/金属冰盒 ----
  (name) => {
    if (/(冰盒|PCR 冰盒|PCR冰盒|金属冰盒|低温冰盒|冰盒硅胶)/.test(name)) {
      let t: Tier3 = 'PCR 冰盒';
      if (/金属冰盒|低温金属/.test(name)) t = '金属冰盒';
      else if (/硅胶/.test(name)) t = '冰盒配件';
      return { subcategory: '冰盒与冷却', type: t };
    }
    return null;
  },

  // ---- 果蝇实验耗材 ----
  (name) => {
    if (/(果蝇管|果蝇瓶|果蝇塞|果蝇笼)/.test(name)) {
      let t: Tier3 = '果蝇管';
      if (/果蝇瓶/.test(name)) t = '果蝇瓶';
      else if (/果蝇塞|管塞|瓶塞/.test(name)) t = '果蝇管/瓶塞';
      else if (/果蝇管/.test(name)) t = '果蝇管';
      return { subcategory: '果蝇实验耗材', type: t };
    }
    return null;
  },

  // ---- 实验室防护 (帽子/护目镜/口罩 等) ----
  (name) => {
    if (/(无纺布帽|一次性.*帽|护目镜|防护面罩|口罩|鞋套|头套)/.test(name)) {
      let t: Tier3 = '实验帽';
      if (/帽/.test(name)) t = '实验帽';
      else if (/护目镜|防护面罩/.test(name)) t = '护目镜/面罩';
      else if (/口罩/.test(name)) t = '口罩';
      else if (/鞋套/.test(name)) t = '鞋套';
      return { subcategory: '防护手套', type: t };
    }
    return null;
  },

  // ---- 透析袋耗材 ----
  (name) => {
    if (/(透析袋|透析袋夹)/.test(name)) {
      let t: Tier3 = '透析袋';
      if (/夹子/.test(name)) t = '透析袋夹';
      else t = '透析袋';
      return { subcategory: '过滤耗材', type: t };
    }
    return null;
  },

  // ---- 实验耗材: 喷壶/采样棒/接种环/定时器/干燥架 ----
  (name) => {
    if (/(喷壶|采样棒|接种环|定时器|干燥架|压盖器|干燥支架|封盖器)/.test(name)) {
      let t: Tier3 = '实验工具';
      if (/喷壶/.test(name)) t = '喷壶';
      else if (/采样棒|接种环/.test(name)) t = '接种环/采样棒';
      else if (/定时器/.test(name)) t = '定时器';
      else if (/干燥|压盖|封盖/.test(name)) t = '干燥/压盖工具';
      return { subcategory: '其他耗材', type: t };
    }
    return null;
  },

  // ---- PCR 四排管/铝箔热封膜/铝箔纸 ----
  (name) => {
    if (/(PCR 四排管|PCR四排管|铝箔热封膜|铝箔纸)/.test(name)) {
      let t: Tier3 = 'PCR 耗材';
      if (/四排管/.test(name)) t = 'PCR 四排管';
      else if (/铝箔热封膜|铝箔纸/.test(name)) t = '铝箔热封膜';
      return { subcategory: 'PCR与qPCR耗材', type: t };
    }
    return null;
  },

  // ---- 免疫组化笔/防脱笔/抗原修复盒 ----
  (name) => {
    if (/(免疫组化笔|防脱笔|抗原修复盒|组化笔|组织切片防脱)/.test(name)) {
      let t: Tier3 = '免疫组化笔';
      if (/抗原修复盒/.test(name)) t = '抗原修复盒';
      else if (/防脱笔/.test(name)) t = '切片防脱笔';
      else t = '免疫组化笔';
      return { subcategory: '载玻片与包埋', type: t };
    }
    return null;
  },

  // ---- SPE 柱/核酸纯化柱 补充（前面规则有重叠，再保底） ----
  (name) => {
    if (/SPE.*柱|SPE空柱|SPE串联柱/.test(name)) {
      return { subcategory: '过滤耗材', type: 'SPE 柱' };
    }
    return null;
  },

  // ---- 样本运输管/圆底自立式冷冻管架 ----
  (name) => {
    if (/(样本运输管|运输管)/.test(name)) {
      return { subcategory: '离心管与冻存', type: '样本运输管' };
    }
    if (/(圆底自立式冷冻管架|冷冻管架|塑料冷冻管架)/.test(name)) {
      return { subcategory: '离心管与冻存', type: '冷冻管架' };
    }
    return null;
  },

  // ---- 利器盒/废弃物桶袋/医疗废弃物 ----
  (name) => {
    if (/(利器盒|废弃物桶|废弃物袋|实验废弃物)/.test(name)) {
      let t: Tier3 = '利器盒';
      if (/废弃物袋|废弃物桶|废弃物/.test(name)) t = '实验废弃物袋/桶';
      else if (/利器盒/.test(name)) t = '利器盒';
      return { subcategory: '防护手套', type: t };
    }
    return null;
  },

  // ---- WB 孵育盒/洗膜盒 ----
  (name) => {
    if (/(WB洗膜盒|洗膜盒|孵育盒|WB孵育盒)/.test(name)) {
      return { subcategory: '过滤耗材', type: 'WB 孵育盒' };
    }
    return null;
  },

  // ---- 实验室小型设备 (离心机/扫码/打印机/工作站) ----
  (name) => {
    if (/(掌上离心机|小型离心机|手持扫码仪|扫码仪|标签打印机|色带打印机|低温标签打印机|自动化移液工作站|开盖移液对接模块|移液对接模块|自动化PCR硅胶垫|连排管压盖器|压盖器|压盖机)/.test(name)) {
      let t: Tier3 = '实验室设备';
      if (/离心机/.test(name)) t = '小型离心机';
      else if (/扫码仪/.test(name)) t = '扫码仪';
      else if (/打印机|色带|标签/.test(name)) t = '标签打印机';
      else if (/移液工作站|对接模块/.test(name)) t = '自动化移液设备';
      else if (/压盖/.test(name)) t = '压盖器';
      else if (/硅胶垫/.test(name)) t = 'PCR 硅胶垫';
      return { subcategory: '其他耗材', type: t };
    }
    return null;
  },

  // ---- 实验室软件/样本库管理 ----
  (name) => {
    if (/(样本库管理软件|样本库.*管理)/.test(name)) {
      return { subcategory: '其他耗材', type: '实验室软件' };
    }
    return null;
  },

  // ---- 一次性塑料培养方皿/涂布棒 ----
  (name) => {
    if (/(一次性塑料培养方皿|塑料方皿|塑料涂布棒|一次性塑料涂布棒)/.test(name)) {
      let t: Tier3 = '实验工具';
      if (/培养方皿|方皿/.test(name)) t = '塑料培养方皿';
      else if (/涂布棒/.test(name)) t = '涂布棒';
      return { subcategory: '其他耗材', type: t };
    }
    return null;
  },

  // ---- 过滤耗材 补充: 闪滤瓶/亲和层析柱/凝胶柱 ----
  (name) => {
    if (/(闪滤瓶|亲和层析柱空柱|亲和层析柱|凝胶柱)/.test(name)) {
      let t: Tier3 = '闪滤瓶';
      if (/亲和层析柱/.test(name)) t = '亲和层析柱空柱';
      else if (/闪滤瓶/.test(name)) t = '闪滤瓶';
      else if (/凝胶柱/.test(name)) t = '凝胶柱';
      return { subcategory: '过滤耗材', type: t };
    }
    return null;
  },

  // ---- 载玻片与包埋 补充: 晾片板/切片刀片 ----
  (name) => {
    if (/(晾片板|切片刀片|切片机刀片)/.test(name)) {
      let t: Tier3 = '晾片板';
      if (/切片刀片|切片机刀片/.test(name)) t = '切片刀片';
      else if (/晾片板/.test(name)) t = '晾片板';
      return { subcategory: '载玻片与包埋', type: t };
    }
    return null;
  },

  // ---- 玻璃试管与管类 补充: 试管塞 ----
  (name) => {
    if (/试管塞|白色橡胶.*塞|硅胶塞/.test(name)) {
      return { subcategory: '玻璃试管与管类', type: '试管塞' };
    }
    return null;
  },

  // ---- 实验工具/外科器械: 剪刀/镊子/止血钳 ----
  (name) => {
    if (/(直头剪刀|弯头剪刀|尖直头镊子|尖弯头镊子|直头镊子|弯头镊子|直头止血钳|弯头止血钳|手术剪|手术镊|解剖剪|组织剪|眼科剪)/.test(name)) {
      let t: Tier3 = '剪刀';
      if (/镊子/.test(name)) t = '镊子';
      else if (/止血钳/.test(name)) t = '止血钳';
      else if (/剪刀/.test(name)) t = '剪刀';
      return { subcategory: '其他耗材', type: t };
    }
    return null;
  },

  // ---- 称量纸/称量皿 ----
  (name) => {
    if (/(称量纸|称量皿|称量勺|药匙)/.test(name)) {
      let t: Tier3 = '称量纸';
      if (/称量皿/.test(name)) t = '称量皿';
      else if (/称量勺|药匙/.test(name)) t = '称量勺';
      return { subcategory: '其他耗材', type: t };
    }
    return null;
  },

  // ---- 实验废弃物: 耐高温垃圾袋/利器盒（前面规则已覆盖利器盒） ----
  (name) => {
    if (/耐高温垃圾袋|耐高温.*袋|高温垃圾袋/.test(name)) {
      return { subcategory: '防护手套', type: '实验废弃物袋' };
    }
    return null;
  },

  // ---- 培养皿补充: 一次性塑料培养方皿/细菌培养方皿 ----
  (name) => {
    if (/(一次性塑料培养方皿|塑料方皿|.*方皿|一次性塑料培养皿)/.test(name)) {
      return { subcategory: '细胞培养耗材', type: '培养方皿' };
    }
    return null;
  },

  // ---- 玻璃搅拌棒/坩埚钳/熔点毛细管/布氏漏斗/GL45瓶盖/点样毛细管 ----
  (name) => {
    if (/(玻璃搅拌棒|搅拌棒|坩埚钳|熔点毛细管|布氏漏斗|布氏|点样毛细管|耳标|耳号|.*耳标|.*耳号)/.test(name)) {
      let t: Tier3 = '玻璃搅拌棒';
      if (/搅拌棒/.test(name)) t = '玻璃搅拌棒';
      else if (/坩埚钳/.test(name)) t = '坩埚钳';
      else if (/熔点毛细管/.test(name)) t = '熔点毛细管';
      else if (/布氏漏斗|布氏/.test(name)) t = '布氏漏斗';
      else if (/点样毛细管/.test(name)) t = '点样毛细管';
      else if (/耳标|耳号/.test(name)) t = '耳标';
      return { subcategory: '其他耗材', type: t };
    }
    return null;
  },

  // ---- 膜/格栅膜/网格膜/MCE膜 (过滤耗材补充) ----
  (name) => {
    if (/(格栅膜|网格膜|MCE膜|白膜黑格|.*膜$|.*膜[，,\(])/.test(name)) {
      let t: Tier3 = 'NC 膜';
      if (/格栅膜|网格膜|MCE膜|白膜黑格/.test(name)) t = 'MCE 膜';
      else t = '其他转印膜';
      return { subcategory: '过滤耗材', type: t };
    }
    return null;
  },

  // ---- 标记/记号笔 (玻片标记) ----
  (name) => {
    if (/(双头记号笔|防酒精双头记号笔|记号笔$|.*记号笔)/.test(name)) {
      return { subcategory: '载玻片与包埋', type: '玻片标记笔' };
    }
    return null;
  },

  // ---- 血凝反应板 (U型/V型, 有机玻璃/一次性) ----
  (name) => {
    if (/(血凝反应板|.*血凝板)/.test(name)) {
      return { subcategory: '酶标板与微孔板', type: '血凝反应板' };
    }
    return null;
  },

  // ---- 高温灭菌袋 (可高温高压灭菌袋) ----
  (name) => {
    if (/(可高温高压灭菌袋|高温灭菌袋|灭菌袋)/.test(name)) {
      return { subcategory: '防护手套', type: '高温灭菌袋' };
    }
    return null;
  },

  // ---- 称量盘 (方形/菱形/船形, 防静电) ----
  (name) => {
    if (/(称量盘)/.test(name)) {
      let t: Tier3 = '称量盘';
      if (/方形|菱形|船形/.test(name)) t = `${name.match(/方形|菱形|船形/)?.[0] || ''}称量盘`;
      return { subcategory: '其他耗材', type: t };
    }
    return null;
  },

  // ---- 容器与试剂瓶 补充: 瓶盖/称量盘/小鼠饮水瓶 ----
  (name) => {
    if (/(GL45 瓶盖|GL45瓶盖|.*瓶盖|小鼠饮水瓶|饮水瓶)/.test(name)) {
      let t: Tier3 = '瓶盖';
      if (/GL45/.test(name)) t = 'GL45 瓶盖';
      else if (/小鼠饮水瓶|饮水瓶/.test(name)) t = '实验动物饮水瓶';
      else t = '瓶盖';
      return { subcategory: '容器与试剂瓶', type: t };
    }
    return null;
  },

  // ---- 加热/电热器材: 酒精灯/石棉网/坩埚钳/滴定夹 ----
  (name) => {
    if (/(酒精灯|石棉网|坩埚钳|滴定夹)/.test(name)) {
      let t: Tier3 = '酒精灯';
      if (/石棉网/.test(name)) t = '石棉网';
      else if (/坩埚钳/.test(name)) t = '坩埚钳';
      else if (/滴定夹/.test(name)) t = '滴定夹';
      return { subcategory: '其他耗材', type: t };
    }
    return null;
  },

  // ---- 实验动物用品: 耳标/耳标钳/动物饮水瓶/动物标记 ----
  (name) => {
    if (/(耳标|耳标钳|动物饮水瓶|实验动物)/.test(name)) {
      let t: Tier3 = '耳标';
      if (/耳标钳/.test(name)) t = '耳标钳';
      else if (/饮水瓶/.test(name)) t = '实验动物饮水瓶';
      else t = '耳标';
      return { subcategory: '其他耗材', type: t };
    }
    return null;
  },

  // ---- 实验夹具: 十字夹/三爪夹/铁架台/烧瓶夹/万能夹 ----
  (name) => {
    if (/(十字夹|三爪夹|铁架台|烧瓶夹|万能夹|双顶丝|蝶形夹|.*夹(中号|大号|小号))/.test(name)) {
      let t: Tier3 = '实验夹具';
      if (/十字夹|双顶丝/.test(name)) t = '十字夹';
      else if (/三爪夹/.test(name)) t = '三爪夹';
      else if (/铁架台/.test(name)) t = '铁架台';
      else if (/烧瓶夹|蝶形夹/.test(name)) t = '烧瓶夹';
      else t = '实验夹具';
      return { subcategory: '其他耗材', type: t };
    }
    return null;
  },

  // ---- 实验室橡胶/塑料器材: 洗耳球/硅胶管/橡胶管/乳胶管 ----
  (name) => {
    if (/(洗耳球|硅胶管|乳胶管|橡胶管)/.test(name)) {
      let t: Tier3 = '洗耳球';
      if (/硅胶管|乳胶管|橡胶管/.test(name)) t = '硅胶/乳胶管';
      return { subcategory: '其他耗材', type: t };
    }
    return null;
  },

  // ---- 电泳玻璃板/电泳槽配件 ----
  (name) => {
    if (/(电泳玻璃板|电泳玻璃板套装|电泳槽|电泳.*板)/.test(name)) {
      return { subcategory: '酶标板与微孔板', type: '电泳玻璃板' };
    }
    return null;
  },

  // ---- 实验室基础试剂/工具 ----
  (name) => {
    if (/(精密试纸|pH 试纸|.*试纸$|蒸馏水桶|.*水桶$|均质袋|拍打式均质|均质)/.test(name)) {
      let t: Tier3 = '实验耗材';
      if (/试纸/.test(name)) t = '精密试纸';
      else if (/水桶/.test(name)) t = '蒸馏水桶';
      else if (/均质/.test(name)) t = '均质袋';
      return { subcategory: '其他耗材', type: t };
    }
    return null;
  },

  // ---- 按应用场景归类零散 product: ----

  // 胶头滴管 / LDPE 洗瓶 / 三角漏斗 / 流动相盖子 / 样本杯 → 容器与试剂瓶
  (name) => {
    if (/(胶头滴管|LDPE.*洗瓶|LDPE 洗瓶|塑料透明三角漏斗|.*三角漏斗|流动相盖子|.*流动相|.*样本杯|刻度量杯)/.test(name)) {
      let t: Tier3 = '胶头滴管';
      if (/洗瓶/.test(name)) t = '洗瓶';
      else if (/三角漏斗/.test(name)) t = '三角漏斗';
      else if (/流动相/.test(name)) t = '流动相盖子';
      else if (/样本杯/.test(name)) t = '样本杯';
      else if (/量杯/.test(name)) t = '刻度量杯';
      return { subcategory: '容器与试剂瓶', type: t };
    }
    return null;
  },

  // 灌胃针/鼠笼 → 实验动物用品（归"其他耗材" type 实验动物）
  (name) => {
    if (/(灌胃针|.*灌胃|鼠笼|.*鼠笼|.*实验动物)/.test(name)) {
      let t: Tier3 = '实验动物';
      if (/灌胃/.test(name)) t = '灌胃针';
      else if (/鼠笼/.test(name)) t = '实验鼠笼';
      return { subcategory: '其他耗材', type: t };
    }
    return null;
  },

  // 塑料接口夹 → 实验夹具
  (name) => {
    if (/(塑料接口夹|.*接口夹|.*接口)/.test(name)) {
      return { subcategory: '其他耗材', type: '实验夹具' };
    }
    return null;
  },

  // 离心式蛋白纯化空柱 / 旋盖式纯化柱 → 过滤耗材
  (name) => {
    if (/(离心式蛋白纯化空柱|旋盖式蛋白纯化|蛋白纯化空柱|旋盖式.*空柱|空柱$)/.test(name)) {
      let t: Tier3 = '蛋白纯化空柱';
      if (/旋盖式/.test(name)) t = '旋盖式蛋白纯化空柱';
      else if (/离心式/.test(name)) t = '离心式蛋白纯化空柱';
      return { subcategory: '过滤耗材', type: t };
    }
    return null;
  },

  // 核酸剪切管 → 离心管与冻存
  (name) => {
    if (/核酸剪切管|剪切管/.test(name)) {
      return { subcategory: '离心管与冻存', type: '核酸剪切管' };
    }
    return null;
  },

  // 玻璃试管与管类 补充: 血清试管/尿沉渣管/玻璃高回收瓶/试管沥水架
  (name) => {
    if (/(血清试管|尿沉渣管|.*尿沉渣|高回收瓶|.*高回收瓶|试管沥水架|.*试管沥水架|聚四氟乙烯.*标准塞|.*实心标准塞)/.test(name)) {
      let t: Tier3 = '血清试管';
      if (/尿沉渣/.test(name)) t = '尿沉渣管';
      else if (/高回收瓶/.test(name)) t = '玻璃高回收瓶';
      else if (/试管沥水架/.test(name)) t = '试管沥水架';
      else if (/血清试管/.test(name)) t = '血清试管';
      else if (/标准塞/.test(name)) t = '聚四氟乙烯标准塞';
      return { subcategory: '玻璃试管与管类', type: t };
    }
    return null;
  },

  // 过滤耗材 补充: 中压层析柱空柱/质粒过滤柱/旋盖式层析柱
  (name) => {
    if (/(中压层析柱空柱|层析柱空柱|质粒.*过滤柱|.*质粒.*柱|旋盖式.*柱)/.test(name)) {
      let t: Tier3 = '中压层析柱空柱';
      if (/质粒/.test(name)) t = '质粒过滤柱';
      else if (/中压层析柱/.test(name)) t = '中压层析柱空柱';
      return { subcategory: '过滤耗材', type: t };
    }
    return null;
  },

  // 容器与试剂瓶 补充: 不锈钢灭菌盒/标本瓶/三通旋盖
  (name) => {
    if (/(不锈钢灭菌盒|灭菌盒|标本瓶|.*标本瓶|三通旋盖|.*三通)/.test(name)) {
      let t: Tier3 = '不锈钢灭菌盒';
      if (/标本瓶/.test(name)) t = '标本瓶';
      else if (/三通旋盖|三通/.test(name)) t = '三通旋盖';
      else if (/灭菌盒/.test(name)) t = '不锈钢灭菌盒';
      return { subcategory: '容器与试剂瓶', type: t };
    }
    return null;
  },

  // 研磨与样品制备: 研钵/药勺
  (name) => {
    if (/(陶瓷研钵|玛瑙研钵|药勺|.*药勺|方头药勺|单头药勺|双头药勺)/.test(name)) {
      let t: Tier3 = '研钵';
      if (/药勺/.test(name)) t = '药勺';
      else if (/陶瓷研钵/.test(name)) t = '陶瓷研钵';
      else if (/玛瑙研钵/.test(name)) t = '玛瑙研钵';
      return { subcategory: '其他耗材', type: t };
    }
    return null;
  },

  // 实验耗材: 镊子(方头)/试管刷/试管夹/橡胶漏斗托/弹簧止水夹/升降台/刀柄/U盘
  (name) => {
    if (/(方头镊子|试管刷|试管夹|橡胶漏斗托|弹簧止水夹|实验室升降台|.*升降台|U盘|.*U盘|刀柄|.*刀柄)/.test(name)) {
      let t: Tier3 = '镊子';
      if (/方头镊子/.test(name)) t = '方头镊子';
      else if (/试管刷/.test(name)) t = '试管刷';
      else if (/试管夹/.test(name)) t = '试管夹';
      else if (/橡胶漏斗托/.test(name)) t = '橡胶漏斗托';
      else if (/弹簧止水夹/.test(name)) t = '弹簧止水夹';
      else if (/升降台/.test(name)) t = '实验室升降台';
      else if (/U盘/.test(name)) t = 'U盘';
      else if (/刀柄/.test(name)) t = '刀柄';
      return { subcategory: '其他耗材', type: t };
    }
    return null;
  },

  // 实验动物采样袋: 水样采集袋/均质袋/无菌采样袋/生物样本子母袋/抗体孵育袋
  (name) => {
    if (/(水样采集袋|无菌采样袋|.*采样袋|生物样本.*袋|.*子母袋|抗体孵育袋|杂交袋)/.test(name)) {
      let t: Tier3 = '采样袋';
      if (/子母袋/.test(name)) t = '生物样本子母袋';
      else if (/抗体孵育|杂交袋/.test(name)) t = '抗体孵育袋';
      return { subcategory: '其他耗材', type: t };
    }
    return null;
  },

  // PCR 补充: PCR 硅胶盖/PCR 八排管
  (name) => {
    if (/(PCR 硅胶盖|PCR硅胶盖|.*PCR.*硅胶.*盖|平玻璃板.*适配|.*适配.*PCR)/.test(name)) {
      return { subcategory: 'PCR与qPCR耗材', type: 'PCR 硅胶盖' };
    }
    return null;
  },

  // 实验夹具补充: 螺旋止水夹/铁三环/铁三脚架/燃烧勺/天平刷
  (name) => {
    if (/(螺旋止水夹|.*止水夹|铁三环|铁三脚架|.*三脚架|燃烧勺|.*燃烧勺|天平刷|.*天平刷|精细镊子|直头精细|弯头精细|橡胶吸球|硅胶吸球|.*吸球)/.test(name)) {
      let t: Tier3 = '实验夹具';
      if (/止水夹/.test(name)) t = '止水夹';
      else if (/三环|三脚架/.test(name)) t = '铁架台/三脚架';
      else if (/燃烧勺/.test(name)) t = '燃烧勺';
      else if (/天平刷/.test(name)) t = '天平刷';
      else if (/精细镊子|直头精细|弯头精细/.test(name)) t = '精细镊子';
      else if (/吸球/.test(name)) t = '吸球';
      return { subcategory: '其他耗材', type: t };
    }
    return null;
  },

  // 接种针/接种环
  (name) => {
    if (/(接种针|.*接种针|.*接种环)/.test(name)) {
      return { subcategory: '其他耗材', type: '接种环/针' };
    }
    return null;
  },

  // 血球计数板/细胞计数板 → 载玻片与包埋
  (name) => {
    if (/(血球计数板|细胞计数板|.*计数板)/.test(name)) {
      return { subcategory: '载玻片与包埋', type: '血球计数板' };
    }
    return null;
  },

  // PCR 荧光检测反应管/PCR 反应管
  (name) => {
    if (/荧光检测反应管|.*检测反应管/.test(name)) {
      return { subcategory: 'PCR与qPCR耗材', type: 'PCR 反应管' };
    }
    return null;
  },

  // 试纸类
  (name) => {
    if (/(广范试纸|.*试纸|pH 试纸|pH试纸)/.test(name)) {
      return { subcategory: '其他耗材', type: 'pH 试纸' };
    }
    return null;
  },

  // 吸水纸/卫生耗材
  (name) => {
    if (/(吸水纸|.*吸水纸)/.test(name)) {
      return { subcategory: '其他耗材', type: '吸水纸' };
    }
    return null;
  },

  // ---- 脱脂棉/擦拭纸/铝箔纸/喷壶/定时器/接种环/电泳玻璃板干燥架（杂项归其他耗材） ----
  (name) => {
    if (/(脱脂棉|擦拭纸|无尘纸|铝箔纸|喷壶|定时器|接种环|采样棒|电泳玻璃板干燥支架|干燥支架|胶带|指示胶带|放水桶龙头|喷头|龙头)/.test(name)) {
      let t: Tier3 = '实验耗材';
      if (/脱脂棉/.test(name)) t = '脱脂棉';
      else if (/擦拭纸|无尘纸/.test(name)) t = '擦拭纸';
      else if (/铝箔纸/.test(name)) t = '铝箔纸';
      else if (/喷壶/.test(name)) t = '喷壶';
      else if (/定时器/.test(name)) t = '定时器';
      else if (/接种环|采样棒/.test(name)) t = '接种环/采样棒';
      else if (/电泳玻璃板干燥支架|干燥支架/.test(name)) t = '电泳玻璃板干燥架';
      else if (/胶带|指示胶带/.test(name)) t = '指示胶带';
      else if (/放水桶龙头|喷头|龙头/.test(name)) t = '实验室五金';
      return { subcategory: '其他耗材', type: t };
    }
    return null;
  },

  // ---- 吸头与移液 ----
  (name) => {
    if (/(吸头|移液器|移液管|储液槽|加样槽)/.test(name)) {
      let t: Tier3 = '吸头';
      if (/自动化/.test(name)) t = '自动化吸头';
      else if (/滤芯/.test(name)) t = '滤芯吸头';
      else if (/低吸附/.test(name)) t = '低吸附吸头';
      else if (/无酶/.test(name)) t = '无酶吸头';
      else if (/无菌/.test(name)) t = '无菌吸头';
      else if (/吸头盒|适配Eppendorf多道|适配瑞宁/.test(name)) t = '吸头盒/适配器';
      else if (/吸头/.test(name)) t = '普通吸头';
      else if (/移液器/.test(name)) t = '移液器';
      return { subcategory: '吸头与移液', type: t };
    }
    return null;
  },

  // ---- 细胞培养耗材 (优先于最后兜底, 因为特征词广) ----
  (name) => {
    if (/(细胞培养|培养板|培养瓶|培养皿|细胞工厂|细胞小室|玻底培养|细胞侵袭|细胞划痕|刮刀|推刮器|生物反应器|真空过滤)/.test(name)) {
      let t: Tier3 = '细胞培养板';
      if (/细胞培养瓶|培养瓶/.test(name)) t = '细胞培养瓶';
      else if (/细胞培养皿|培养皿|玻底培养/.test(name)) t = '细胞培养皿';
      else if (/细胞工厂/.test(name)) t = '细胞工厂';
      else if (/细胞侵袭小室|细胞小室|细胞培养小室/.test(name)) t = '细胞培养小室';
      else if (/细胞划痕|划痕插件/.test(name)) t = '细胞划痕插件';
      else if (/刮刀|推刮器/.test(name)) t = '细胞刮/推刮器';
      else if (/生物反应器/.test(name)) t = '生物反应器';
      else if (/培养板/.test(name)) t = '细胞培养板';
      return { subcategory: '细胞培养耗材', type: t };
    }
    return null;
  },

  // ---- 兜底 ----
  () => ({ subcategory: '其他耗材', type: '其他' }),
];

function classify(name: string, spec: string | null): Classified {
  for (const rule of RULES) {
    const r = rule(name, spec);
    if (r) return canonicalizeClassified(r);
  }
  return canonicalizeClassified({ subcategory: '其他耗材', type: '其他' });
}

async function main() {
  console.log(`[mode] ${APPLY ? 'APPLY (update db)' : 'DRY-RUN (preview)'}`);

  // 拉 Labselect + Biosharp 材料合成下所有产品
  const products = await prisma.product.findMany({
    where: {
      category: '材料合成',
      brand: { in: ['Labselect', 'Biossharp', 'Biosharp'] },
    },
    select: { catalogNumber: true, name: true, spec: true, brand: true },
  });
  console.log(`[fetch] ${products.length} products to classify`);

  // 分类
  const updates: { catalogNumber: string; brand: string; name: string; subcategory: string; type: string }[] = [];
  for (const p of products) {
    const c = classify(p.name || '', p.spec || null);
    updates.push({
      catalogNumber: p.catalogNumber,
      brand: p.brand,
      name: p.name,
      subcategory: c.subcategory,
      type: c.type,
    });
  }

  // 统计
  const subCount: Record<string, number> = {};
  const subTypeCount: Record<string, Record<string, number>> = {};
  for (const u of updates) {
    subCount[u.subcategory] = (subCount[u.subcategory] || 0) + 1;
    if (!subTypeCount[u.subcategory]) subTypeCount[u.subcategory] = {};
    subTypeCount[u.subcategory][u.type] = (subTypeCount[u.subcategory][u.type] || 0) + 1;
  }

  console.log(`\n=== subcategory 分布 ===`);
  for (const [sub, n] of Object.entries(subCount).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n.toString().padStart(5)}  ${sub}`);
  }
  console.log(`\n=== subcategory × type ===`);
  for (const [sub, types] of Object.entries(subTypeCount)) {
    console.log(`-- ${sub} --`);
    for (const [t, n] of Object.entries(types).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${n.toString().padStart(5)}  ${t}`);
    }
  }

  console.log(`\n=== 抽样 (每个 subcategory 3 条) ===`);
  for (const sub of Object.keys(subTypeCount)) {
    console.log(`-- ${sub} --`);
    for (const u of updates.filter((x) => x.subcategory === sub).slice(0, 3)) {
      console.log(`  ${u.catalogNumber} | ${u.brand} | ${u.name.slice(0, 50)} | type=${u.type}`);
    }
  }

  if (!APPLY) {
    console.log(`\n[skip] dry-run 模式不 update。要写库加 --apply`);
    await prisma.$disconnect();
    return;
  }

  // Apply: batch update 按 (subcategory, type) 分组
  console.log(`\n[apply] 按 (subcategory, type) 分组 batch update...`);
  let updated = 0;
  for (const [sub, types] of Object.entries(subTypeCount)) {
    for (const [t, _n] of Object.keys(types) ? [Object.entries(types)] : []) {
      // dummy
    }
    for (const [t, _n] of Object.entries(types)) {
      const targets = updates.filter((u) => u.subcategory === sub && u.type === t).map((u) => u.catalogNumber);
      const BATCH = 500;
      for (let i = 0; i < targets.length; i += BATCH) {
        const slice = targets.slice(i, i + BATCH);
        const r = await prisma.product.updateMany({
          where: { catalogNumber: { in: slice } },
          data: { subcategory: sub, type: t },
        });
        updated += r.count;
      }
    }
  }
  console.log(`\n=== Done ===`);
  console.log(`Updated rows: ${updated}`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
