/**
 * ELISA 产品三级分类脚本
 *
 * 一级: ELISA试剂盒 (不变)
 * 二级: 按物种/产品类型分 (subcategory 字段)
 * 三级: 按检测指标大类分 (type 字段)
 *
 * 用法: node scripts/reclassify-elisa.mjs
 */

import Database from 'better-sqlite3';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, '..', 'prisma', 'dev.db');

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// ============================================================
// 分类规则
// ============================================================

/** 判断是否为微孔板检测试剂盒 */
function isMicroplateAssay(name) {
  return /microplate assay/i.test(name);
}

/** 判断是否为标准品 */
function isStandard(name) {
  const lower = name.toLowerCase();
  // 包含 standard 但不是 Kit
  if (/\bstandard\b/i.test(name) && !/kit/i.test(name)) return true;
  // Cortisol Competitive standard 等变体
  if (/competitive\s+standard/i.test(name)) return true;
  return false;
}

/** 判断是否为辅助试剂 */
function isAuxiliaryReagent(name, brand) {
  const lower = name.toLowerCase();

  // 明确的辅助试剂关键词
  const auxKeywords = [
    /buffer/i, /washing/i, /封闭/i, /拍板/i, /tmb/i,
    /酶标板/i, /封板膜/i, /basic kit/i,
    /goat anti-/i,  // 检测抗体
    /dab/i, /荧光显色/i, /显色/i,
  ];
  if (auxKeywords.some(re => re.test(name))) return true;

  // Sigma-Aldrich 中非 ELISA Kit 的产品归入辅助试剂
  if (brand === 'Sigma-Aldrich') {
    if (!/elisa/i.test(name)) return true;
  }

  // Abcepta 中 DAB/荧光显色产品
  if (brand === 'Abcepta') {
    if (/dab|荧光显色|显色/i.test(name)) return true;
  }

  return false;
}

/** 从产品名提取物种 */
function extractSpecies(name, catalogNumber) {
  const lower = name.toLowerCase();

  // Biosharp 货号前缀编码物种
  const prefixMap = {
    BQEH: 'human', BXEH: 'human', BSEH: 'human',
    BQEM: 'mouse', BXEM: 'mouse', BSEM: 'mouse',
    BQER: 'rat',   BXER: 'rat',   BSER: 'rat',
    BQEA: 'other', BXEA: 'other', BSEA: 'other',  // Animal/Rabbit
    BQEP: 'other', BXEP: 'other',  // Pig
    BQEB: 'other', BXEB: 'other',  // Bovine
    BQEK: 'other', BXEK: 'other',  // Chicken
    BQEG: 'other', BXEG: 'other',  // Guinea pig
    BXEY: 'other',  // Monkey
    BXEC: 'other',  // Chicken
    BXES: 'other',  // Other
    BQEN: 'general', BXEN: 'general', BSEN: 'general',
  };

  for (const [prefix, species] of Object.entries(prefixMap)) {
    if (name.startsWith(prefix + '-') || name.startsWith(prefix + ' ')) {
      // 但名称中可能也有物种信息，以名称为准
      return speciesFromName(name) || species;
    }
  }

  return speciesFromName(name) || 'general';
}

/** 从产品名称中提取物种 */
function speciesFromName(name) {
  const lower = name.toLowerCase();

  if (/human|\b人\b/.test(name) || /人的|人源/.test(name)) return 'human';
  if (/mouse|\b小鼠\b/.test(name) || /小鼠/.test(name)) return 'mouse';
  if (/\brat\b|\b大鼠\b/.test(name)) return 'rat';
  if (/rabbit|兔/.test(name)) return 'other';
  if (/pig|猪/.test(name)) return 'other';
  if (/monkey|猴/.test(name)) return 'other';
  if (/guinea\s*pig|豚鼠/.test(name)) return 'other';
  if (/chicken|鸡/.test(name)) return 'other';
  if (/bovine|牛/.test(name)) return 'other';
  if (/canine|dog|狗/.test(name)) return 'other';
  if (/feline|cat|猫/.test(name)) return 'other';

  return null;
}

