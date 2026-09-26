export type SupportNavigationItem = {
  id: 'protocols' | 'buffers' | 'faqs' | 'calculators' | 'spectra' | 'cd-markers' | 'public-tools';
  label: string;
  description: string;
  href: string;
};

export const supportNavigationItems: SupportNavigationItem[] = [
  {
    id: 'protocols',
    label: '实验方法',
    description: '常用实验流程与操作要点',
    href: '/support',
  },
  {
    id: 'buffers',
    label: '缓冲液配制',
    description: '常用配方、浓度与配制步骤',
    href: '/support?tab=buffers',
  },
  {
    id: 'calculators',
    label: '计算工具',
    description: '浓度、稀释与实验参数计算',
    href: '/support?tab=calculators',
  },
  {
    id: 'spectra',
    label: '荧光光谱',
    description: '染料光谱与通道搭配参考',
    href: '/support?tab=spectra',
  },
  {
    id: 'cd-markers',
    label: 'CD 分子',
    description: '细胞标志物与表达信息查询',
    href: '/support?tab=cd-markers',
  },
  {
    id: 'faqs',
    label: '常见问题',
    description: '采购、账户与实验相关问答',
    href: '/support?tab=faqs',
  },
  {
    id: 'public-tools',
    label: '公共工具与分析软件',
    description: '按分类整理的开源分析工具与公共数据库',
    href: '/scenes#public-tools',
  },
];
