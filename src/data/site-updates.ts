export type SiteUpdate = {
  id: string;
  date: string;
  title: string;
  description: string;
  image: { src: string; alt: string };
  links: { label: string; href: string }[];
};

// Dates describe repository milestones, not independently verified launch dates.
// Evidence: 4bd7afd8, b1083022, f698c0d0, b508b00b, f980d1a4.
export const siteUpdates: SiteUpdate[] = [
  {
    id: 'research-evidence-more', date: '2026-09-06',
    title: '学术支持：更多研究热点上线',
    description: '学术支持继续更新，补充冷冻电镜、原位结构与动态构象、从头蛋白设计与工程化生物分子、多器官生物衰老与健康寿命机制、细胞器互作与铁死亡、克隆演化、转移与耐药、分子分层与功能精准肿瘤学、脑细胞图谱与跨尺度参考图谱、神经退行性疾病细胞图谱与机制、神经接口、高密度记录与神经调控、病原体基因组与基因组监测、新型疫苗平台与免疫保护相关物、抗微生物耐药与新型抗感染策略、微生物组代谢物与宿主互作、代谢性炎症与慢性疾病、肥胖、脂肪肝与心代谢多组学、液体活检与循环分子标志物、多重与超灵敏分子诊断、去中心化临床研究与数字终点、真实世界证据与目标试验模拟、联邦临床数据、精准队列与实施科学、表型筛选、靶点验证与候选优选、RNA、脂质纳米颗粒与靶向递送、人体相关药代、药效与安全性模型。研究热点页面按时间线整理论文、研究进展和实验方法。',
    image: { src: '/images/home/resource-tools.webp', alt: '科研数据图表与研究资料' },
    links: [{ label: '继续浏览研究热点', href: '/research/trends' }],
  },
  {
    id: 'research-evidence', date: '2026-08-30',
    title: '学术支持「研究热点」栏目上线，帮您追踪前沿进展',
    description: '首期上线 43 个研究热点，先从单细胞多组学与肿瘤空间免疫等方向开始。栏目收录多模态生物分子结构与相互作用预测、AI 分子设计与虚拟筛选、AI 表型分析与实验决策支持、长读长、人类泛基因组与复杂变异、单细胞调控基因组与表观基因组、CRISPR 精准编辑与功能筛选、高通量单细胞转录组与扰动筛选、空间转录组与空间多组学、单细胞多模态与原位测量、多组学整合与网络生物学、纵向组学与动态系统建模、生物医学知识图谱、数据标准与可复现性、分子记录、谱系追踪与命运解析、患者来源类器官与疾病模型、器官芯片与微生理系统、类器官与干细胞规模化制造、肿瘤空间免疫、CAR-T、TCR-T 与工程化免疫细胞、免疫检查点与组合免疫调控、肿瘤异质性与微环境生态。每个专题都配有论文、研究进展和实验方法，按时间线阅读。',
    image: { src: '/images/home/resource-tools.webp', alt: '科研数据图表与研究资料' },
    links: [{ label: '浏览生命科学研究热点', href: '/research/trends' }],
  },
  {
    id: 'discoveries', date: '2026-07-20',
    title: '发现栏目：延伸科研生活，阅读与生活版块上线',
    description: '新增独立的科研阅读栏目，汇集实验室科普、实验经验和科研生活。从试剂使用、实验操作到实验室日常，记录研究工作里常见的细节。',
    image: { src: '/images/home/research-life/microscope-discovery.webp', alt: '实验人员观察显微镜图像' },
    links: [{ label: '阅读实验室科普文章', href: '/discoveries' }],
  },
  {
    id: 'protocols', date: '2026-04-24',
    title: '标准实验方法（Standard Protocol）上线',
    description: '实验方法栏目上线，收录 Western blot、ELISA、细胞培养等超过 30 种常用方法的操作流程和注意事项。准备实验前，可以先看步骤和所需试剂，再按样本和检测目标确定实验条件。',
    image: { src: '/images/home/resource-methods.webp', alt: '实验记录本与电子科研文献' },
    links: [{ label: '查阅标准实验方案', href: '/protocols' }],
  },
  {
    id: 'experiment-faq', date: '2026-04-15',
    title: '应用和场景功能上线',
    description: '把基础实验技能按场景和方法整理在一起，覆盖 ELISA 检测、Western blot、细胞培养、流式细胞术和免疫组化。准备实验或采购试剂时，可以按场景建立清单；如果结果异常，也能对照操作提示逐项检查实验条件。',
    image: { src: '/images/home/research-life/gel-result.webp', alt: '实验人员讨论蛋白检测条带结果' },
    links: [{ label: '查看实验问题与解答', href: '/faq' }, { label: '试剂采购帮助', href: '/help' }],
  },
  {
    id: 'product-inquiry', date: '2026-04-14',
    title: 'LIBEREAL 生物试剂商城上线',
    description: '生物试剂商城上线，提供产品详情、购物车和在线询价入口。查询抗体、ELISA 试剂盒或实验耗材时，可以先查看规格与资料，把需要的产品放进购物车，再提交询价。',
    image: { src: '/images/home/resource-support.webp', alt: '试剂瓶、记录本与服务耳机' },
    links: [{ label: '查询生物试剂与实验耗材', href: '/products/catalog' }],
  },
];
