import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const researchRoot = process.env.LIBEREAL_RESEARCH_TRENDS_ROOT
  ? path.resolve(process.env.LIBEREAL_RESEARCH_TRENDS_ROOT)
  : path.resolve(process.cwd(), '..', 'libereal-life-science-trends-2020-2026');

const inputPath = path.join(researchRoot, 'data', 'frontend', 'research_trends_b03_snapshot.json');
const outputPath = path.resolve(process.cwd(), 'src', 'data', 'knowledge', 'research-trends-b03.generated.json');
const snapshot = JSON.parse(readFileSync(inputPath, 'utf8'));

if (snapshot.schema_version !== 'research-deep-dive-public-v0.1') {
  throw new Error(`Unsupported B03 schema: ${snapshot.schema_version}`);
}
if (snapshot.batch_id !== 'B03' || snapshot.publication_status !== 'snapshot_ready') {
  throw new Error('B03 snapshot is not approved for frontend synchronization.');
}
if (!Array.isArray(snapshot.topics) || snapshot.topics.length !== 4) {
  throw new Error(`Expected 4 B03 topics, received ${snapshot.topics?.length ?? 0}.`);
}

const forbiddenKeys = new Set([
  'review_status', 'review_notes', 'model', 'prompt', 'product_id', 'catalog_number',
  'price', 'target_marker', 'customer_service', 'evidence_score', 'evidence_map',
]);
const inspect = (value, location = 'root') => {
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspect(item, `${location}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (forbiddenKeys.has(key.toLowerCase())) {
      throw new Error(`Forbidden public snapshot field: ${location}.${key}`);
    }
    inspect(item, `${location}.${key}`);
  }
};

const topicIds = new Set();
for (const topic of snapshot.topics) {
  if (!topic.topic_id || topicIds.has(topic.topic_id)) throw new Error(`Invalid topic ID: ${topic.topic_id}`);
  topicIds.add(topic.topic_id);
  if (!topic.title || !topic.overview || !Array.isArray(topic.sections) || topic.sections.length === 0) {
    throw new Error(`${topic.topic_id} is missing public content.`);
  }
  if (!Array.isArray(topic.methods) || topic.methods.length !== 5 || !Array.isArray(topic.references) || topic.references.length !== 20) {
    throw new Error(`${topic.topic_id} is missing its 5 methods or 20 references.`);
  }
  const referenceIds = new Set(topic.references.map((reference) => reference.source_id));
  const sourceIds = [
    ...topic.sections.flatMap((section) => section.source_ids),
    ...topic.methods.flatMap((method) => method.source_ids),
  ];
  for (const sourceId of sourceIds) {
    if (!referenceIds.has(sourceId)) throw new Error(`${topic.topic_id} references missing source ${sourceId}.`);
  }
}

inspect(snapshot);
writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
console.log(`Synced B03 with ${snapshot.topics.length} topics, ${snapshot.topics.reduce((sum, topic) => sum + topic.methods.length, 0)} methods and ${snapshot.topics.reduce((sum, topic) => sum + topic.references.length, 0)} references.`);