/** 三级分类: 按检测指标大类 */
function classifyByBiomarker(name) {
  const lower = name.toLowerCase();

  // 细胞因子和趋化因子
  const cytokinePatterns = [
    /\bil-?\d/i, /interleukin/i, /白介素/i, /白细胞介素/i,
    /tnf/i, /肿瘤坏死因子/i,
    /ifn|interferon/i, /干扰素/i,
    /vegf/i, /血管内皮生长因子/i,
    /tgf-?β/i, /tgf-beta/i, /tgf b/i,
    /bdnf/i, /脑源性/i,
    /fgf/i, /成纤维细胞生长因子/i,
    /pdgf/i, /血小板衍化/i, /血小板衍生/i,
    /gm-csf/i, /m-csf/i, /g-csf/i,
    /epo/i, /促红细胞生成素/i,
    /gdf/i, /生长分化因子/i,
    /bmp/i, /骨形态发生蛋白/i,
    /mcp-?\d/i, /ccl\d/i, /单核细胞趋化/i, /趋化因子/i,
    /eotaxin/i, /mip-?\d/i, /rantes/i, /fractalkine/i,
    /baff|blys/i, /tnfsf/i, /trail/i, /fasl/i, /cd40l/i,
    /activin/i, /激活素/i,
    /inhibin/i, /抑制素/i,
    /amphiregulin/i, /betacellulin/i,
    /heregulin/i, /neuregulin/i,
    /scf/i, /干细胞因子/i,
    /flt.?3/i, /lif/i, /白血病抑制因子/i,
    /ostdoprotegerin/i, /opg/i,
    /pigu/i, /pip/i,
    /thpo/i, /血小板生成素/i,
    /cntf/i, /ct-?1/i, /cardiotrophin/i,
    /ctack/i, /teck/i, /tarc/i, /parc/i,
    /hcc-?\d/i, /ncc-?\d/i,
    /mpif/i,
    /perforin/i, /穿孔素/i,
    /granzyme/i,
    /sdf/i, /cxcl/i,
    /ip-?10/i, /mig/i, /i-tac/i,
    /gro/i, /cxcl/i,
    /eno-?78/i, /gcp-?\d/i,
    /6-?ckine/i,
  ];
  if (cytokinePatterns.some(re => re.test(name))) return '细胞因子和趋化因子';

  // 肿瘤和心血管标志物
  const cardioTumorPatterns = [
    /ca\s?\d{2}[-?]?\d/i, /糖类抗体/i, /糖类抗原/i,
    /cea/i, /癌胚抗原/i,
    /psa/i, /前列腺特异性/i,
    /crp/i, /c-?反应蛋白/i,
    /pct/i, /降钙素原/i,
    /ace/i, /血管紧张素转化酶/i,
    /apolipoprotein|apo\s?[a-z]/i, /载脂蛋白/i,
    /troponin/i, /肌钙蛋白/i,
    /ferritin/i, /铁蛋白/i,
    /transferrin/i, /转铁蛋白/i,
    /hemoglobin/i, /血红蛋白/i,
    /cd14/i, /细胞分化抗原14/i,
    /trem/i, /髓系细胞触发受体/i,
    /pentraxin/i, /正五聚蛋白/i,
    /clusterin/i, /凝聚素/i,
    /axl/i, /酪氨酸受体激酶/i,
    /tie-?2/i, /受体酪氨酸激酶/i,
    /angiopoietin/i, /促血管生成素/i,
    /vwf/i, /血管性血友病/i,
    /antithrombin/i, /抗凝血酶/i,
    /fibrinogen/i, /纤维蛋白原/i,
    /pd-?l1|cd274|b7-?h1/i,
    /b7-?1|cd80/i,
    /cd137|4-?1bb/i, /tnfrsf9/i,
    /dtk|tyro3/i,
    /fsl-?1/i, /卵泡抑制素/i,
    /igfbp/i, /胰岛素样生长因子结合蛋白/i,
    /mmp/i, /基质金属蛋白酶/i,
    /emmprin|cd147/i,
    /cd28/i, /tp44/i,
    /defensin/i, /防御素/i,
    /hmgb/i, /高迁移率族蛋白/i,
    /hif-?1/i, /低氧诱导/i,
    /hsp\d/i, /热休克蛋白/i,
    /albumin/i, /白蛋白/i, /血清白蛋白/i,
    /cystatin|cys-?c/i, /胱抑素/i,
    /complement/i, /补体/i,
    /c3a/i,
    /angiotensinogen|agt|serpina8/i,
    /b4galt1|ggtb2/i,
    /arg/i, /精氨酸酶/i,
    /bid/i,
    /bcl-?2/i,
  ];
  if (cardioTumorPatterns.some(re => re.test(name))) return '肿瘤和心血管标志物';

  // 激素和内分泌
  const hormonePatterns = [
    /cortisol|corticosterone/i, /皮质醇|皮质酮/i,
    /insulin/i, /胰岛素/i,
    /estradiol/i, /雌二醇/i,
    /progesterone/i, /孕酮|黄体酮/i,
    /testosterone/i, /睾酮/i,
    /dihydrotestosterone/i, /双氢睾酮/i,
    /acth/i, /促肾上腺皮质激素/i,
    /melatonin/i, /褪黑素/i,
    /ghrelin/i, /饥饿素/i,
    /25-?hydroxyvitamin/i, /25羟维/i,
    /npy/i, /神经肽y/i,
    /et-?1/i, /内皮素/i,
    /irisin/i, /鸢尾素/i,
    /leptin/i, /瘦素/i,
    /adiponectin/i, /脂联素/i,
    /glucagon/i, /胰高血糖素/i,
    /c-?peptide/i, /c肽/i,
    /gh|生长激素/i,
    /igf/i, /胰岛素样生长因子/i,
    /fsh|促卵泡/i,
    /lh|促黄体/i,
    /tsh|促甲状腺/i,
    /t3|t4|甲状腺激素/i,
    /parathyroid|pth/i, /甲状旁腺/i,
    /renin/i, /肾素/i,
    /aldosterone/i, /醛固酮/i,
    /dhea/i, /脱氢表雄酮/i,
    /androstenedione/i, /雄烯二酮/i,
    /prolactin/i, /催乳素/i,
    /oxytocin/i, /催产素/i,
    /vasopressin|adh/i, /抗利尿激素/i,
    /somatostatin/i, /生长抑素/i,
    /calcitonin/i, /降钙素/i,
    /vip/i, /血管活性肠肽/i,
    /substance\s*p/i, /p物质/i,
    /endothelin/i,
    /angiotensin/i, /血管紧张素/i,
  ];
  if (hormonePatterns.some(re => re.test(name))) return '激素和内分泌';

  // 免疫球蛋白
  const igPatterns = [
    /\big[agedm]\b/i, /免疫球蛋白/i,
    /\bigg\d/i,
  ];
  if (igPatterns.some(re => re.test(name))) return '免疫球蛋白和补体';

  // 神经生物学
  const neuroPatterns = [
    /amyloid/i, /淀粉样蛋白/i,
    /ngf/i, /神经生长因子/i,
    /neurotrophin/i, /神经营养因子/i,
    /synaptophysin/i, /突触素/i,
    /gfap/i, /胶质纤维/i,
    /tau/i, /tau蛋白/i,
    /synapsin/i,
    /psd-?95/i,
    /camkii/i,
    /neun/i,
    /mbp/i, /髓鞘碱性蛋白/i,
    /neurofilament/i, /神经丝/i,
  ];
  if (neuroPatterns.some(re => re.test(name))) return '神经生物学标志物';

  return '其他检测试剂盒';
}

