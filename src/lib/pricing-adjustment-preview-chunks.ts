export const PREVIEW_UPLOAD_CHUNK_SIZE = 400;
export const PREVIEW_UPLOAD_CHUNK_BYTES = 256 * 1024;

export type PreviewUploadSlice<TItem> = {
  catalogItems?: TItem[];
  catalogNumbers?: string[];
};

export function splitPreviewUpload<TItem>(
  input: { catalogItems?: TItem[]; catalogNumbers?: string[] },
  options?: { maxItems?: number; maxBytes?: number },
): Array<PreviewUploadSlice<TItem>> {
  const maxItems = options?.maxItems ?? PREVIEW_UPLOAD_CHUNK_SIZE;
  const maxBytes = options?.maxBytes ?? PREVIEW_UPLOAD_CHUNK_BYTES;
  const items = input.catalogItems ?? [];
  const numbers = input.catalogNumbers ?? [];
  const count = Math.max(items.length, numbers.length);
  if (count === 0 || maxItems < 1 || maxBytes < 1) return [];

  const slices: Array<PreviewUploadSlice<TItem>> = [];
  let start = 0;
  while (start < count) {
    let end = start;
    let bytes = 2;
    while (end < count && end - start < maxItems) {
      const itemBytes = end < items.length ? JSON.stringify(items[end]).length : 0;
      const numberBytes = end < numbers.length ? JSON.stringify(numbers[end]).length : 0;
      const nextBytes = itemBytes + numberBytes + 1;
      if (end > start && bytes + nextBytes > maxBytes) break;
      bytes += nextBytes;
      end += 1;
    }
    const itemSlice = items.length > 0 ? items.slice(start, Math.min(end, items.length)) : undefined;
    const numberSlice = numbers.length > 0 ? numbers.slice(start, Math.min(end, numbers.length)) : undefined;
    slices.push({
      ...(itemSlice && itemSlice.length > 0 ? { catalogItems: itemSlice } : {}),
      ...(numberSlice && numberSlice.length > 0 ? { catalogNumbers: numberSlice } : {}),
    });
    start = end;
  }
  return slices;
}

export function buildPreviewChunkBody(
  payload: Record<string, unknown>,
  slice: PreviewUploadSlice<unknown>,
  batch: { batchId?: string; chunkIndex: number; chunkCount: number },
): Record<string, unknown> {
  const rules = { ...payload };
  delete rules.catalogItems;
  delete rules.catalogNumbers;
  return {
    ...rules,
    ...(batch.batchId ? { batchId: batch.batchId } : {}),
    chunkIndex: batch.chunkIndex,
    chunkCount: batch.chunkCount,
    ...(slice.catalogItems ? { catalogItems: slice.catalogItems } : {}),
    ...(slice.catalogNumbers ? { catalogNumbers: slice.catalogNumbers } : {}),
  };
}
