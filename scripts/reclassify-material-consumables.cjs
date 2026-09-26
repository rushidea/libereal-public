/* eslint-disable no-console */
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DATABASE_PATH || 'prisma/dev.db';
const APPLY = process.argv.includes('--apply');
const CHECK = process.argv.includes('--check');

const canonicalSubcategories = new Set([
  '移液与液体处理',
  '管类与样本储存',
  '样品瓶与容器',
  '微孔板与反应板',
  '细胞培养器皿',
  '玻璃器皿与量器',
  '过滤与分离耗材',
  '显微镜与成像耗材',
  '架子、盒子与固定工具',
  '采样与检测耗材',
  '个人防护与废弃物',
  '温度、冷却与常用工具',
  '专用实验耗材',
]);

const directSubcategoryMap = new Map([
  ['吸头与移液', '移液与液体处理'],
  ['离心管与冻存', '管类与样本储存'],
  ['容器与试剂瓶', '样品瓶与容器'],
  ['PCR与qPCR耗材', '微孔板与反应板'],
  ['酶标板与微孔板', '微孔板与反应板'],
  ['细胞培养耗材', '细胞培养器皿'],
  ['玻璃试管与管类', '管类与样本储存'],
  ['比色皿与光学耗材', '显微镜与成像耗材'],
  ['过滤耗材', '过滤与分离耗材'],
  ['载玻片与包埋', '显微镜与成像耗材'],
  ['防护手套', '个人防护与废弃物'],
  ['磁力与搅拌', '温度、冷却与常用工具'],
  ['冰盒与冷却', '温度、冷却与常用工具'],
  ['果蝇实验耗材', '专用实验耗材'],
  ['其他耗材', '专用实验耗材'],
]);

