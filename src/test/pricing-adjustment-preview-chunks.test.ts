import { describe, expect, it } from 'vitest';
import { buildPreviewChunkBody, splitPreviewUpload } from '@/lib/pricing-adjustment-preview-chunks';

describe('pricing adjustment preview chunks', () => {
  it('keeps short sheets in one slice', () => {
    expect(splitPreviewUpload({ catalogItems: [{ catalogNumber: 'A' }, { catalogNumber: 'B' }] }, { maxItems: 2 })).toEqual([
      { catalogItems: [{ catalogNumber: 'A' }, { catalogNumber: 'B' }] },
    ]);
  });

  it('splits rows in order and keeps catalog numbers aligned', () => {
    const slices = splitPreviewUpload({
      catalogItems: [{ catalogNumber: 'A' }, { catalogNumber: 'B' }, { catalogNumber: 'C' }],
      catalogNumbers: ['A', 'B', 'C'],
    }, { maxItems: 2 });
    expect(slices).toEqual([
      {
        catalogItems: [{ catalogNumber: 'A' }, { catalogNumber: 'B' }],
        catalogNumbers: ['A', 'B'],
      },
      {
        catalogItems: [{ catalogNumber: 'C' }],
        catalogNumbers: ['C'],
      },
    ]);
  });

  it('starts a new slice when the byte budget is full', () => {
    const slices = splitPreviewUpload({
      catalogItems: [{ catalogNumber: 'AAAA' }, { catalogNumber: 'BBBB' }],
    }, { maxItems: 10, maxBytes: 20 });
    expect(slices).toHaveLength(2);
    expect(slices[0]?.catalogItems).toEqual([{ catalogNumber: 'AAAA' }]);
    expect(slices[1]?.catalogItems).toEqual([{ catalogNumber: 'BBBB' }]);
  });

  it('builds a chunk body without the rest of the sheet', () => {
    const body = buildPreviewChunkBody({
      brand: 'CST',
      scope: 'catalog',
      mode: 'file',
      reason: '按表格调价',
      catalogItems: [{ catalogNumber: 'A' }, { catalogNumber: 'B' }],
      catalogNumbers: ['A', 'B'],
    }, {
      catalogItems: [{ catalogNumber: 'B' }],
    }, {
      chunkIndex: 1,
      chunkCount: 2,
    });
    expect(body).toMatchObject({
      brand: 'CST',
      mode: 'file',
      chunkIndex: 1,
      chunkCount: 2,
      catalogItems: [{ catalogNumber: 'B' }],
    });
    expect(body.catalogNumbers).toBeUndefined();
    expect(body.batchId).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('"catalogNumber":"A"');
  });
});
