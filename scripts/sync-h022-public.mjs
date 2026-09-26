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

function splitIds(value) {
  return value.split(';').map((item) => item.trim()).filter(Boolean);
}

function requireFields(rows, fields, label) {
  if (rows.length === 0) throw new Error(`${label} has no rows.`);
  for (const field of fields) {
    if (!(field in rows[0])) throw new Error(`${label} is missing required field ${field}.`);
  }
}

function requireUnique(rows, field, label) {
  const values = rows.map((row) => row[field]);
  if (values.some((value) => !value)) throw new Error(`${label} contains an empty ${field}.`);
  if (new Set(values).size !== values.length) throw new Error(`${label} contains duplicate ${field} values.`);
}

const researchRoot = process.env.LIBEREAL_RESEARCH_TRENDS_ROOT
  ? path.resolve(process.env.LIBEREAL_RESEARCH_TRENDS_ROOT)
  : path.resolve(process.cwd(), '..', 'libereal-life-science-trends-2020-2026');
const h022Root = path.join(researchRoot, 'deep-dives', 'H022');
const themeRows = readCsv(path.join(h022Root, 'spatial_immune_themes.csv'));
const methodRows = readCsv(path.join(h022Root, 'spatial_methods.csv'));
const sourceRows = readCsv(path.join(h022Root, 'sources.csv'));

requireFields(themeRows, [
  'unit_id', 'display_order', 'title', 'location', 'immune_difference',
  'cross_cancer_commonality', 'cancer_variation', 'research_value', 'source_ids',
  'publication_status', 'review_status', 'version',
], 'H022 spatial themes');
requireUnique(themeRows, 'unit_id', 'H022 spatial themes');
if (themeRows.length !== 5) throw new Error(`Expected 5 spatial themes, received ${themeRows.length}.`);
for (const row of themeRows) {
  if (row.publication_status !== 'public_ready' || row.review_status !== 'sol_reviewed') {
    throw new Error(`H022 spatial themes contains an unapproved row: ${row.unit_id}.`);
  }
}

requireFields(methodRows, [
  'method_id', 'display_order', 'category', 'title', 'summary', 'principle', 'answers',
  'sample_design', 'workflow', 'quality_control', 'result_interpretation', 'limitations',
  'source_ids', 'publication_status', 'review_status', 'version',
], 'H022 spatial methods');
requireUnique(methodRows, 'method_id', 'H022 spatial methods');
if (methodRows.length !== 6) throw new Error(`Expected 6 spatial methods, received ${methodRows.length}.`);
for (const row of methodRows) {
  if (row.publication_status !== 'public_ready' || row.review_status !== 'sol_reviewed') {
    throw new Error(`H022 spatial methods contains an unapproved row: ${row.method_id}.`);
  }
}

requireFields(sourceRows, [
  'source_id', 'source_type', 'title', 'authors_or_group', 'journal',
  'published_date', 'doi', 'status',
], 'H022 sources');
requireUnique(sourceRows, 'source_id', 'H022 sources');
const sourceById = new Map(sourceRows.map((row) => [row.source_id, row]));
const referencedSourceIds = [...new Set([
  ...themeRows.flatMap((row) => splitIds(row.source_ids)),
  ...methodRows.flatMap((row) => splitIds(row.source_ids)),
])];

for (const sourceId of referencedSourceIds) {
  const source = sourceById.get(sourceId);
  if (!source) throw new Error(`Missing source ${sourceId}.`);
  if (source.status !== 'screened') throw new Error(`Source ${sourceId} is not approved for public inclusion.`);
  if (!['primary_research', 'review'].includes(source.source_type)) {
    throw new Error(`Source ${sourceId} has unsupported public source type ${source.source_type}.`);
  }
  if (!source.doi) throw new Error(`Source ${sourceId} does not have a DOI.`);
}

const cycles = readCsv(path.join(researchRoot, 'data', 'monitoring', 'review_cycles.csv'))
  .filter((row) => row.review_status === 'released');
const asOfDate = cycles.map((row) => row.as_of_date).sort().at(-1);
if (!asOfDate) throw new Error('No released review cycle supplies an as-of date.');

const spatialThemes = themeRows
  .sort((left, right) => Number(left.display_order) - Number(right.display_order))
  .map((row) => ({
    id: row.unit_id,
    displayOrder: Number(row.display_order),
    title: row.title,
    location: row.location,
    immuneDifference: row.immune_difference,
    commonality: row.cross_cancer_commonality,
    variation: row.cancer_variation,
    researchValue: row.research_value,
    sourceIds: splitIds(row.source_ids),
  }));

const spatialMethods = methodRows
  .sort((left, right) => Number(left.display_order) - Number(right.display_order))
  .map((row) => ({
    id: row.method_id,
    displayOrder: Number(row.display_order),
    category: row.category,
    title: row.title,
    summary: row.summary,
    principle: row.principle,
    answers: row.answers,
    sampleDesign: row.sample_design,
    workflow: row.workflow,
    qualityControl: row.quality_control,
    resultInterpretation: row.result_interpretation,
    limitations: row.limitations,
    sourceIds: splitIds(row.source_ids),
  }));

const references = referencedSourceIds
  .map((sourceId) => sourceById.get(sourceId))
  .sort((left, right) => left.published_date.localeCompare(right.published_date) || left.source_id.localeCompare(right.source_id))
  .map((row, index) => ({
    number: index + 1,
    id: row.source_id,
    sourceType: row.source_type,
    title: row.title,
    citation: `${row.authors_or_group} ${row.journal}`,
    year: Number(row.published_date.slice(0, 4)),
    doi: row.doi,
    url: `https://doi.org/${row.doi}`,
  }));

const snapshot = {
  releaseId: `h022-public-${asOfDate}-v0.8-sol`,
  asOfDate,
  researchWindow: '2020–2026',
  categoryId: 'C08',
  hotspotId: 'H022',
  title: '肿瘤空间免疫',
  subtitle: '不同组织部位形成不同的免疫状态',
  summary: '肿瘤中的免疫反应呈明显的区域差异。肿瘤实质区、侵袭边缘、邻近基质、血管周围区域、纤维化或低氧区和三级淋巴结构（TLS），常有不同的细胞组成和信号环境。空间免疫研究关注哪些免疫细胞能够进入肿瘤、停在哪里、与哪些细胞接触，以及这些关系如何随癌症类型、病灶和治疗改变。',
  scopeNote: '本页综合多种癌症的代表性研究，重点比较不同组织部位的免疫状态，以及跨癌症反复出现的共性和差异。',
  spatialThemes,
  spatialMethods,
  references,
};

const forbiddenOutputKeys = new Set([
  'productid', 'catalognumber', 'price', 'originalprice', 'promotionalprice', 'costprice',
  'minimumsaleprice', 'stockquantity', 'instock', 'order', 'customer', 'scoreaverage',
  'momentum', 'evidencequality',
]);
const inspectKeys = (value, location = 'root') => {
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectKeys(item, `${location}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (forbiddenOutputKeys.has(key.toLowerCase())) throw new Error(`Forbidden public snapshot field: ${location}.${key}`);
    inspectKeys(item, `${location}.${key}`);
  }
};
inspectKeys(snapshot);

const outputPath = path.resolve(process.cwd(), 'src', 'data', 'knowledge', 'tumor-spatial-immunity.generated.json');
writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
console.log(`Synced H022 with ${spatialThemes.length} spatial themes, ${spatialMethods.length} methods and ${references.length} representative references.`);