/** 辅助试剂三级分类 */
function classifyAuxiliary(name) {
  if (/basic kit/i.test(name)) return '基础试剂盒';
  if (/buffer|washing|洗涤|封闭|拍板/i.test(name)) return '洗涤和封闭试剂';
  if (/tmb|显色|dab|荧光|酶标板|封板膜|goat anti-|hrp/i.test(name)) return '显色和检测试剂';
  return '其他辅助试剂';
}

// ============================================================
// 执行分类
// ============================================================

const products = db.prepare(`
  SELECT id, name, brand, catalogNumber, subcategory
  FROM Product
  WHERE category = 'ELISA试剂盒'
`).all();

console.log(`共 ${products.length} 个 ELISA 产品待分类\n`);

const updates = [];
const stats = {};

for (const p of products) {
  let subcategory = null;
  let type = null;

  // 1. 微孔板检测试剂盒
  if (isMicroplateAssay(p.name)) {
    subcategory = '微孔板检测试剂盒';
    type = classifyMicroplateType(p.name);
  }
  // 2. 标准品
  else if (isStandard(p.name)) {
    subcategory = 'ELISA标准品';
    type = null;
  }
  // 3. 辅助试剂
  else if (isAuxiliaryReagent(p.name, p.brand)) {
    subcategory = 'ELISA辅助试剂';
    type = classifyAuxiliary(p.name);
  }
  // 4. 物种分类
  else {
    const species = extractSpecies(p.name, p.catalogNumber);

    switch (species) {
      case 'human':
        subcategory = '人源ELISA检测试剂盒';
        type = classifyByBiomarker(p.name);
        break;
      case 'mouse':
        subcategory = '小鼠ELISA检测试剂盒';
        type = classifyByBiomarker(p.name);
        break;
      case 'rat':
        subcategory = '大鼠ELISA检测试剂盒';
        type = classifyByBiomarker(p.name);
        break;
      case 'other':
        subcategory = '其他物种ELISA检测试剂盒';
        type = classifyByBiomarker(p.name);
        break;
      default:
        subcategory = '通用ELISA检测试剂盒';
        type = classifyByBiomarker(p.name);
        break;
    }
  }

  updates.push({ id: p.id, subcategory, type, oldSub: p.subcategory });

  const key = `${subcategory} > ${type || '---'}`;
  stats[key] = (stats[key] || 0) + 1;
}

