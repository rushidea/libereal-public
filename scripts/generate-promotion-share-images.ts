#!/usr/bin/env npx tsx
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import sharp from 'sharp';

type CardConfig = {
  slug: string;
  source: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  background: string;
  accent: string;
  sourceLabel: string;
  contain?: boolean;
};

const root = process.cwd();
const outputDir = path.join(root, 'public/images/promotions/share');

const cards: CardConfig[] = [
  {
    slug: 'fisher-bioreagents',
    source: 'public/images/promotions/fisher-bioreagents/hero-illustration.png',
    eyebrow: 'FISHER BIOREAGENTS',
    title: '常用科研试剂专场',
    subtitle: '分子生物学 · 细胞培养 · 蛋白研究',
    background: '#edf7f3',
    accent: '#08745b',
    sourceLabel: '插画由 AI 生成',
  },
  {
    slug: 'biosharp-labselect',
    source: 'public/images/promotions/biosharp-labselect/hero-illustration.png',
    eyebrow: 'BIOSHARP × LABSELECT',
    title: 'WB 与细胞培养限时福利',
    subtitle: 'Marker · 转印膜 · 培养耗材',
    background: '#edf5fb',
    accent: '#155a8a',
    sourceLabel: '插画由 AI 生成',
  },
  {
    slug: 'xianzhi-biotechnology',
    source: 'public/images/promotions/xianzhi-biotechnology/product-circle.png',
    eyebrow: 'GOODHERE BIOTECHNOLOGY',
    title: '金标内参抗体专场',
    subtitle: 'GAPDH 一抗 · HRP 二抗',
    background: '#e9f2f7',
    accent: '#0d5680',
    sourceLabel: '产品示意图',
    contain: true,
  },
];

function escapeXml(value: string): string {
  return value.replace(/[<>&'\"]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[char] ?? char);
}

function overlaySvg(width: number, height: number, card: CardConfig): Buffer {
  const square = width === height;
  const left = square ? 44 : 64;
  const titleY = square ? 405 : 390;
  const titleSize = square ? 42 : 54;
  const subtitleY = titleY + (square ? 58 : 68);
  return Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="shade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="${card.background}" stop-opacity="0.98"/>
          <stop offset="0.54" stop-color="${card.background}" stop-opacity="0.88"/>
          <stop offset="1" stop-color="${card.background}" stop-opacity="0.16"/>
        </linearGradient>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#shade)"/>
      <rect x="${left}" y="${square ? 42 : 52}" width="52" height="5" rx="2.5" fill="${card.accent}"/>
      <text x="${left}" y="${square ? 88 : 104}" fill="${card.accent}" font-family="Arial, PingFang SC, sans-serif" font-size="${square ? 15 : 18}" font-weight="700" letter-spacing="2">${escapeXml(card.eyebrow)}</text>
      <text x="${left}" y="${titleY}" fill="#102b3b" font-family="Arial, PingFang SC, sans-serif" font-size="${titleSize}" font-weight="700">${escapeXml(card.title)}</text>
      <text x="${left}" y="${subtitleY}" fill="#496675" font-family="Arial, PingFang SC, sans-serif" font-size="${square ? 20 : 24}">${escapeXml(card.subtitle)}</text>
      <text x="${left}" y="${height - 44}" fill="${card.accent}" font-family="Arial, sans-serif" font-size="18" font-weight="700" letter-spacing="1">LIBEREAL</text>
      <rect x="${width - 190}" y="${height - 72}" width="170" height="44" rx="8" fill="${card.background}" fill-opacity="0.94"/>
      <text x="${width - 42}" y="${height - 44}" text-anchor="end" fill="#718892" font-family="Arial, PingFang SC, sans-serif" font-size="13">${escapeXml(card.sourceLabel)}</text>
    </svg>
  `);
}

async function render(card: CardConfig, width: number, height: number, suffix: string): Promise<void> {
  const sourcePath = path.join(root, card.source);
  const sourceWidth = card.contain ? Math.round(Math.min(width, height) * 0.64) : width;
  const sourceHeight = card.contain ? sourceWidth : height;
  const source = await sharp(sourcePath)
    .resize(sourceWidth, sourceHeight, { fit: card.contain ? 'contain' : 'cover', position: 'centre' })
    .png()
    .toBuffer();
  const composites: sharp.OverlayOptions[] = card.contain
    ? [{ input: source, left: width - sourceWidth - Math.round(width * 0.05), top: Math.round((height - sourceHeight) / 2) }]
    : [{ input: source, left: 0, top: 0 }];
  composites.push({ input: overlaySvg(width, height, card), left: 0, top: 0 });

  await sharp({ create: { width, height, channels: 3, background: card.background } })
    .composite(composites)
    .jpeg({ quality: 84, progressive: true, chromaSubsampling: '4:4:4' })
    .toFile(path.join(outputDir, `${card.slug}-${suffix}.jpg`));
}

async function main(): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  for (const card of cards) {
    await render(card, 1200, 630, 'og');
    await render(card, 600, 600, 'wechat');
  }
}

void main();
