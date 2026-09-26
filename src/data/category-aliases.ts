const SUBCATEGORY_ALIASES: Record<string, string[]> = {
  移液与液体处理: ['吸头与移液'],
  管类与样本储存: ['离心管与冻存', '玻璃试管与管类'],
  样品瓶与容器: ['容器与试剂瓶'],
  微孔板与反应板: ['酶标板与微孔板', 'PCR与qPCR耗材'],
  细胞培养器皿: ['细胞培养耗材'],
  玻璃器皿与量器: ['容器与试剂瓶', '玻璃试管与管类'],
  过滤与分离耗材: ['过滤耗材'],
  显微镜与成像耗材: ['载玻片与包埋', '比色皿与光学耗材'],
  '架子、盒子与固定工具': ['其他耗材', '冰盒与冷却', '磁力与搅拌'],
  采样与检测耗材: ['其他耗材'],
  个人防护与废弃物: ['防护手套'],
  '温度、冷却与常用工具': ['冰盒与冷却', '磁力与搅拌', '其他耗材'],
  专用实验耗材: ['果蝇实验耗材', '其他耗材'],
};

const REVERSE_SUBCATEGORY_ALIASES = Object.entries(SUBCATEGORY_ALIASES).reduce(
  (acc, [displayName, aliases]) => {
    aliases.forEach((alias) => {
      acc[alias] = [...(acc[alias] ?? []), displayName];
    });
    return acc;
  },
  {} as Record<string, string[]>,
);

export function getSubcategoryQueryValues(subcategory: string): string[] {
  const values = [
    subcategory,
    ...(SUBCATEGORY_ALIASES[subcategory] ?? []),
    ...(REVERSE_SUBCATEGORY_ALIASES[subcategory] ?? []),
  ];
  return [...new Set(values.filter(Boolean))];
}

export function getDisplaySubcategoryAliases(subcategory: string): string[] {
  return SUBCATEGORY_ALIASES[subcategory] ?? [];
}

/** 旧子分类名若只对应一个现行名称，则返回该名称；一对多时返回空。 */
export function uniqueCanonicalSubcategory(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  if (trimmed in SUBCATEGORY_ALIASES) return trimmed;
  const targets = REVERSE_SUBCATEGORY_ALIASES[trimmed];
  if (targets?.length === 1) return targets[0];
  return null;
}

export function aggregateAliasedSubcategoryCounts(
  rawCounts: Record<string, number>,
): Record<string, number> {
  const counts = { ...rawCounts };
  Object.entries(SUBCATEGORY_ALIASES).forEach(([displayName, aliases]) => {
    counts[displayName] = aliases.reduce(
      (sum, alias) => sum + (rawCounts[alias] ?? 0),
      rawCounts[displayName] ?? 0,
    );
  });
  return counts;
}
