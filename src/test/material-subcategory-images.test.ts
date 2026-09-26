import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  MATERIAL_SYNTHESIS_ITEM_IMAGES,
  SUBCATEGORY_IMAGES,
  getProductImageUrl,
} from '@/lib/productImage';

describe('材料合成三级分类图片', () => {
  const expectedImages: Record<string, string> = {
    '移液与液体处理': '/images/categories/subcategories/materials-pipetting-v2.webp',
    '管类与样本储存': '/images/categories/subcategories/materials-tubes-storage-v2.webp',
    '样品瓶与容器': '/images/categories/subcategories/materials-sample-containers-v2.webp',
    '微孔板与反应板': '/images/categories/subcategories/materials-reaction-plates-v2.webp',
    '细胞培养器皿': '/images/categories/subcategories/materials-cell-culture-v2.webp',
    '玻璃器皿与量器': '/images/categories/subcategories/materials-glassware-v1.webp',
    '过滤与分离耗材': '/images/categories/subcategories/materials-filtration-separation-v2.webp',
    '显微镜与成像耗材': '/images/categories/subcategories/materials-microscopy-imaging-v2.webp',
    '架子、盒子与固定工具': '/images/categories/subcategories/materials-racks-holders-v2.webp',
    '采样与检测耗材': '/images/categories/subcategories/materials-sampling-testing-v2.webp',
    '个人防护与废弃物': '/images/categories/subcategories/materials-ppe-waste-v2.webp',
    '温度、冷却与常用工具': '/images/categories/subcategories/materials-temperature-tools-v2.webp',
    '专用实验耗材': '/images/categories/subcategories/materials-specialty-consumables-v2.webp',
  };

  it('为 13 个三级分类配置指定图片', () => {
    expect(Object.fromEntries(
      Object.keys(expectedImages).map((name) => [name, SUBCATEGORY_IMAGES[name]]),
    )).toEqual(expectedImages);
  });

  it('未选择三级分类时覆盖数据库实际子分类', () => {
    expect(SUBCATEGORY_IMAGES['吸头与移液']).toBe(expectedImages['移液与液体处理']);
    expect(SUBCATEGORY_IMAGES['离心管与冻存']).toBe(expectedImages['管类与样本储存']);
    expect(SUBCATEGORY_IMAGES['容器与试剂瓶']).toBe(expectedImages['样品瓶与容器']);
    expect(SUBCATEGORY_IMAGES['酶标板与微孔板']).toBe(expectedImages['微孔板与反应板']);
    expect(SUBCATEGORY_IMAGES['细胞培养耗材']).toBe(expectedImages['细胞培养器皿']);
    expect(SUBCATEGORY_IMAGES['过滤耗材']).toBe(expectedImages['过滤与分离耗材']);
    expect(SUBCATEGORY_IMAGES['防护手套']).toBe(expectedImages['个人防护与废弃物']);
    expect(SUBCATEGORY_IMAGES['果蝇实验耗材']).toBe(expectedImages['专用实验耗材']);
  });

  it('为 260 个唯一四级项目配置独立图片', () => {
    const entries = Object.entries(MATERIAL_SYNTHESIS_ITEM_IMAGES);

    expect(entries).toHaveLength(260);
    expect(new Set(entries.map(([, image]) => image))).toHaveLength(260);
    expect(MATERIAL_SYNTHESIS_ITEM_IMAGES['移液器吸头'])
      .toBe('/images/categories/material-items/materials-item-001.webp');
    expect(MATERIAL_SYNTHESIS_ITEM_IMAGES['其他'])
      .toBe('/images/categories/material-items/materials-item-260.webp');
  });

  it('两个分类中的标本瓶共用同一张图片且全部图片文件存在', () => {
    expect(getProductImageUrl({
      imageUrl: undefined,
      category: '材料合成',
      subcategory: '标本瓶',
    })).toBe(MATERIAL_SYNTHESIS_ITEM_IMAGES['标本瓶']);

    for (const image of Object.values(MATERIAL_SYNTHESIS_ITEM_IMAGES)) {
      expect(existsSync(join(process.cwd(), 'public', image))).toBe(true);
    }
  });

  it('同名三级分类与四级项目分别使用对应图片', () => {
    expect(SUBCATEGORY_IMAGES['细胞培养器皿'])
      .toBe(expectedImages['细胞培养器皿']);
    expect(getProductImageUrl({
      imageUrl: undefined,
      category: '材料合成',
      subcategory: '细胞培养器皿',
    })).toBe(MATERIAL_SYNTHESIS_ITEM_IMAGES['细胞培养器皿']);
  });
});