const typeSubcategoryMap = new Map([
  ['血清移液管', '移液与液体处理'],
  ['胶头滴管', '移液与液体处理'],
  ['自动化移液设备', '移液与液体处理'],
  ['吸球', '移液与液体处理'],

  ['玻璃试管', '管类与样本储存'],
  ['试管塞', '管类与样本储存'],
  ['试管盖', '管类与样本储存'],
  ['聚四氟乙烯标准塞', '管类与样本储存'],
  ['硅胶塞', '管类与样本储存'],
  ['迷你试管', '管类与样本储存'],
  ['血清试管', '管类与样本储存'],
  ['尿沉渣管', '管类与样本储存'],
  ['离心管', '管类与样本储存'],
  ['微量离心管/EP 管', '管类与样本储存'],
  ['样品管', '管类与样本储存'],
  ['细胞冻存管', '管类与样本储存'],
  ['淋巴细胞分离管', '管类与样本储存'],
  ['核酸剪切管', '管类与样本储存'],
  ['样本运输管', '管类与样本储存'],
  ['研磨管/核酸提取', '管类与样本储存'],

  ['试剂瓶/滴瓶', '样品瓶与容器'],
  ['储液槽/加样槽', '样品瓶与容器'],
  ['样品瓶', '样品瓶与容器'],
  ['培养基瓶', '样品瓶与容器'],
  ['样本杯', '样品瓶与容器'],
  ['玻璃高回收瓶', '样品瓶与容器'],
  ['储液瓶', '样品瓶与容器'],
  ['流动相盖子', '样品瓶与容器'],
  ['洗瓶', '样品瓶与容器'],
  ['标本瓶', '样品瓶与容器'],
  ['不锈钢灭菌盒', '样品瓶与容器'],
  ['三通旋盖', '样品瓶与容器'],
  ['瓶盖', '样品瓶与容器'],
  ['实验动物饮水瓶', '样品瓶与容器'],

  ['烧杯/烧瓶', '玻璃器皿与量器'],
  ['锥形瓶', '玻璃器皿与量器'],
  ['容量瓶', '玻璃器皿与量器'],
  ['量筒', '玻璃器皿与量器'],
  ['刻度量杯', '玻璃器皿与量器'],
  ['玻璃容器', '玻璃器皿与量器'],
  ['玻璃搅拌棒', '玻璃器皿与量器'],
  ['电泳玻璃板', '玻璃器皿与量器'],
  ['熔点毛细管', '玻璃器皿与量器'],
  ['点样毛细管', '玻璃器皿与量器'],

  ['细胞爬片', '细胞培养器皿'],
  ['塑料培养方皿', '细胞培养器皿'],

  ['三角漏斗', '过滤与分离耗材'],
  ['布氏漏斗', '过滤与分离耗材'],
  ['滤膜/滤器', '过滤与分离耗材'],
  ['过滤耗材', '过滤与分离耗材'],
  ['真空过滤器', '过滤与分离耗材'],
  ['超滤', '过滤与分离耗材'],
  ['离心管过滤器', '过滤与分离耗材'],
  ['转印膜', '过滤与分离耗材'],
  ['其他转印膜', '过滤与分离耗材'],
  ['细胞滤网', '过滤与分离耗材'],
  ['闪滤瓶', '过滤与分离耗材'],
  ['透析袋', '过滤与分离耗材'],
  ['透析袋夹', '过滤与分离耗材'],
  ['SPE 柱', '过滤与分离耗材'],
  ['亲和层析柱空柱', '过滤与分离耗材'],
  ['中压层析柱空柱', '过滤与分离耗材'],
  ['离心式蛋白纯化空柱', '过滤与分离耗材'],
  ['旋盖式蛋白纯化空柱', '过滤与分离耗材'],
  ['空柱管', '过滤与分离耗材'],
  ['核酸纯化柱', '过滤与分离耗材'],
  ['质粒过滤柱', '过滤与分离耗材'],
  ['MCE 膜', '过滤与分离耗材'],
  ['PVDF 膜', '过滤与分离耗材'],
  ['NC 膜', '过滤与分离耗材'],
  ['尼龙膜', '过滤与分离耗材'],
  ['过滤板', '过滤与分离耗材'],
  ['收集板', '过滤与分离耗材'],

  ['载玻片', '显微镜与成像耗材'],
  ['染色器材', '显微镜与成像耗材'],
  ['晾片板', '显微镜与成像耗材'],
  ['玻片标记笔', '显微镜与成像耗材'],
  ['免疫组化笔', '显微镜与成像耗材'],
  ['切片刀片', '显微镜与成像耗材'],
  ['血球计数板', '显微镜与成像耗材'],
  ['腔室载玻片', '显微镜与成像耗材'],
  ['抗原修复盒', '显微镜与成像耗材'],
  ['切片防脱笔', '显微镜与成像耗材'],

  ['试管架', '架子、盒子与固定工具'],
  ['试管沥水架', '架子、盒子与固定工具'],
  ['冻存架', '架子、盒子与固定工具'],
  ['SBS 冻存板架', '架子、盒子与固定工具'],
  ['冷冻管架', '架子、盒子与固定工具'],
  ['实验夹具', '架子、盒子与固定工具'],
  ['试管夹', '架子、盒子与固定工具'],
  ['滴定夹', '架子、盒子与固定工具'],
  ['铁架台', '架子、盒子与固定工具'],
  ['铁架台/三脚架', '架子、盒子与固定工具'],
  ['三爪夹', '架子、盒子与固定工具'],
  ['十字夹', '架子、盒子与固定工具'],
  ['止水夹', '架子、盒子与固定工具'],
  ['弹簧止水夹', '架子、盒子与固定工具'],
  ['橡胶漏斗托', '架子、盒子与固定工具'],
  ['实验室升降台', '架子、盒子与固定工具'],
  ['磁力架', '架子、盒子与固定工具'],
  ['磁棒套', '架子、盒子与固定工具'],

  ['采样袋', '采样与检测耗材'],
  ['均质袋', '采样与检测耗材'],
  ['接种环/采样棒', '采样与检测耗材'],
  ['接种环/针', '采样与检测耗材'],
  ['涂布棒', '采样与检测耗材'],
  ['生物样本子母袋', '采样与检测耗材'],
  ['精密试纸', '采样与检测耗材'],
  ['pH 试纸', '采样与检测耗材'],

  ['乳胶手套', '个人防护与废弃物'],
  ['丁腈手套', '个人防护与废弃物'],
  ['男式白大褂', '个人防护与废弃物'],
  ['女式白大褂', '个人防护与废弃物'],
  ['白大褂', '个人防护与废弃物'],
  ['口罩', '个人防护与废弃物'],
  ['鞋套', '个人防护与废弃物'],
  ['实验帽', '个人防护与废弃物'],
  ['实验废弃物袋', '个人防护与废弃物'],
  ['实验废弃物袋/桶', '个人防护与废弃物'],
  ['利器盒', '个人防护与废弃物'],
  ['高温灭菌袋', '个人防护与废弃物'],

  ['金属冰盒', '温度、冷却与常用工具'],
  ['PCR 冰盒', '温度、冷却与常用工具'],
  ['冰盒配件', '温度、冷却与常用工具'],
  ['程序降温盒', '温度、冷却与常用工具'],
  ['磁力搅拌子', '温度、冷却与常用工具'],
  ['药勺', '温度、冷却与常用工具'],
  ['称量纸', '温度、冷却与常用工具'],
  ['方形称量盘', '温度、冷却与常用工具'],
  ['船形称量盘', '温度、冷却与常用工具'],
  ['菱形称量盘', '温度、冷却与常用工具'],
  ['镊子', '温度、冷却与常用工具'],
  ['精细镊子', '温度、冷却与常用工具'],
  ['方头镊子', '温度、冷却与常用工具'],
  ['剪刀', '温度、冷却与常用工具'],
  ['刀柄', '温度、冷却与常用工具'],
  ['止血钳', '温度、冷却与常用工具'],
  ['坩埚钳', '温度、冷却与常用工具'],
  ['灌胃针', '温度、冷却与常用工具'],
  ['玛瑙研钵', '温度、冷却与常用工具'],
  ['陶瓷研钵', '温度、冷却与常用工具'],
  ['石棉网', '温度、冷却与常用工具'],
  ['硅胶/乳胶管', '温度、冷却与常用工具'],
  ['酒精灯', '温度、冷却与常用工具'],
  ['洗耳球', '温度、冷却与常用工具'],
  ['试管刷', '温度、冷却与常用工具'],
  ['吸水纸', '温度、冷却与常用工具'],
  ['擦拭纸', '温度、冷却与常用工具'],
  ['脱脂棉', '温度、冷却与常用工具'],
  ['喷壶', '温度、冷却与常用工具'],
  ['天平刷', '温度、冷却与常用工具'],
  ['定时器', '温度、冷却与常用工具'],
  ['标签打印机', '温度、冷却与常用工具'],
  ['扫码仪', '温度、冷却与常用工具'],
  ['干燥/压盖工具', '温度、冷却与常用工具'],
  ['指示胶带', '温度、冷却与常用工具'],
  ['燃烧勺', '温度、冷却与常用工具'],

  ['WB 孵育盒', '专用实验耗材'],
  ['抗体孵育袋', '专用实验耗材'],
  ['果蝇瓶', '专用实验耗材'],
  ['果蝇管', '专用实验耗材'],
  ['果蝇管/瓶塞', '专用实验耗材'],
  ['实验鼠笼', '专用实验耗材'],
  ['耳标', '专用实验耗材'],
  ['蒸馏水桶', '专用实验耗材'],
  ['实验室软件', '专用实验耗材'],
  ['U盘', '专用实验耗材'],
  ['实验室五金', '专用实验耗材'],
  ['小型离心机', '专用实验耗材'],
  ['其他', '专用实验耗材'],
]);

