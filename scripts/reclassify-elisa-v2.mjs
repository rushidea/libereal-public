#!/usr/bin/env node
/**
 * ELISA 产品重新分类脚本 v2
 *
 * 三级 (subcategory): 恢复原 ELISA 方法分类
 *   - 夹心法ELISA
 *   - 竞争法ELISA
 *   - 抗体对和蛋白标准品
 *   - 抗体芯片
 *   - ELISA辅助试剂
 *
 * 四级-应用 (type): 5 个应用分类
 *   - 细胞因子和趋化因子
 *   - 肿瘤和心血管标志物
 *   - 激素和内分泌
 *   - 免疫球蛋白和补体
 *   - 其他检测试剂盒
 *
 * 四级-种属 (speciesReactivity): 5 个种属
 *   - 人
 *   - 小鼠
 *   - 大鼠
 *   - 其他物种
 *   - 通用
 */

import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), 'prisma', 'dev.db');

const db = new Database(DB_PATH);

// ============================================================
// 种属提取
// ============================================================

// Biosharp 货号前缀 → 种属
const BIOSHARP_PREFIX_SPECIES = {
  BQEH: '人', BXEH: '人',
  BQEM: '小鼠', BXEM: '小鼠',
  BQER: '大鼠',
  BQEA: '其他物种', // Rabbit
  BQEC: '其他物种', BQEK: '其他物种', // Chicken
  BQEB: '其他物种', // Bovine
  BQEP: '其他物种', // Pig
  BQEG: '其他物种', // Guinea pig
  BQEF: '其他物种', // Feline/Cat
  BQED: '其他物种', // Dog/Canine
  BQET: '其他物种', // Turtle
  BXEY: '其他物种', // Monkey
  BQEN: '通用', BSEN: '通用',
};

function extractSpecies(name, catalogNumber, brand) {
  // 1. Biosharp 货号前缀优先
  if (brand === 'Biosharp' && catalogNumber) {
    const prefix = catalogNumber.substring(0, 4).toUpperCase();
    if (BIOSHARP_PREFIX_SPECIES[prefix]) {
      return BIOSHARP_PREFIX_SPECIES[prefix];
    }
  }

  const lower = name.toLowerCase();

  // 2. 从产品名提取物种关键词
  // 多物种时取第一个出现的物种
  const speciesPatterns = [
    { pattern: /human/i, cn: /人/, value: '人' },
    { pattern: /mouse/i, cn: /小鼠/, value: '小鼠' },
    { pattern: /\brat\b/i, cn: /大鼠/, value: '大鼠' },
    { pattern: /rabbit/i, cn: /兔/, value: '其他物种' },
    { pattern: /pig\b|swine/i, cn: /猪/, value: '其他物种' },
    { pattern: /chicken/i, cn: /鸡/, value: '其他物种' },
    { pattern: /bovine|cow/i, cn: /牛/, value: '其他物种' },
    { pattern: /guinea\s*pig/i, cn: /豚鼠/, value: '其他物种' },
    { pattern: /dog|canine/i, cn: /狗/, value: '其他物种' },
    { pattern: /cat|feline/i, cn: /猫/, value: '其他物种' },
    { pattern: /monkey/i, cn: /猴/, value: '其他物种' },
  ];

  // 按产品名中物种出现的顺序，取第一个
  let firstMatch = null;
  let firstIndex = Infinity;

  for (const sp of speciesPatterns) {
    const enMatch = name.match(sp.pattern);
    const cnMatch = name.match(sp.cn);
    const enIdx = enMatch ? enMatch.index : -1;
    const cnIdx = cnMatch ? cnMatch.index : -1;
    const minIdx = enIdx >= 0 && cnIdx >= 0 ? Math.min(enIdx, cnIdx) : (enIdx >= 0 ? enIdx : cnIdx);

    if (minIdx >= 0 && minIdx < firstIndex) {
      firstIndex = minIdx;
      firstMatch = sp.value;
    }
  }

  if (firstMatch) return firstMatch;

  // 3. 无物种信息
  return '通用';
}

// ============================================================
// 三级分类 (subcategory)
// ============================================================