// 输出统计
console.log('分类统计:');
console.log('-'.repeat(60));
const sortedKeys = Object.keys(stats).sort();
let lastSub = '';
for (const key of sortedKeys) {
  const [sub, type] = key.split(' > ');
  if (sub !== lastSub) {
    console.log(`\n  ${sub}`);
    lastSub = sub;
  }
  console.log(`    ${type}: ${stats[key]}`);
}
console.log('\n' + '-'.repeat(60));
console.log(`总计: ${updates.length} 个产品`);

// 执行数据库更新
console.log('\n正在更新数据库...');

const updateStmt = db.prepare(`
  UPDATE Product SET subcategory = ?, type = ? WHERE id = ?
`);

const tx = db.transaction(() => {
  for (const u of updates) {
    updateStmt.run(u.subcategory, u.type, u.id);
  }
});

tx();

console.log(`已更新 ${updates.length} 个产品的分类字段`);

// 验证
const verify = db.prepare(`
  SELECT subcategory, type, COUNT(*) as cnt
  FROM Product
  WHERE category = 'ELISA试剂盒'
  GROUP BY subcategory, type
  ORDER BY subcategory, type
`).all();

console.log('\n验证 - 更新后分类分布:');
console.log('-'.repeat(60));
let lastVSub = '';
for (const row of verify) {
  if (row.subcategory !== lastVSub) {
    console.log(`\n  ${row.subcategory || '(null)'}`);
    lastVSub = row.subcategory;
  }
  console.log(`    ${row.type || '(null)'}: ${row.cnt}`);
}

db.close();
console.log('\n分类完成。');

// ============================================================
// 辅助函数
// ============================================================

function classifyMicroplateType(name) {
  const lower = name.toLowerCase();
  // 酶活性检测
  if (/dehydrogenase|kinase|synthase|phosphatase|protease|oxidase|peroxidase|invertase|amylase|glucosidase|galactosidase|n-demethylase|hydroxylase|ligase|pyrophosphorylase|transaminase|carboxylase|cholinesterase|acetylcholinesterase/i.test(name)) {
    return '酶活性检测试剂盒';
  }
  // 代谢物检测
  if (/atp|albumin|ammonia|ammonium|ascorbic|amylopectin|amylose|aniline/i.test(name)) {
    return '代谢物检测试剂盒';
  }
  return '其他微孔板检测试剂盒';
}