function targetSubcategory(row) {
  if (row.type && typeSubcategoryMap.has(row.type)) {
    return typeSubcategoryMap.get(row.type);
  }
  if (row.subcategory && directSubcategoryMap.has(row.subcategory)) {
    return directSubcategoryMap.get(row.subcategory);
  }
  return row.subcategory;
}

function timestamp() {
  return new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
}

function backupDatabase(dbPath) {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database file not found: ${dbPath}`);
  }
  const backupPath = `${dbPath}.bak.material-taxonomy-${timestamp()}`;
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.copyFileSync(dbPath, backupPath);
  return backupPath;
}

function printDistribution(db) {
  const distribution = db
    .prepare(
      "SELECT subcategory, COUNT(*) AS count FROM Product WHERE category = '材料合成' GROUP BY subcategory ORDER BY count DESC",
    )
    .all();

  console.log('\nCurrent material subcategory distribution:');
  for (const row of distribution) {
    console.log(`${String(row.count).padStart(4, ' ')}  ${row.subcategory || '(empty)'}`);
  }

  const nonCanonical = distribution.filter(
    (row) => row.subcategory && !canonicalSubcategories.has(row.subcategory),
  );
  if (nonCanonical.length > 0) {
    console.log('\nNon-canonical material subcategories:');
    for (const row of nonCanonical) {
      console.log(`${String(row.count).padStart(4, ' ')}  ${row.subcategory}`);
    }
  } else {
    console.log('\nAll material subcategories are canonical.');
  }
  return nonCanonical;
}

const db = new Database(DB_PATH);
const rows = db
  .prepare("SELECT id, subcategory, type FROM Product WHERE category = '材料合成'")
  .all();

const changes = rows
  .map((row) => ({ ...row, nextSubcategory: targetSubcategory(row) }))
  .filter((row) => row.nextSubcategory && row.nextSubcategory !== row.subcategory);

const summary = new Map();
for (const row of changes) {
  const key = `${row.subcategory} -> ${row.nextSubcategory}`;
  summary.set(key, (summary.get(key) || 0) + 1);
}

console.log(`Database: ${DB_PATH}`);
console.log(`Material products scanned: ${rows.length}`);
console.log(`Products to update: ${changes.length}`);
for (const [key, count] of [...summary.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`${String(count).padStart(4, ' ')}  ${key}`);
}

if (changes.length === 0) {
  const nonCanonical = printDistribution(db);
  if (CHECK && nonCanonical.length > 0) {
    console.error('\nCheck failed: non-canonical material subcategories remain.');
    process.exit(1);
  }
  console.log('\nNo material taxonomy updates needed.');
  process.exit(0);
}

if (!APPLY) {
  printDistribution(db);
  console.log('\nDry run only. Re-run with --apply to update the database.');
  if (CHECK) {
    console.error('Check failed: pending material taxonomy updates exist.');
    process.exit(1);
  }
  process.exit(0);
}

const backupPath = backupDatabase(DB_PATH);
console.log(`\nSQLite backup created: ${backupPath}`);

const update = db.prepare('UPDATE Product SET subcategory = ?, updatedAt = ? WHERE id = ?');
const now = new Date().toISOString();
const transaction = db.transaction((items) => {
  for (const item of items) {
    update.run(item.nextSubcategory, now, item.id);
  }
});

transaction(changes);
console.log(`\nUpdated ${changes.length} products.`);

const nonCanonical = printDistribution(db);
if (nonCanonical.length > 0) {
  console.error('\nUpdate finished, but non-canonical material subcategories remain.');
  process.exit(1);
}