function classifySubcategory(name, brand) {
  const lower = name.toLowerCase();

  // 1. 竞争法ELISA: 包含 Competitive 且包含 ELISA
  if (/competitive/i.test(name) && /elisa/i.test(name)) {
    return '竞争法ELISA';
  }

  // 2. 抗体芯片: 包含 Array 或 芯片
  if (/array/i.test(name) || /芯片/.test(name)) {
    return '抗体芯片';
  }

  // 3. 抗体对和蛋白标准品: 包含 standard 或 Standard Set，且不是 ELISA Kit
  const isStandard = /\bstandard\b/i.test(name) && !/elisa\s*kit/i.test(name);
  const isStandardSet = /standard\s*set/i.test(name);
  if (isStandard || isStandardSet) {
    return '抗体对和蛋白标准品';
  }

  // 4. ELISA辅助试剂
  const accessoryKeywords = [
    /buffer/i, /washing/i, /封闭/, /拍板/,
    /basic\s*kit/i, /hrp/i, /goat\s*anti/i,
    /封闭缓冲液/, /洗涤液/,
  ];
  if (accessoryKeywords.some(re => re.test(name))) {
    return 'ELISA辅助试剂';
  }

  // Sigma-Aldrich 品牌中不含 ELISA Kit 的产品归入辅助试剂
  if (brand === 'Sigma-Aldrich' && !/elisa\s*kit/i.test(name) && !/检测试剂盒/.test(name)) {
    return 'ELISA辅助试剂';
  }

  // 5. 夹心法ELISA: 默认
  return '夹心法ELISA';
}

// ============================================================
// 四级-应用 (type)
// ============================================================

function classifyType(name) {
  const lower = name.toLowerCase();

  // 辅助试剂和标准品的 type 逻辑：
  // 如果是辅助试剂（由 subcategory 判断），type 为空
  // 如果是标准品，按检测指标分类

  // 细胞因子和趋化因子
  const cytokinePatterns = [
    /\bIL[-\s]?\d/i, /\bIL[-\s]?1\b/i, /\bIL[-\s]?2\b/i, // Interleukin
    /\bTNF/i, /\bIFN[-\s]/i, /\binterferon/i,
    /\bVEGF/i, /\bTGF[-\s]?[βb]/i, /\bEGF/i, /\bFGF/i,
    /\bGM[-\s]?CSF/i, /\bMCP[-\s]?\d/i, /\bMIP[-\s]/i,
    /\bRANTES/i, /\bGRO/i, /\bCXCL/i, /\bCCL/i,
    /\bCSF\b/i, /\bSCF\b/i, /\bPDGF/i, /\bHGF/i,
    /\bLIF\b/i, /\bOSM\b/i, /\bFLT/i,
    /\b4[-\s]?1BB/i, /\bTNFRSF/i, /\bCD25\b/i, /\bCD40L/i,
    /\bsCD163/i, /\bsTNF/i, /\bsIL/i, /\bTRAIL/i, /\bFasL/i,
    /\bBAFF/i, /\bAPRIL/i, /\bLIGHT/i, /\bOPG/i,
    /\bBMP[-\s]?\d/i, // BMP 也归入细胞因子（生长因子类）
    /\bGDF/i, /\bActivin/i, // 这些也可以归入激素，但按传统分类归入细胞因子
    /\bsVCAM/i, /\bsICAM/i, /\bMMP/i,
  ];
  if (cytokinePatterns.some(re => re.test(name))) {
    return '细胞因子和趋化因子';
  }

  // 肿瘤和心血管标志物
  const tumorCardiacPatterns = [
    /\bCA\s*15[-\s]?3/i, /\bCA\s*125/i, /\bCA\s*19[-\s]?9/i, /\bCA\s*72[-\s]?4/i,
    /\bCEA\b/i, /\bAFP\b/i, /\bPSA\b/i, /\bPSMA\b/i,
    /\bCRP\b/i, /\bhs[-\s]?CRP/i, /\bC[-\s]?reactive/i,
    /\bPCT\b/i, /\bprocalcitonin/i, /\bCys[-\s]?C/i, /\bcystatin/i,
    /\bCD14\b/i, /\bBNP\b/i, /\bNT[-\s]?proBNP/i,
    /\btroponin/i, /\bET[-\s]?1\b/i, /\bendothelin/i,
    /\bangiopoietin/i, /\bANG[-\s]?\d/i,
    /\bApo\s*[AB]/i, /\bapolipoprotein/i,
    /\bantithrombin/i, /\bangiotensinogen/i, /\bAGT\b/i, /\bSerpinA/i,
    /\bsFLT/i, /\bPLGF/i, /\bPAPP/i, /\bHE4/i,
    /\bD[-\s]?dimer/i, /\bfibrinogen/i, /\bvWF/i,
    /\bCK[-\s]?MB/i, /\bmyoglobin/i, /\bH-FABP/i,
    /\bS100/i, /\bNSE/i, /\bCYFRA/i,
    /\bHEPCIDIN/i, /\bFerritin/i, /\bTransferrin/i,
  ];
  if (tumorCardiacPatterns.some(re => re.test(name))) {
    return '肿瘤和心血管标志物';
  }

  // 激素和内分泌
  const hormonePatterns = [
    /\bcortisol/i, /\binsulin/i, /\bglucagon/i,
    /\btestosterone/i, /\bestradiol/i, /\bprogesterone/i,
    /\bT3\b/i, /\bT4\b/i, /\bTSH\b/i, /\bthyroid/i,
    /\bPGE2\b/i, /\bprostaglandin/i,
    /\badiponectin/i, /\bleptin/i, /\bghrelin/i,
    /\bGH\b/i, /\bgrowth\s*hormone/i,
    /\bFSH\b/i, /\bLH\b/i, /\bhCG\b/i, /\bHCG\b/i,
    /\bACTH/i, /\bDHEA/i, /\bandrostenedione/i,
    /\baldosterone/i, /\brenin/i, /\bangiotensin/i,
    /\bPTH\b/i, /\bparathyroid/i, /\bcalcitonin/i,
    /\bVitamin\s*D/i, /\b25[-\s]?OH/i,
    /\bestrone/i, /\bestriol/i,
    /\bInhibin/i,
    /\bOxytocin/i, /\bVasopressin/i, /\bADH\b/i,
  ];
  if (hormonePatterns.some(re => re.test(name))) {
    return '激素和内分泌';
  }

  // 免疫球蛋白和补体
  const igComplementPatterns = [
    /\bIg[GADM]\b/i, /\bIgE\b/i, /\bimmunoglobulin/i,
    /\bcomplement/i, /\bC3\b/i, /\bC4\b/i, /\bC5\b/i,
    /\bFactor\s*[BHDP]/i, /\bproperdin/i,
  ];
  if (igComplementPatterns.some(re => re.test(name))) {
    return '免疫球蛋白和补体';
  }

  // 其他检测试剂盒
  return '其他检测试剂盒';
}

