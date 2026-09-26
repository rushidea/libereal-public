export type WhyChooseUsIcon = 'package' | 'flask' | 'receipt' | 'users';

export type WhyChooseUsItem = {
  icon: WhyChooseUsIcon;
  title: string;
  description: string;
};

export const WHY_CHOOSE_US_ITEMS = [
  {
    icon: 'package',
    title: '选品齐全',
    description: '跨品牌归集抗体、缓冲液、耗材与仪器配件，按场景与靶点筛选。',
  },
  {
    icon: 'flask',
    title: '方案与工具',
    description: '内置缓冲液配制、浓度换算与光谱查询，附可复用实验方案。',
  },
  {
    icon: 'receipt',
    title: '询价报价',
    description: '价格随量浮动走询价—报价，报价单与订单绑定，批次货期可查。',
  },
  {
    icon: 'users',
    title: '支持跟进',
    description: '选品或实验卡点由支持团队协助，协议库与社区持续补充。',
  },
] as const satisfies readonly WhyChooseUsItem[];
