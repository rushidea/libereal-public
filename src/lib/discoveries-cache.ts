import fs from 'node:fs';
import path from 'node:path';
import type { DiscoveryCacheData } from '@/data/discoveries';

const CACHE_FILE = path.join(process.cwd(), 'src/data/discoveries-cache.json');
const CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;

export function readDiscoveryCache(options?: { allowStale?: boolean }): DiscoveryCacheData | null {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) as DiscoveryCacheData;
    if (!Array.isArray(data.discoveries) || !data.updatedAt || !data.sources) return null;
    const age = Date.now() - new Date(data.updatedAt).getTime();
    if (!options?.allowStale && (!Number.isFinite(age) || age > CACHE_MAX_AGE_MS)) return null;
    return data;
  } catch (error) {
    console.error('[Discoveries cache] Read failed:', error);
    return null;
  }
}

export function writeDiscoveryCache(data: DiscoveryCacheData): void {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error('[Discoveries cache] Write failed:', error);
  }
}
