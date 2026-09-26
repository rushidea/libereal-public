import { describe, expect, it } from 'vitest';
import { mobileSiteNavigation, siteNavigation } from '@/data/site-navigation';

describe('site navigation', () => {
  it('contains the five public top-level sections in the required order', () => {
    expect(siteNavigation.map((item) => [item.id, item.label])).toEqual([
      ['products', '产品中心'],
      ['research-tools', '研究工具'],
      ['resources', '资源中心'],
      ['academic-support', '学术支持'],
      ['about', '关于我们'],
    ]);
  });

  it('omits the product center from the mobile site menu', () => {
    expect(mobileSiteNavigation.map((item) => item.id)).toEqual([
      'research-tools',
      'resources',
      'academic-support',
      'about',
    ]);
  });

  it('only exposes configured public entry points', () => {
    const links = siteNavigation.flatMap((item) => item.groups.flatMap((group) => group.links));
    expect(links.find((link) => link.label === '计算工具')?.href).toBe('/support?tab=calculators');
    expect(links.find((link) => link.label === '荧光光谱')?.href).toBe('/support?tab=spectra');
    expect(links.find((link) => link.label === '标准实验方法')?.href).toBe('/protocols');
    expect(links.find((link) => link.label === '研究热点')?.href).toBe('/research/trends');
    expect(links.find((link) => link.label === '法律条款')?.href).toBe('/legal');
    expect(siteNavigation.every((item) => item.href.startsWith('/'))).toBe(true);
  });

  it('keeps the product center tabs and footer shortcuts aligned', () => {
    const products = siteNavigation.find((item) => item.id === 'products');

    expect(products?.groups.map((group) => group.label)).toEqual(['产品目录', '品牌中心', '促销产品']);
    expect(products?.footerLinks.map((link) => link.label)).toEqual(['产品目录', '品牌中心', '促销产品', '快速订购']);
    expect(products?.groups.find((group) => group.id === 'product-brands')?.links.some((link) => link.label === 'Cell Signaling Technology')).toBe(true);
    expect(products?.groups.find((group) => group.id === 'product-promotions')?.links).toEqual([]);
  });

  it('provides a populated second level for tool, resource, and academic entries', () => {
    const researchTools = siteNavigation.find((item) => item.id === 'research-tools');
    const resources = siteNavigation.find((item) => item.id === 'resources');
    const academicSupport = siteNavigation.find((item) => item.id === 'academic-support');

    expect(researchTools?.groups[0]?.links.filter((link) => link.id !== 'public-tools').every((link) => !link.children?.length)).toBe(true);
    expect(researchTools?.groups[0]?.links.find((link) => link.id === 'public-tools')?.children?.every((link) => link.children?.length)).toBe(true);
    expect(resources?.groups[0]?.links.find((link) => link.id === 'scenes')?.children?.length).toBeGreaterThan(8);
    expect(resources?.groups[0]?.links.find((link) => link.id === 'protocol-library')?.children).toBeUndefined();
    expect(resources?.groups[0]?.links.find((link) => link.id === 'buffers')?.children).toBeUndefined();
    expect(resources?.groups[0]?.links.filter((link) => link.label === '实验方案库')).toHaveLength(0);
    expect(academicSupport?.groups[0]?.links.every((link) => link.children?.length)).toBe(true);
    expect(researchTools?.groups[0]?.links.find((link) => link.id === 'calculators')?.href)
      .toBe('/support?tab=calculators');
    expect(academicSupport?.groups[0]?.links.find((link) => link.id === 'journals')?.children?.[0]?.href)
      .toBe('/discoveries?tab=journals&journal=jbr');
  });

  it('keeps public tools at three levels with a distinct icon for every tool', () => {
    const publicTools = siteNavigation
      .find((item) => item.id === 'research-tools')
      ?.groups[0]?.links.find((link) => link.id === 'public-tools');
    const tools = publicTools?.children?.flatMap((category) => category.children ?? []) ?? [];

    expect(publicTools?.children?.length).toBeGreaterThan(0);
    expect(publicTools?.children?.every((category) => category.children?.length)).toBe(true);
    expect(tools.every((tool) => Boolean(tool.href))).toBe(true);
    expect(tools.every((tool) => Boolean(tool.icon))).toBe(true);
    expect(new Set(tools.map((tool) => tool.icon)).size).toBe(tools.length);
  });

  it('does not repeat a parent link as one of its direct child links', () => {
    const duplicates: string[] = [];
    const inspect = (links: typeof siteNavigation[number]['groups'][number]['links'], parentPath: string[] = []) => {
      for (const link of links) {
        const currentPath = [...parentPath, link.label];
        for (const child of link.children ?? []) {
          if (link.href && child.href === link.href) {
            duplicates.push(currentPath.join(' > '));
          }
        }
        inspect(link.children ?? [], currentPath);
      }
    };

    for (const item of siteNavigation) {
      for (const group of item.groups) inspect(group.links, [item.label, group.label]);
    }

    expect(duplicates).toEqual([]);
  });
});