// ============================================================
// 主逻辑
// ============================================================

const products = db.prepare(`
  SELECT id, catalogNumber, name, brand, subcategory, type, speciesReactivity
  FROM Product
  WHERE category = 'ELISA试剂盒'
`).all();

console.log(`Total ELISA products: ${products.length}`);

const stats = {
  subcategory: {},
  type: {},
  speciesReactivity: {},
  changes: { sub: 0, type: 0, species: 0 },
};

const updateStmt = db.prepare(`
  UPDATE Product
  SET subcategory = ?, type = ?, speciesReactivity = ?, updatedAt = datetime('now')
  WHERE id = ?
`);

const tx = db.transaction(() => {
  for (const p of products) {
    const newSub = classifySubcategory(p.name, p.brand);

    // 辅助试剂的 type 为空
    let newType;
    if (newSub === 'ELISA辅助试剂') {
      newType = null;
    } else {
      newType = classifyType(p.name);
    }

    const newSpecies = extractSpecies(p.name, p.catalogNumber, p.brand);

    // 统计变化
    if (p.subcategory !== newSub) stats.changes.sub++;
    if (p.type !== newType) stats.changes.type++;
    if ((p.speciesReactivity || '') !== newSpecies) stats.changes.species++;

    // 统计分布
    stats.subcategory[newSub] = (stats.subcategory[newSub] || 0) + 1;
    stats.type[newType || '(空)'] = (stats.type[newType || '(空)'] || 0) + 1;
    stats.speciesReactivity[newSpecies] = (stats.speciesReactivity[newSpecies] || 0) + 1;

    updateStmt.run(newSub, newType, newSpecies, p.id);
  }
});

tx();

console.log('\n=== Changes ===');
console.log(`subcategory changed: ${stats.changes.sub}`);
console.log(`type changed: ${stats.changes.type}`);
console.log(`speciesReactivity changed: ${stats.changes.species}`);

console.log('\n=== subcategory distribution ===');
Object.entries(stats.subcategory).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
  console.log(`  ${k}: ${v}`);
});

console.log('\n=== type distribution ===');
Object.entries(stats.type).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
  console.log(`  ${k}: ${v}`);
});

console.log('\n=== speciesReactivity distribution ===');
Object.entries(stats.speciesReactivity).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
  console.log(`  ${k}: ${v}`);
});

db.close();
console.log('\nDone.');
