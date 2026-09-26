import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

function parseCsv(source) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (char === '"' && quoted && next === '"') {
      field += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(field);
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const [headers, ...values] = rows;
  if (!headers) return [];
  return values.map((columns) => Object.fromEntries(headers.map((header, index) => [header, columns[index] ?? ''])));
}

function readCsv(filePath) {
  return parseCsv(readFileSync(filePath, 'utf8'));
}

function splitList(value) {
  return value ? value.split('；').map((item) => item.trim()).filter(Boolean) : [];
}

const researchRoot = process.env.LIBEREAL_RESEARCH_TRENDS_ROOT
  ? path.resolve(process.env.LIBEREAL_RESEARCH_TRENDS_ROOT)
  : path.resolve(process.cwd(), '..', 'libereal-life-science-trends-2020-2026');
const categoriesPath = path.join(researchRoot, 'data', 'taxonomy', 'categories.csv');
const hotspotsPath = path.join(researchRoot, 'data', 'taxonomy', 'hotspots.csv');
const sourcesPath = path.join(researchRoot, 'data', 'evidence', 'source_register.csv');
const cyclesPath = path.join(researchRoot, 'data', 'monitoring', 'review_cycles.csv');

const categoryRows = readCsv(categoriesPath).filter((row) => row.status === 'active');
const allHotspotRows = readCsv(hotspotsPath);
const hotspotRows = allHotspotRows.filter((row) => row.status === 'active' && row.decision === 'retain');
const deferredRows = allHotspotRows.filter((row) => row.decision === 'defer');
const sourceRows = readCsv(sourcesPath);
const releasedCycles = readCsv(cyclesPath).filter((row) => row.review_status === 'released');
const asOfDate = releasedCycles.map((row) => row.as_of_date).sort().at(-1);

if (!asOfDate) throw new Error('No released review cycle supplies an as-of date.');
if (categoryRows.length !== 15) throw new Error(`Expected 15 active categories, received ${categoryRows.length}.`);
if (hotspotRows.length !== 43) throw new Error(`Expected 43 retained hotspots, received ${hotspotRows.length}.`);

const hotspotCountByCategory = new Map();
for (const row of hotspotRows) {
  hotspotCountByCategory.set(row.category_id, (hotspotCountByCategory.get(row.category_id) ?? 0) + 1);
}

const categories = categoryRows.map((row) => ({
  id: row.category_id,
  nameZh: row.category_name_zh,
  nameEn: row.category_name_en,
  definition: row.definition,
  inScope: splitList(row.in_scope),
  outOfScope: splitList(row.out_of_scope),
  hotspotCount: hotspotCountByCategory.get(row.category_id) ?? 0,
}));

const hotspots = hotspotRows.map((row) => ({
  id: row.hotspot_id,
  categoryId: row.category_id,
  nameZh: row.hotspot_name_zh,
  nameEn: row.hotspot_name_en,
  summary: row.summary,
  trendSignal: row.trend_signal,
}));

const snapshot = {
  releaseId: `public-trends-${asOfDate}`,
  asOfDate,
  researchWindow: '2020–2026',
  categoryCount: categories.length,
  hotspotCount: hotspots.length,
  deferredCount: deferredRows.length,
  registeredSourceCount: sourceRows.length,
  categories,
  hotspots,
};

const outputPath = path.resolve(process.cwd(), 'src', 'data', 'knowledge', 'research-trends.generated.json');
writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
console.log(`Synced ${snapshot.categoryCount} categories and ${snapshot.hotspotCount} hotspots as of ${snapshot.asOfDate}.`);
