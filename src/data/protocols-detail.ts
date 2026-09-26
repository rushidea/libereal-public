import { Dna, Activity, Brain, Microscope, FlaskConical, Droplets, CircleDot } from 'lucide-react';

export type Protocol = {
  id: string;
  title: string;
  category: string;
  icon: React.ElementType;
  iconColor: string;
  bgColor: string;
  difficulty: '基础' | '中级' | '高级';
  duration: string;
  description: string;
  steps: string[];
  tips: string[];
  relatedProducts?: { name: string; cat: string; code: string }[];
};

export const protocols: Protocol[] = [
  {
    id: 'western-blot',
    title: 'Western Blot 实验指南',
    category: '蛋白检测',
    icon: Activity,
    iconColor: 'text-blue-600',
    bgColor: 'bg-blue-50',
    difficulty: '中级' as const,
    duration: '2-3天',
    description: '从蛋白提取到显影的完整 Western Blot 实验流程，适用于检测细胞或组织中目标蛋白的表达水平。',
    steps: [
      '蛋白提取：PBS 洗涤细胞 3 次，加入 RIPA 裂解液（含 PMSF 和蛋白酶抑制剂），冰上裂解 30 分钟，12000rpm 离心 15 分钟取上清',      'BCA 法测定蛋白浓度：用 BCA 试剂盒测定 OD562，计算样品浓度',      'SDS-PAGE 制胶：根据蛋白分子量选择合适浓度（10-60kDa 用 12%，60-100kDa 用 10%，100-200kDa 用 8%）',      '上样：每孔 20-50μg 蛋白，加入 5× Loading Buffer，100℃煮沸 5 分钟',      '电泳：80V 恒压跑浓缩胶，120V 跑分离胶',      '转膜：湿转，300mA 恒流 60-120 分钟（根据蛋白大小调整），PVDF 膜需提前用甲醇激活',      '封闭：5% 脱脂奶粉或 5% BSA，室温摇床封闭 1 小时',      '一抗孵育：4℃过夜或室温 2 小时',      '洗涤：TBST 洗膜 3 次，每次 10 分钟',      '二抗孵育：室温 1 小时',      '洗涤：TBST 洗膜 3 次，每次 10 分钟',      '显影：ECL 发光液显影，凝胶成像系统曝光'
    ],
    tips: [
      '蛋白提取时加入蛋白酶抑制剂可防止降解',      '转膜时注意正负极方向：黑板-海绵-滤纸-胶-膜-滤纸-海绵-白板',      '封闭用 5% BSA 比脱脂奶粉更适合磷酸化蛋白检测',      '一抗稀释比例需根据预实验优化，一般 1:1000-1:5000',      '显影液需现用现配，避光保存'
    ],
  },
  {
    id: 'elisa-sandwich',
    title: '酶联免疫吸附试验（ELISA）操作指南',
    category: '免疫检测',
    icon: Droplets,
    iconColor: 'text-green-600',
    bgColor: 'bg-green-50',
    difficulty: '基础' as const,
    duration: '4-5小时',
    description: '双抗体夹心法 ELISA，适用于检测血清、细胞上清或组织匀浆中目标蛋白的浓度。',
    steps: [
      '准备工作：将试剂盒恢复至室温（18-25℃），标准品和样品做复孔',      '加标准品：设置标准品孔，分别加入倍比稀释的标准品 100μL',      '加样品：样品孔加入 100μL 待测样品，空白孔加 100μL 稀释液',      '孵育：用封板膜封板，37℃孵育 90 分钟',      '洗板：弃液体，每孔加满 Wash Buffer，静置 30 秒，重复 5 次，拍干',      '加一抗：每孔加入 100μL 生物素标记抗体工作液，封板，37℃孵育 60 分钟',      '洗板：同上步骤',      '加酶：每孔加入 100μL HRP 标记亲和素工作液，封板，37℃孵育 30 分钟',      '洗板：同上步骤',      '显色：每孔加入 100μL TMB 底物溶液，37℃避光孵育 15-30 分钟',      '终止：加入 100μL Stop Solution，轻轻混匀',      '测定：酶标仪 450nm 波长测定 OD 值，参考波长 570nm'
    ],
    tips: [
      '样品收集后尽快检测，或分装-80℃保存，避免反复冻融',      '血清样本避免溶血，脂血样本需做预处理',      '标准曲线 R²>0.99 才可使用',      '复孔 CV 值应控制在 10% 以内',      '洗板要充分，确保无残留液体'
    ],
  },
  {
    id: 'cell-cultivation',
    title: '细胞培养基础实验指南',
    category: '细胞培养',
    icon: FlaskConical,
    iconColor: 'text-rose-600',
    bgColor: 'bg-rose-50',
    difficulty: '基础' as const,
    duration: '持续维护',
    description: '贴壁细胞复苏、传代、冻存及培养条件优化的标准流程。',
    steps: [
      '细胞复苏：37℃水浴快速摇晃冻存管，1分钟内融化，将细胞悬液转移至含预热培养基的离心管中',      '离心：800rpm 离心 5 分钟，弃上清',      '重悬：加入适量完全培养基（含 10% 血清），轻轻吹打重悬',      '接种：细胞计数后调整密度，接种至培养瓶/皿中，37℃、5% CO₂培养箱培养',      '换液：次日更换培养基去除残留 DMSO，之后每 2-3 天换液',      '传代：细胞密度达 80-90% 时进行传代',      '消化：PBS 洗涤 2 次，加入 0.25% 胰酶（含 EDTA）消化，37℃孵育',      '终止：加入含血清培养基终止消化',      '离心：800rpm 离心 5 分钟，弃上清',      '分瓶：按 1:2 或 1:3 比例传代，补足培养基',      '冻存：消化离心后，细胞沉淀用冻存液重悬，转移至冻存管，程序降温后-80℃保存'
    ],
    tips: [
      '复苏后尽快换液去除 DMSO，减少对细胞毒性',      '胰酶消化时间不宜过长，一般 1-5 分钟，显微镜下观察细胞变圆即可终止',      '细胞状态差时可用支原体检测排除污染',      '血清需预先灭活（56℃ 30 分钟）用于某些敏感细胞',      '冻存液中 DMSO 浓度 10%，血清浓度 90% 最佳'
    ],
  },
  {
    id: 'immunofluorescence',
    title: '免疫荧光染色实验指南',
    category: '细胞成像',
    icon: Microscope,
    iconColor: 'text-purple-600',
    bgColor: 'bg-purple-50',
    difficulty: '中级' as const,
    duration: '1-2天',
    description: '用于检测细胞或组织中目标蛋白的定位和表达，适用于贴壁细胞和冰冻切片。',
    steps: [
      '细胞种植：24 孔板或 confocal 小皿中种植细胞，密度 50-70%',      '固定：PBS 洗涤 3 次，4% 多聚甲醛（PFA）室温固定 15-20 分钟',      '通透：PBS 洗涤 3 次，0.2% Triton X-100 通透 10 分钟',      '封闭：5% BSA 或 10% 正常血清（一抗来源）封闭 1 小时',      '一抗孵育：稀释一抗（用 1% BSA），4℃过夜或室温 2 小时',      '洗涤：PBS 洗涤 3 次，每次 5 分钟',      '二抗孵育：稀释荧光二抗（1:500-1:1000），室温避光孵育 1 小时',      '洗涤：PBS 洗涤 3 次，避光操作',      '核染色：DAPI（1:1000）复染 5 分钟',      '封片：PBS 洗涤后，用抗荧光淬灭封片液封片',      '拍照：尽快用共聚焦显微镜或荧光显微镜拍照'
    ],
    tips: [
      '固定液选择根据抗原特性：PFA 适合大多数蛋白，甲醇适合膜蛋白',      '二抗来源需与一抗宿主动物不同',      '荧光二抗稀释后需离心去除沉淀',      '操作全程避光，防止荧光淬灭',      '阳性对照和阴性对照有助于判断结果可靠性'
    ],
  },
  {
    id: 'ihc',
    title: '免疫组织化学 (IHC) 实验指南',
    category: '细胞成像',
    icon: Microscope,
    iconColor: 'text-red-600',
    bgColor: 'bg-red-50',
    difficulty: '中级' as const,
    duration: '1-2天',
    description: '用于石蜡切片或冰冻组织样本中目标蛋白的检测和定位。广泛用于临床病理和基础研究。',
    steps: [
      '组织取材：新鲜组织取材后立即固定，厚度不超过 3-5mm',      '固定：4% PFA 或 10% 中性福尔马林固定 24-48 小时（室温）',      '脱水：梯度乙醇脱水（70%→80%→95%→100%），每次 30-60 分钟',      '透明：二甲苯透明 2 次，每次 15-30 分钟',      '浸蜡：石蜡浸入（60℃熔蜡）3 次，每次 30-60 分钟',      '包埋：用石蜡包埋机将组织嵌入模具，4℃冷却凝固',      '切片：病理切片机切 3-5μm 薄片，摊片机捞片，60℃烤片 2-4 小时',      '脱蜡复水：二甲苯 2 次各 10 分钟 → 100%乙醇 2 次各 5 分钟 → 梯度复水（95%→80%→70%）各 5 分钟 → PBS 5 分钟',      '抗原修复：根据抗体选择修复方式，pH 6.0 柠檬酸缓冲液或 pH 9.0 EDTA 缓冲液，高压锅或微波修复 10-15 分钟，自然冷却',      '封闭内源性过氧化物酶：3% H₂O₂甲醇溶液孵育 10 分钟，PBS 洗涤 3 次',      '封闭：5% BSA 或 10% 正常山羊血清封闭 1 小时（室温）',      '一抗孵育：甩掉封闭液，直接加一抗，4℃过夜或室温 2 小时',      '洗涤：PBS 或 TBST 洗涤 3 次，每次 5 分钟',      '二抗孵育：HRP 标记二抗（1:200-1:500），室温孵育 30-60 分钟',      '洗涤：PBS 或 TBST 洗涤 3 次，每次 5 分钟',      '显色：DAB 或 AEC 显色液孵育 1-10 分钟（显微镜下观察控制时间）',      '复染：苏木素复染 30 秒 → 盐酸酒精分化 → 流水冲洗返蓝',      '脱水透明封片：梯度乙醇脱水 → 二甲苯透明 → 中性树胶封片',      '拍照：光学显微镜明场拍照'
    ],
    tips: [
      '抗原修复后需充分冷却至室温，避免脱片',
      '内源性过氧化物酶强时可延长 H₂O₂ 封闭时间至 15 分钟',
      'DAB 显色需在显微镜下控制时间，避免过染',
      '苏木素复染时间 30 秒左右为宜，时间过长影响抗体检测',
      '切片脱蜡要彻底，可延长二甲苯浸泡时间'
    ],
  },
  {
    id: 'fish',
    title: '荧光原位杂交（FISH）实验指南',
    category: '细胞结构与功能',
    icon: Microscope,
    iconColor: 'text-teal-600',
    bgColor: 'bg-teal-50',
    difficulty: '中级' as const,
    duration: '1-2天',
    description: 'Fluorescence In Situ Hybridization（FISH）是一种利用荧光标记的探针与目标核酸（DNA 或 RNA）原位杂交的技术，可在保持组织/细胞结构的前提下检测特定核酸序列的空间分布。广泛应用于基因组定位、染色体异常检测、RNA 表达定位等研究。',
    steps: [
      '【探针设计与制备】',      '探针设计：针对目标序列设计 30-50nt 寡核苷酸探针，确保特异性',      '标记方式：3\' 端或 5\' 端生物素标记/荧光素标记（如 FITC、Cy3、Cy5）',      '探针混合：多个探针可混合使用，实现双色或三色 FISH',      '探针保存：-20℃ 避光保存，避免反复冻融',      '',      '【样本准备与固定】',      '细胞爬片：24 孔板放置盖玻片，接种细胞至 60-80% 汇合度',      '组织切片：5-10μm 石蜡切片或冰冻切片，60℃ 烤片 2-4 小时',      '固定：4% PFA 室温固定 10-20 分钟，PBS 洗涤 3 次',      '脱水：梯度乙醇（70%→85%→100%）各 2 分钟，晾干',      '',      '【通透与酶处理】',      'RNA 酶处理（如检测 DNA）：加入 100μg/mL RNase A，37℃ 1 小时，去除 RNA 干扰',      '通透：0.3% Triton X-100 室温 10 分钟，增加探针渗透性',      '蛋白质酶消化（如需要）：蛋白酶 K（0.1μg/mL）37℃ 5-10 分钟',      '',      '【杂交】',      '预杂交：加入预杂交液（SSC + BSA + 鲑鱼精 DNA），37℃ 30 分钟',      '杂交液配制：探针（10-100ng/μL）+ 杂交液（SSC + formamide + 鲑鱼精 DNA）',      '变性：95℃ 5 分钟变性探针，立即冰浴 2 分钟',      '杂交：加入探针混合液，37℃-42℃ 孵育 4-16 小时（根据探针长度和复杂度调整）',      '',      '【洗涤】',      '严格洗涤：SSC 缓冲液梯度洗涤（2×SSC → 1×SSC → 0.5×SSC）',      '温度：洗涤温度需根据探针 Tm 值优化（通常 37-42℃）',      'DAPI 复染：加入 DAPI（1:1000）染核 5 分钟',      '',      '【封片与成像】',      '封片：抗荧光淬灭封片剂封片，避免气泡',      '成像：共聚焦显微镜或荧光显微镜观察',      '多通道：分别拍摄 DAPI 和 FISH 荧光信号，计算共定位'
    ],
    tips: [

    ],
  },
  {
    id: 'pcr',
    title: 'PCR/RT-PCR 实验指南',
    category: '分子生物学',
    icon: Dna,
    iconColor: 'text-amber-600',
    bgColor: 'bg-amber-50',
    difficulty: '基础' as const,
    duration: '3-5小时',
    description: '普通 PCR 和逆转录 PCR 的标准操作流程，包括引物设计原则和常见问题排查。',
    steps: [
      '引物设计：使用专业软件（如 Primer Premier 5）设计，长度 18-25bp，GC 含量 40-60%，避免连续 4 个相同碱基',      'RNA 提取：使用 Trizol 或商品化 RNA 提取试剂盒，收集细胞或组织',      '逆转录：使用逆转录酶和 Oligo(dT) 或随机引物，反应体系：RNA 1μg，逆转录酶 1μL，dNTP 2μL，缓冲液 4μL，RNase Free 水补至 20μL',      '逆转录程序：25℃ 5分钟，42℃ 50分钟，70℃ 15分钟',      'PCR 体系：模板 cDNA 2μL，上下游引物各 1μL，2× Master Mix 12.5μL，灭菌水补至 25μL',      'PCR 程序：94℃ 3分钟预变性；94℃ 30秒，55-60℃ 30秒（根据引物 Tm 值调整），72℃ 30秒/1kb，循环 30-35 次；72℃ 5分钟延伸',      '电泳检测：1.5% 琼脂糖凝胶，100V 电泳 30 分钟，EB 或替代染料染色',      '成像：凝胶成像系统拍照，分析条带大小和亮度'
    ],
    tips: [
      'RNA 操作需使用 RNase Free 耗材和试剂',      '引物设计避免 3\' 端连续 G 或 C，超过 3 个会不稳定',      '退火温度可根据 Tm 值计算，一般比 Tm 低 5℃',      '阳性对照和阴性对照（NTC）必不可少',      '出现非特异性条带时可提高退火温度或降低引物浓度'
    ],
  },
  {
    id: 'immunoprecipitation',
    title: '免疫沉淀 (IP/Co-IP) 实验指南',
    category: '蛋白研究',
    icon: Brain,
    iconColor: 'text-cyan-600',
    bgColor: 'bg-cyan-50',
    difficulty: '高级' as const,
    duration: '1-2天',
    description: '免疫沉淀和免疫共沉淀实验，用于富集特定蛋白或其相互作用蛋白复合物。',
    steps: [
      '裂解：PBS 洗涤细胞 2 次，加入 IP 裂解液（含蛋白酶抑制剂和磷酸酶抑制剂），冰上裂解 30 分钟',      '离心：14000rpm，4℃离心 15 分钟，取上清',      '蛋白定量：BCA 法测定浓度，调整各样品浓度一致',      '预清除：加入 Protein A/G beads（20μL/样本），4℃旋转 1 小时，减少非特异性结合',      '离心：14000rpm，4℃离心 5 分钟，取上清',      '一抗孵育：加入一抗（1-10μg），4℃旋转过夜',      '结合 beads：加入 30μL Protein A/G beads，4℃旋转 2-4 小时',      '洗涤：4℃离心 3000rpm 1 分钟，弃上清，用 IP 裂解液洗 3 次，再用低盐/高盐缓冲液各洗 1 次',      '洗脱：加入 2× Loading Buffer，100℃煮沸 5 分钟',      '检测：通过 Western Blot 分析沉淀的蛋白'
    ],
    tips: [
      'Co-IP 需要在非变性条件下裂解，保持蛋白天然构象和相互作用',      '一抗用量需优化，过多会导致轻链污染',      '洗涤力度需平衡：太松导致非特异性结合，太紧可能破坏蛋白互作',      '设置 Input 对照（总裂解液）和 IgG 对照',      '全长蛋白比片段更容易进行 Co-IP'
    ],
  },
  {
    id: 'flow-cytometry',
    title: '流式细胞术实验指南',
    category: '细胞分析',
    icon: Dna,
    iconColor: 'text-orange-600',
    bgColor: 'bg-orange-50',
    difficulty: '中级' as const,
    duration: '3-4小时',
    description: '流式细胞术（Flow Cytometry）用于分析细胞表面标志物、胞内蛋白、细胞周期、凋亡等。适用于单细胞悬液的定量分析。',
    steps: [
      '样本制备：收集细胞（悬浮细胞直接收集，贴壁细胞用胰酶消化），PBS 洗涤 2 次',      '细胞计数：调整细胞浓度至 1×10⁶ - 1×10⁷ 细胞/mL',      '封闭：使用 FcR 封闭剂（1μg/10⁶ 细胞）室温封闭 10 分钟，减少非特异性结合',      '表面染色：加入荧光素标记的抗体，4℃避光孵育 30 分钟',      '洗涤：加入 PBS 1-2mL，300g 离心 5 分钟，弃上清，重复 1-2 次',      '死活染料：如需死活鉴定，加入 Zombie染料（1:1000 稀释），室温孵育 15 分钟',      '固定：如需固定，加入 4% PFA 室温固定 15 分钟',      '洗涤：固定后 PBS 洗涤 1 次',      '上机：重悬于 200-500μL PBS 中，用细胞滤网过滤（40μm），去除团聚',      '设置对照：单染对照（调节补偿）、FMO 对照（确定门的位置）、同型对照、空白对照'
    ],
    tips: [
      '抗体用量需优化，一般 0.25-5μg/10⁶ 细胞，过多会导致非特异性结合',      '荧光素选择考虑仪器配置和抗原表达水平：高表达用 PE，低表达用 AF488',      '补偿管必须单染，与样本染色条件完全一致',      'FMO 对照对于弱阳性表达标志物很重要',      '样本上机后尽快检测，4℃可保存 24 小时'
    ],
  },
  {
    id: 'elispot',
    title: 'ELISPOT 实验指南',
    category: '免疫检测',
    icon: CircleDot,
    iconColor: 'text-indigo-600',
    bgColor: 'bg-indigo-50',
    difficulty: '中级' as const,
    duration: '2-3天',
    description: '酶联免疫斑点检测（ELISPOT）用于检测单个细胞分泌细胞因子或抗体的能力。广泛应用于免疫学研究和疫苗开发。',
    steps: [
      '板子预处理：用 35% 乙醇或专用激活液浸泡 ELISPOT 板 15 分钟',      '包被：用 PBS 稀释的一抗（5-10μg/mL）加入板子，100μL/孔，4℃过夜',      '封闭：次日用含 10% FBS 的 RPMI 1640 培养基封闭 2 小时（37℃）',      '洗涤：PBST 洗板 3 次，再用 PBS 洗 1 次',      '接种细胞：将 PBMC 或脾细胞（2×10⁵ - 5×10⁵ 细胞/孔）加入板子',      '刺激：根据实验设计加入刺激物（如 PHA 10μg/mL，或特异性抗原肽），37℃ CO₂ 培养箱孵育 24-48 小时',      '洗涤：小心去除细胞，用 PBST 洗板 5 次，再用 PBS 洗 2 次',      '酶标抗体：加入 HRP 或 AP 标记的二抗（1:200 稀释），37℃孵育 2 小时',      '洗涤：PBST 洗板 5 次，再用 PBS 洗 2 次',      '显色：加入 AEC 或 TMB 底物溶液，室温避光孵育 15-30 分钟，随时观察显色情况',      '终止：用水轻轻冲洗板子终止显色',      '拍照与分析：显微镜下拍照，计数斑点形成细胞（SFC），或用专用仪器分析'
    ],
tips: [
      '探针设计避免与高度重复序列结合，导致非特异性信号',
      '杂交温度需根据探针长度和 GC 含量优化（37-42℃）',
      '洗涤严格按 SSC 梯度进行，温度过高会导致信号丢失',
      '多色 FISH 需要注意荧光素光谱重叠，调节曝光时间',
      '石蜡切片脱蜡要彻底，残留蜡会导致染色不均'
    ],
  },
  {
    id: 'single-cell-rna-seq',
    title: '单细胞转录组测序 (scRNA-seq) 实验指南',
    category: '单细胞分析',
    icon: Dna,
    iconColor: 'text-violet-600',
    bgColor: 'bg-violet-50',
    difficulty: '高级' as const,
    duration: '2-5天',
    description: '单细胞转录组测序技术，用于在单细胞层面解析细胞异质性，发现新的细胞类型和功能状态。广泛应用于免疫学、肿瘤学、发育生物学等研究领域。',
    steps: [
      '样本制备：根据组织类型选择合适的单细胞解离方法',      '组织处理：新鲜组织小块用 PBS 或专用解离缓冲液清洗，剪刀剪成 1-2mm 小块',      '酶解：加入胶原酶/胰酶混合液，37℃摇床消化 30-60 分钟',      '过滤：使用 40μm 细胞滤网过滤，除去未消化组织，收集单细胞悬液',      '红细胞裂解（如需要）：加入 RBC Lysis Buffer，室温孵育 5 分钟',      '细胞计数：用血球计数板或自动细胞计数仪测定活细胞浓度，调整至 700-1200 cells/μL',      '质控：活率 >85%，无明显细胞碎片和团块',      '油包水GEMs形成：使用 10× Genomics Chromium 或类似平台，将单个细胞与凝胶珠（Gel Beads）和酶混合物包裹在油滴中形成 GEMs',      '逆转录：GEMs 中进行逆转录反应，生成 cDNA',      '油相破裂：加入破裂液破油，回收 cDNA',      'cDNA 扩增：进行 PCR 扩增，获得足够量的 cDNA',      '文库构建：使用商品化试剂盒进行片段化、接头连接和 PCR 扩增',      '测序：使用 Illumina 高通量测序平台（NovaSeq/NextSeq）进行测序',      '数据分析：使用 Cell Ranger、Seurat、Scanpy 等软件进行数据处理、比对、聚类和注释'
    ],
    tips: [

    ],
  },
  {
    id: 'magnetic-bead-sorting',
    title: '磁珠分选 (MACS) 实验指南',
    category: '磁珠分选',
    icon: Activity,
    iconColor: 'text-sky-600',
    bgColor: 'bg-sky-50',
    difficulty: '中级' as const,
    duration: '2-4小时',
    description: '磁性激活细胞分选（MACS）技术，利用偶联抗体的磁性微珠富集或去除特定细胞群体。适用于流式前的样本制备、免疫学研究、细胞治疗等。',
    steps: [
      '样本准备：收集细胞（悬浮或贴壁细胞），用 PBS + 0.5% BSA + 2mM EDTA 缓冲液重悬',      '细胞计数：调整细胞浓度至 10⁷-10⁸ cells/mL',      '磁珠标记：加入偶联抗体的磁性微珠（通常 10μL/10⁷ cells），轻轻混匀，4℃ 孵育 15-30 分钟',      '洗涤：加入缓冲液洗涤，300g 离心 5 分钟，弃上清',      '分选柱准备：将 MS 或 LS 分选柱放置于磁力架上，加入缓冲液平衡柱子',      '上样：将细胞悬液加入分选柱，让未标记细胞流穿（阴性组分）',      '洗涤：用缓冲液洗涤柱子 3 次，每次收集洗穿液',      '洗脱：移除磁场，加入缓冲液，用柱子配套的活塞或离心管收集标记细胞（阳性组分）',      '可选：对于高表达目标抗原的细胞，可用预分选柱进行富集',      '对于需要去除特定细胞的情况（如 RBC、Dead cells），先进行阴性分选',      '细胞计数：收集完成后用血球计数板或自动细胞计数仪测定细胞浓度',      '质控：取少量样本进行流式检测，验证分选纯度（应 >90%）'
    ],
    tips: [
      '整个操作保持 4℃ 或冰上，防止非特异性结合和细胞死亡',      '缓冲液中加入 BSA 和 EDTA 可减少细胞结团和非特异性结合',      '细胞浓度不要过高（<10⁸ cells/mL），否则会导致柱子堵塞',      '抗体和磁珠用量需根据细胞数量和抗原表达水平优化',      '柱子选择：MS 柱适合少量细胞（<10⁷），LS 柱适合中等量细胞（<10⁸）',      '阳性分选时移除柱子前先静置 1 分钟，提高回收率',      '分选后尽快进行下游实验，避免细胞活性下降',      '对于低表达抗原，可考虑使用亲和性更高的微珠（如 αCD25 微珠）'
    ],
  },
  {
    id: 'radioimmunoassay',
    title: '放射免疫测定 (RIA) 实验指南',
    category: '放射免疫',
    icon: Activity,
    iconColor: 'text-orange-600',
    bgColor: 'bg-orange-50',
    difficulty: '高级' as const,
    duration: '1-3天',
    description: '放射免疫测定（Radioimmunoassay, RIA）是一种利用放射性同位素标记的抗体或抗原进行超灵敏检测的技术。可用于测定血清、组织匀浆或细胞上清中微量抗原、激素、肿瘤标志物等的浓度。',
    steps: [
      '原理：竞争性结合反应，未标记抗原与放射性标记抗原（¹²⁵I 或 ³H）竞争结合有限量抗体',      '缓冲液配制：PBS (0.05M, pH 7.4) + 0.1% BSA + 0.1% NaN₃ 作为 assay buffer',      '标准曲线设置：取系列稀释的标准抗原（0, 0.1, 0.5, 1, 5, 10, 50 ng/mL），各设复孔',      '样品处理：血清样本 4℃ 离心 3000rpm 10 分钟，取上清待测；组织样本需匀浆、离心取上清',      '加样：各管加入 100μL 标准品或待测样品',      '加入标记抗原：加入 100μL ¹²⁵I 标记抗原（约 20,000 cpm），振荡混匀',      '加入抗体：加入 100μL 抗血清（按最优稀释度），振荡混匀',      '孵育：4℃ 孵育 24-48 小时（塑料管需预处理防止非特异性吸附）',      '分离结合与游离部分：',      '  方法一（双抗体法）：加入第二抗体（如羊抗兔 IgG），37℃ 孵育 1 小时，离心 3000rpm 15 分钟，弃上清',      '  方法二（PEG 沉淀法）：加入 20% PEG 6000，混匀，离心 3000rpm 15 分钟，弃上清',      '  方法三（活性炭吸附法）：加入活性炭悬液，离心，收集上清（结合部分）',      '放射性测定：使用 γ 计数器（¹²⁵I）或 β 液闪仪（³H）测定各管放射性计数（cpm）',      '数据处理：以标准品浓度为横坐标，B/T%（结合率）为纵坐标，绘制标准曲线，计算样品浓度'
    ],
    tips: [
      '放射性废物需按规范处理，操作人员需佩戴剂量仪',
      '¹²⁵I 半衰期 60 天，标记抗原需新配制或重新校准',
      '塑料管需用 BSA 预处理，防止放射性物质非特异性吸附',
      ' PEG 沉淀法 PEG 浓度需优化，过高会导致非特异性沉淀',
      'γ 计数器测定前需进行效率校准，确保计数准确性'
    ],
  },
  {
    id: 'immune-cell-isolation',
    title: '免疫细胞分离与纯化指南（密度梯度离心法）',
    category: '细胞分离',
    icon: FlaskConical,
    iconColor: 'text-teal-600',
    bgColor: 'bg-teal-50',
    difficulty: '中级' as const,
    duration: '2-3小时',
    description: '从外周血、骨髓或淋巴组织中分离单个核细胞（PBMC）的标准方法。Ficoll 和 Percoll 是两种最常用的密度梯度离心介质，适用于后续流式、磁珠分选、培养等实验。',
    steps: [
      '【Ficoll 分离法（常规方案）】',      '血液采集：用肝素抗凝采血管采集外周血 5-10mL，室温保存，4小时内处理',      '稀释：用 PBS 或生理盐水 1:1 稀释血液，降低粘度',      '分层准备：在 15mL 离心管中先加入 3-5mL Ficoll-Paque Plus（密度 1.077g/mL）',      '加样：倾斜离心管，用移液管沿管壁缓慢加入稀释血液（约 5-8mL），保持清晰分层',      '离心：室温 400g 离心 30 分钟（升速和降速均设置为 slow brake/无制动）',      '收集中间层：用移液管小心吸取中间层云雾状单个核细胞层（泛白色），避免吸到上层血浆',      '洗涤：转移至新管，加入 10mL PBS，300g 离心 10 分钟，弃上清',      '重复洗涤：重复洗涤 2 次，去除血小板和残留 Ficoll',      '细胞计数：重悬于 1mL PBS，用血球计数板计数',      '活性检测：台盼蓝染色检测活率，通常 >95%',      '',      '【Percoll 分离法（梯度方案）】',      'Percoll 梯度配制：',      '  - 母液：Percoll 原液 + 10× PBS (1:9) 配成 100% Percoll',      '  - 制作不连续梯度：40% Percoll (1.06g/mL) + 60% Percoll (1.08g/mL) + 80% Percoll (1.12g/mL)',      '血液处理：同上，用 PBS 1:1 稀释',      '加样：在梯度管中缓慢加入稀释血液，避免打乱梯度',      '离心：室温 500g 离心 30 分钟（无制动）',      '收集各层：分别收集 40%/60% 界面（单核细胞）、60%/80% 界面（淋巴细胞）、80% 底层（粒细胞）',      '洗涤：各层细胞用 PBS 洗涤 2 次',      '注意：Percoll 梯度可分离更精细的细胞亚群，如不同密度的 T/B 细胞',      '',      '【组织来源单个核细胞分离】',      '淋巴结/脾脏：放入含 PBS 的培养皿中，用剪刀剪碎，通过 40μm 滤网研磨',      '骨髓：用注射器抽取骨髓，用 PBS 冲洗，通过滤网',      '肿瘤组织：剪成 1-2mm 小块，酶消化（胶原酶 + 透明质酸酶）30-60 分钟，离心收集',      '后续处理同上，先用 PBS 洗涤，再进行密度梯度分离'
    ],
    tips: [
      '血液采集后尽快处理，室温放置不宜超过 4 小时',
      '离心时关闭刹车（无制动），保证分层清晰',
      '吸取中间层要慢且稳，避免吸到上层血浆或下层红细胞',
      '洗涤去除血小板需重复 2-3 次，避免影响后续培养',
      '活性检测用台盼蓝，活率 >90% 才可进行下游实验'
    ],
  },
  {
    id: 'sirna-transfection',
    title: 'siRNA 转染实验指南',
    category: '分子生物学',
    icon: Dna,
    iconColor: 'text-violet-600',
    bgColor: 'bg-violet-50',
    difficulty: '中级' as const,
    duration: '1-2天',
    description: 'siRNA（small interfering RNA）是人工设计的、用于诱导 RNA 干扰（RNAi）从而沉默特定基因的核心工具。Lipofectamine RNAiMAX 是最常用的转染试剂，适用于大多数细胞系。',
    steps: [
      '【siRNA 设计与制备】',      '设计原则：选择靶基因 CDS 区 21-23nt 序列，GC 含量 30%-52%，避免 5\'/3\' UTR 区域',      'BLAST 比对：确保序列特异性，使用在线工具（Dharmacon、Ambion、siDirect）设计',      '多靶点验证：建议同时设计 2-3 条不同靶点 siRNA，筛选敲降效率最高的',      '',      '【制备方法选择】',      '化学合成：纯度高、可进行化学修饰（如 2\'-O-Me、硫代磷酸骨架），成本较高，适合验证阶段',      '体外转录：成本低、周期短，适合大规模筛选',      'RNase III 消化：产生 siRNA 混合物，沉默效率高但存在脱靶风险',      '',      '【细胞接种】',      '转染前一天，6 孔板接种 0.5-2×10⁵ cells/well，使次日汇合度达 50-70%',      '无双抗培养基（Opti-MEM 或 DMEM）培养过夜',      '',      '【siRNA-转染试剂复合物配制】',      '稀释 siRNA：Opti-MEM 稀释 siRNA（终浓度 10-100nM，通常 30-50nM）',      '稀释转染试剂：Opti-MEM 稀释 Lipofectamine RNAiMAX（通常 5-10μL/孔）',      '混合：室温孵育 5 分钟（让 RNAiMAX 与 siRNA 结合）',      '注意：不要过度吹打，轻轻混匀即可',      '',      '【转染】',      '将 siRNA-RNAiMAX 复合物加入细胞，轻轻摇晃混匀',      '37℃培养 24-72 小时',      '转染后 4-6 小时可换液，减少试剂毒性',      '',      '【严格对照设置】',      '阴性对照：Scramble 序列（与任何基因无同源性）',      '阳性对照：已知有效 siRNA（如 GAPDH siRNA）验证转染效率',      '空白对照：不加 siRNA 的细胞，评估细胞毒性'
    ],
    tips: [

    ],
  },
  {
    id: 'sirna-knockdown-validation',
    title: 'siRNA 敲降效果验证实验指南',
    category: '分子生物学',
    icon: Dna,
    iconColor: 'text-purple-600',
    bgColor: 'bg-purple-50',
    difficulty: '中级' as const,
    duration: '1-3天',
    description: '验证 siRNA 敲降效果的"金标准"包括两个层面：分子水平验证（qPCR + Western Blot）和功能表型分析。这是判断 siRNA 实验是否成功的关键步骤。',
    steps: [
      '【分子水平验证 - mRNA 检测（转染后 24-48 小时）】',      '收细胞：用 TRIzol 或 RNA 提取试剂盒提取 total RNA',      '逆转录：PrimeScript RT Master Mix 将 RNA 转为 cDNA',      'qPCR：目的基因引物 + GAPDH/β-actin 内参引物',      '数据计算：ΔΔCt 法计算敲降效率 = 1 - 2^(-ΔΔCt)',      '判定标准：mRNA 敲降 >70% 为有效，<50% 建议更换靶点',      '',      '【分子水平验证 - 蛋白检测（转染后 48-96 小时）】',      '收蛋白：RIPA 裂解液（含蛋白酶抑制剂）提取总蛋白',      '定量：BCA 法定量，调整各样品浓度一致',      'Western Blot：SDS-PAGE 电泳、转膜、封闭、一抗（目标蛋白 + 内参）孵育、二抗孵育、显影',      '灰度分析：ImageJ 软件分析条带灰度，计算敲降效率',      '判定标准：蛋白表达下降 >60% 为有效敲降',      '',      '【功能表型分析（确认敲降效率后）】',      '细胞增殖：CCK-8/MTT 检测细胞活力变化（转染后 24-72 小时）',      '细胞凋亡：Annexin V/PI 流式检测（转染后 48-72 小时）',      '细胞周期：PI 染色流式检测（转染后 24-48 小时）',      '细胞迁移：Transwell/Wound Healing 检测（转染后 12-48 小时）',      '其他：根据基因功能选择对应表型实验',      '',      '【时间梯度检测】',      '分别在 24h、48h、72h、96h 收样检测，找到最佳检测时间点',      '某些蛋白半衰期长（如膜蛋白、核蛋白），可能需要更长时间才能看到敲降效果',      '',      '【多靶点 siRNA 筛选】',      '如无法确定最佳 siRNA 靶点，可同时转染 2-3 条不同序列的 siRNA',      '筛选敲降效率最高的进行后续功能实验',      '注意：不同靶点的敲降效率可能差异很大（20%-90%）'
    ],
    tips: [
      'mRNA 检测在转染后 24-48 小时进行，蛋白检测在 48-96 小时',
      '建议设计 2-3 条不同靶点 siRNA，筛选敲降效率最高的',
      '敲降效率判定：mRNA 下降 >70% 或蛋白下降 >60% 为有效',
      '出现细胞毒性时需降低 siRNA 浓度或减少转染时间',
      '功能表型验证需在确认分子水平敲降效果后进行'
    ],
  },
  {
    id: 'shrna-virus-packaging',
    title: 'shRNA 病毒包装与感染指南',
    category: '分子生物学',
    icon: Dna,
    iconColor: 'text-indigo-600',
    bgColor: 'bg-indigo-50',
    difficulty: '高级' as const,
    duration: '1周',
    description: 'shRNA（short hairpin RNA）通过质粒或病毒载体导入细胞，可在细胞内持续表达并进行稳定敲降。慢病毒包装可实现高效感染和稳定细胞系构建。',
    steps: [
      '【shRNA 载体构建】',      '设计 shRNA 序列：19-29nt 靶序列 + loop (5-8nt) + 反向重复序列',      '常用载体：pLKO.1、pSuper-retro、pGIPZ 等',      '或购买已验证的 shRNA 克隆',      '',      '【病毒包装（293T 细胞）】',      '接种 293T：10cm 皿接种 5×10⁶ cells，37℃培养至 80% 汇合度',      '转染前一天换液（无双抗完全培养基）',      '转染复合物配制：',      '  - A 液：DMEM + shRNA 质粒 + 包装质粒（psPAX2） + 包膜质粒（pMD2.G）',      '  - B 液：DMEM + PEI（1:3 比例，μg:μL）',      '  - 混合 A+B，室温孵育 20 分钟',      '加入复合物到 293T 细胞，培养 6-8 小时后换液',      '',      '【病毒收集】',      '48 小时后收集上清（含病毒），4000rpm 离心 10 分钟去除细胞碎片',      '可更换新培养基继续培养，72 小时再次收集',      '病毒上清 4℃ 保存（1周）或-80℃ 长期保存',      '',      '【病毒浓缩（如需要高滴度）】',      '超速离心：100,000g，4℃离心 2 小时，弃上清，病毒沉淀用培养基重悬',      '或使用病毒浓缩试剂盒',      '',      '【感染目标细胞】',      '接种目标细胞（根据 MOI 计算细胞数），加入病毒上清 + Polybrene（8μg/mL）',      '感染 24 小时后换液',      '嘌呤霉素筛选（2-5μg/mL），建立稳定细胞系',      '验证敲降效果（qPCR + WB）'
    ],
    tips: [
      '293T 细胞状态要好，融合度 80-90% 时转染效率最高',
      '质粒比例：shRNA : psPAX2 : pMD2.G = 1 : 1 : 0.5（质量比）',
      'PEI 转染试剂与 DNA 比例 3:1，μg:μL',
      '病毒上清 4℃ 可保存 1 周，-80℃ 可长期保存，避免反复冻融',
      '嘌呤霉素筛选浓度需预先确定，通常 2-5 μg/mL'
    ],
  },
  {
    id: 'crispr-cas9',
    title: 'CRISPR-Cas9 基因编辑实验指南',
    category: '分子生物学',
    icon: Dna,
    iconColor: 'text-teal-600',
    bgColor: 'bg-teal-50',
    difficulty: '高级' as const,
    duration: '2-3周',
    description: 'CRISPR-Cas9 是目前最便捷的基因编辑工具，通过 sgRNA 引导 Cas9 核酸酶在特定位点产生 DNA 双链断裂，实现基因敲除、敲入或修饰。广泛应用于功能基因组学研究。',
    steps: [
      '【sgRNA 设计】',      '选择靶点：外显子区早期 CDS 序列（PAM: NGG）',      '避免同源序列和 off-target 预测高危位点',      '在线工具：CHOPCHOP、CRISPOR、E-CRISP 等',      '建议设计 3-5 条 sgRNA，筛选切割效率最高的',      '',      '【载体构建】',      '常用载体：pSpCas9(BB)-2A-Puro (PX459)、lentiCRISPR v2 等',      '退火形成双链：sgRNA oligo (100μM) 各 1μL + T4 PNK + Buffer，95℃ 5min，逐渐降温至 25℃',      '连接：使用 T4 DNA Ligase 连接至线性化载体',      '转化：DH5α 感受态细胞，氨苄青霉素筛选',      '测序验证克隆正确性',      '',      '【细胞转染/感染】',      '质粒转染：Lipofectamine 3000 或电转（适合难转染细胞）',      '或病毒包装：包装 sgRNA-Cas9 载体，感染目标细胞',      '选择方法：嘌呤霉素（PX459）或潮霉素筛选',      '',      '【单克隆筛选】',      '有限稀释法：96孔板稀释细胞至 0.5-1 cell/well，培养 2-3 周',      '或流式细胞术分选 GFP+ 单细胞',      '扩增：单克隆细胞扩大培养，冻存备份',      '',      '【敲除效率验证】',      '基因组 DNA 提取：使用基因组提取试剂盒',      'T7E1 切割实验：PCR 扩增靶区域，T7E1 酶切割错配位点，电泳分析',      'TA 克隆测序：克隆 PCR 产物，测序分析 indels 百分比',      'Western Blot：如蛋白表达量可检测，验证敲除效果',      '',      '【敲入实验（如需要）】',      '设计同源臂：500-1000bp 左右同源臂包裹 HDR 模板',      '共转染：Cas9 + sgRNA + HDR 模板（线性或环状）',      '筛选：阳性克隆可用药物筛选或荧光筛选',      '鉴定：PCR + 测序验证敲入正确性'
    ],
    tips: [
      'sgRNA 设计避免 off-target 位点，使用 CHOPCHOP 或 CRISPOR 预测',
      'Cas9 质粒可同时转染或包装病毒感染，难转染细胞建议用病毒',
      '单克隆筛选需设置充足时间（2-3 周），避免过早挑取未生长克隆',
      'T7E1 切割实验需优化退火温度，PCR 产物应大于 400bp',
      '脱靶检测：对预测的高危 off-target 位点进行 Sanger 测序验证'
    ],
  },
  {
    id: 'mirna-extraction',
    title: 'miRNA 提取与纯化实验指南',
    category: '分子生物学',
    icon: Dna,
    iconColor: 'text-teal-600',
    bgColor: 'bg-teal-50',
    difficulty: '基础' as const,
    duration: '2-3小时',
    description: 'miRNA 是一种长度约 20-24nt 的内源性小 RNA，与蛋白质形成复合物后在体液和组织中稳定存在。miRNA 提取是后续表达谱分析、定量检测和功能研究的基础。适用于细胞、组织、血浆、血清等多种样本类型。',
    steps: [
      '【样本收集与保存】',      '细胞样本：PBS 洗涤 2 次，收集细胞沉淀，-80℃保存或立即提取',      '组织样本：新鲜组织切成 50-100mg 小块，液氮速冻，-80℃保存',      '血浆/血清：EDTA 抗凝管采集，1500g 离心 10 分钟取上清，-80℃分装保存',      '注意：避免反复冻融，血浆样本尤其重要',      '',      '【细胞/组织 miRNA 提取（TRIzol 法）】',      '裂解：加入 1mL TRIzol，室温孵育 5 分钟使细胞完全裂解',      '分相：加入 200μL 氯仿，剧烈振荡 15 秒，室温孵育 3 分钟',      '离心：12000g 4℃离心 15 分钟，溶液分为三层',      '取水相：小心吸取上层水相（含 small RNA），转移至新管',      '沉淀：加入 500μL 异丙醇，室温孵育 10 分钟',      '离心：12000g 4℃离心 10 分钟，弃上清',      '洗涤：加入 1mL 75% 乙醇洗涤沉淀，8000g 4℃离心 5 分钟',      '溶解：弃乙醇，室温干燥 5-10 分钟，加入 30-50μL RNase Free 水溶解',      '',      '【血浆/血清 miRNA 提取（专用试剂盒法）】',      '血浆解冻：冰上解冻样本，避免剧烈晃动',      '加入 carrier RNA：加入 1μg carrier RNA（提高回收率）',      '裂解：加入 TRIzol LS 1mL，混匀，室温孵育 5 分钟',      '后续步骤：同上 TRIzol 法，进行分相、沉淀、洗涤',      '',      '【miRNA 提取试剂盒法（miRNeasy）】',      '裂解：细胞/组织加入 QIAzol 裂解液，匀浆或超声破碎',      '抽提：加入氯仿，振荡，离心取水相',      '结合：加入 1.5 倍体积无水乙醇，混合后过柱',      '洗涤：依次用 RWT 和 RPE 缓冲液洗涤',      '洗脱：RNase Free 水洗脱，得到含 miRNA 的 total RNA',      '',      '【miRNA 质控】',      '浓度测定：Nanodrop/Qubit 测定浓度，OD260/280 ≈ 2.0',      '完整性检测：Agilent Bioanalyzer Small RNA chip，检测 18-30nt small RNA 峰',      'A260/A230 > 2.0：无酚/盐污染',      '保存：-80℃保存，避免反复冻融'
    ],
    tips: [
      '体液样本避免溶血，溶血会导致 miRNA 降解和污染',
      'carrier RNA（如 cel-miR-39）用于监测提取效率，回收率 80-120%',
      'small RNA 在异丙醇沉淀时需加入糖原助沉淀，防止丢失',
      '血浆/血清 miRNA 浓度低，建议用专用试剂盒富集 small RNA',
      'miRNA 保存加 RNase 抑制剂，-80℃ 保存避免反复冻融'
    ],
  },
  {
    id: 'mirna-seq',
    title: 'miRNA 表达谱分析（miRNA-seq）实验指南',
    category: '分子生物学',
    icon: Dna,
    iconColor: 'text-violet-600',
    bgColor: 'bg-violet-50',
    difficulty: '中级' as const,
    duration: '2-3天',
    description: 'miRNA-seq 是目前最全面的 miRNA 表达谱分析技术，能够检测样本中所有 miRNA 的表达丰度，发现新 miRNA 以及 isomiRs（序列变体）。比微阵列芯片灵敏度更高，可定量低丰度 miRNA。',
    steps: [
      '【样本准备】',      '细胞/组织收集：新鲜样本迅速冷冻于液氮，-80℃保存',      'total RNA 提取：使用 miRNeasy Mini Kit 或 TRIzol，保存于 -80℃',      'RNA 质控：Agilent Bioanalyzer 或 Fragment Analyzer 检测 RIN 值 >7.0',      '浓度测定：Nanodrop/Qubit 定量，确保 >1μg total RNA',      '',      '【small RNA 文库构建】',      '接头连接：在 3\'端和 5\'端依次连接接头（使用 T4 RNA Ligase）',      '反转录：使用 RT 引物进行逆转录，合成第一链 cDNA',      'PCR 扩增：使用含 barcode 的引物进行 12-15 个循环的 PCR',      '文库纯化：PAGE 凝胶（6-8%）电泳分离，切取 140-160bp 区域（对应 18-30nt miRNA）',      '文库质控：Agilent Bioanalyzer 检测文库大小分布和浓度',      '',      '【测序与数据分析】',      '上机测序：Illumina NovaSeq/NextSeq，SE50 或 SE75',      '数据预处理：去除接头序列、低质量 reads、长度过滤（18-35nt）',      '比对：将 clean reads 比对到 miRBase、GENCODE 等 miRNA 数据库',      '定量：使用 RPM/TPM 定量 miRNA 表达水平',      '差异分析：DESeq2/edgeR 进行组间差异分析（Fold change >2, p < 0.05）',      'isomiRs 分析：检测 miRNA 序列的末端修饰和变异',      '新 miRNA 预测：对无法比对到已知 miRNA 的 reads 进行折叠分析，预测novel miRNA',      '下游分析：Target prediction、KEGG/GO 富集分析、PPI 网络构建'
    ],
    tips: [
      'RNA 质量要求 RIN > 7.0，浓度 > 1μg 才能进行文库构建',
      '接头连接效率受 RNA 片段化程度影响，接头需完全去除杂质',
      'PCR 循环数控制在 12-15 轮，过多会导致文库偏好性',
      '文库大小切胶范围 140-160bp，对应 18-30nt miRNA',
      '测序深度建议 > 10M reads，保证低丰度 miRNA 的检测'
    ],
  },
  {
    id: 'mirna-qpcr-lna',
    title: 'miRNA qPCR 检测（LNA 茎环法）实验指南',
    category: '分子生物学',
    icon: Dna,
    iconColor: 'text-purple-600',
    bgColor: 'bg-purple-50',
    difficulty: '中级' as const,
    duration: '4-5小时',
    description: 'LNA（锁核酸）修饰的茎环 qPCR 是 miRNA 定量的金标准方法。LNA 修饰可增强引物与 miRNA 的结合亲和力，实现对单碱基差异 miRNA 的高特异性检测，灵敏度可达 10 拷贝。',
    steps: [
      '【逆转录反应（茎环法）】',      '设计茎环逆转录引物：针对目标 miRNA 序列设计特异性 RT primer（包含通用茎环结构）',      'RT 反应体系：total RNA 1-2μg，RT primer 1μL，逆转录酶 1μL，dNTP 2μL，5× Buffer 4μL，RNase Free 水补至 20μL',      'RT 程序：16℃ 30min → 42℃ 60min → 70℃ 10min → 4℃ Hold',      '',      '【qPCR 检测】',      '设计 qPCR 引物：Forward primer 为 miRNA 序列的前 10-12nt，Reverse primer 为通用茎环序列',      'LNA 修饰：miRNA Forward primer 建议进行 LNA 修饰，提高Tm值和特异性',      'qPCR 体系：cDNA 2μL，Forward primer (5μM) 1μL，Reverse primer (5μM) 1μL，SYBR Green Master Mix 10μL，水补至 20μL',      'qPCR 程序：95℃ 2min → (95℃ 15s → 60℃ 30s) × 40 cycles → 熔解曲线',      '',      '【数据处理】',      'Ct 值判定：以目的 miRNA 的 Ct 值 - 内参（如 U6/snRNA）的 Ct 值 = ΔCt',      '相对定量：2^(-ΔΔCt) 法计算表达量变化',      '特异性验证：熔解曲线应为单峰，Tm 值与预期一致',      '',      '【注意事项】',      '必须设置无模板对照（NTC）和无逆转录酶对照（RT-）',      '每个样本设 3 个技术复孔，CV 值应 <5%',      '茎环法只能检测有序列信息的 miRNA，新发现的 miRNA 需先设计引物'
    ],
    tips: [
      '茎环逆转录引物需针对每个 miRNA 单独设计，不可通用',
      'LNA 修饰的 Forward primer 可提高 Tm 值 8-10℃，增加特异性',
      'cDNA 稀释后使用，避免高浓度导致非特异性扩增',
      '熔解曲线单峰代表特异性好，多峰提示有非特异性扩增',
      '内参选择 U6 或 snRNA，同批次样本比较'
    ],
  },
  {
    id: 'mirna-mimics-inhibitors',
    title: 'miRNA mimics/inhibitors 转染实验指南',
    category: '分子生物学',
    icon: Dna,
    iconColor: 'text-indigo-600',
    bgColor: 'bg-indigo-50',
    difficulty: '中级' as const,
    duration: '1-2天',
    description: 'miRNA mimics（模拟物）和 inhibitors（抑制剂）是 miRNA 功能研究的核心工具。mimics 用于过表达 miRNA（功能获得），inhibitors 用于封闭内源 miRNA（功能缺失）。也可使用 miRNA sponges 实现长效封闭。',
    steps: [
      '【miRNA mimics 转染（功能获得）】',      '设计/选择：使用已验证的 mimic 序列（通常 2\'-O-methyl 修饰增强稳定性）',      '细胞接种：6孔板接种 0.5-1×10⁵ cells/well，37℃培养至 60-80% 汇合度',      '复合物配制：Opti-MEM 稀释 mimics (30-100nM) + Lipofectamine RNAiMAX',      '转染：加入复合物，37℃培养 24-72 小时',      '效果检测：48 小时后 qPCR 检测过表达效果，Western Blot 检测下游靶基因变化',      '',      '【miRNA inhibitors 转染（功能缺失）】',      '设计/选择：antimiR 或 miRNA inhibitor，单链LNA或2\'-O-methyl修饰',      '细胞接种：同上',      '复合物配制：Opti-MEM 稀释 inhibitors (50-200nM) + Lipofectamine RNAiMAX',      '转染：同上',      '效果检测：qPCR 检测敲低效果，Western Blot 检测靶基因表达上调',      '',      '【miRNA sponges（长效封闭）】',      '设计：合成包含多个 miRNA 结合位点的 RNA 序列（每个位点间隔 4nt）',      '载体构建：克隆至慢病毒表达载体（如 pLVX-miR-Sponge）',      '包装病毒：293T 细胞包装慢病毒',      '感染：感染目标细胞，嘌呤霉素筛选建立稳定细胞系',      '验证：qPCR 检测 sponge 表达水平，功能验证封闭效果',      '',      '【阳性/阴性对照】',      '阳性对照：已知有效 mimic/inhibitor 的 miRNA（如 miR-21）',      '阴性对照： scrambled sequence (NC mimic/inhibitor)',      ' transfection control: FAM 标记 NC mimic 监测转染效率'
    ],
    tips: [
      'mimics 和 inhibitors 转染浓度需优化，过高会导致细胞毒性',
      'FAM 标记的 NC mimic 可监测转染效率，确保 > 80% 细胞发光',
      'mimics 过表达效果检测在 48 小时，inhibitors 敲低在 72 小时',
      '阳性对照 miRNA 选 miR-21 或 let-7a，已知效果稳定',
      '多个 mimics 同时转染时注意总浓度不要过高'
    ],
  },
  {
    id: 'mirna-target-validation',
    title: 'miRNA 靶基因预测与验证实验指南',
    category: '分子生物学',
    icon: Dna,
    iconColor: 'text-pink-600',
    bgColor: 'bg-pink-50',
    difficulty: '中级' as const,
    duration: '2-3天',
    description: 'miRNA 通过与靶 mRNA 的 3\' UTR 结合抑制翻译或降解 mRNA。验证 miRNA 与靶基因的直接调控关系需要生物信息学预测结合双荧光素酶报告基因实验。',
    steps: [
      '【生物信息学靶基因预测】',      '常用数据库：TargetScan（保守性预测）、miRanda（结合自由能）、miRDB（功能注释）',      '预测内容：miRNA 结合位点（seed region: 2-8nt）、保守性、AU 含量、UTR 长度',      '筛选标准：选择 score 高、保守性好的候选靶基因',      '交叉验证：用多个数据库取交集，提高预测可靠性',      '功能富集：KEGG/GO 分析预测靶基因参与的通路',      '',      '【双荧光素酶报告基因实验】',      '构建报告载体：',      '  - 将靶基因 3\' UTR（含 miRNA 结合位点）克隆至 psiCHECK-2 载体的海肾荧光素酶基因下游',      '  - 或构建突变型 UTR（突变 miRNA 结合位点）作为阴性对照',      '细胞接种：HEK293T 或目标细胞，24孔板 60-70% 汇合度',      '共转染：',      '  - 实验组：psiCHECK-2-3\'UTR + miRNA mimics',      '  - 对照组：psiCHECK-2-3\'UTR + NC mimics',      '  - 突变组：psiCHECK-2-mut-3\'UTR + miRNA mimics',      '培养：37℃培养 24-48 小时',      '裂解： Passive Lysis Buffer 裂解细胞',      '检测：Dual-Luciferase Reporter Assay System 检测萤火虫和海肾荧光素酶活性',      '计算：海肾/萤火虫 比值（RLuc/FLuc）代表报告基因活性',      '',      '【内源性靶基因验证】',      'mRNA 水平：qPCR 检测靶基因 mRNA 表达变化',      '蛋白水平：Western Blot 检测靶蛋白表达变化',      '预期结果：过表达 miRNA → 靶基因 mRNA 降解或翻译抑制 → 蛋白表达下降',      '注意：如果仅抑制翻译而不降解 mRNA，蛋白下降但 mRNA 不变',      '',      '【功能验证（可选）】',      ' Rescue 实验：inhibitor 封闭 miRNA 同时过表达靶基因，验证表型是否恢复',      '染色质免疫沉淀（如靶基因是转录因子）：ChIP-qPCR 验证转录调控'
    ],
    tips: [
      'TargetScan、miRanda、miRDB 三个数据库取交集提高预测可靠性',
      '双荧光素酶实验需设置突变型 UTR 对照，验证结合位点特异性',
      '突变型构建时只突变 seed region（2-8nt），保持其他序列不变',
      '过表达 miRNA 同时检测靶基因 mRNA 和蛋白，双重验证',
      'Rescue 实验：共转 miRNA inhibitor + 靶基因过表达，验证直接调控'
    ],
  },
  {
    id: 'dual-luciferase-reporter',
    title: '双荧光素酶报告基因实验指南',
    category: '分子生物学',
    icon: Activity,
    iconColor: 'text-orange-600',
    bgColor: 'bg-orange-50',
    difficulty: '中级' as const,
    duration: '1-2天',
    description: '双荧光素酶报告基因实验（Dual-Luciferase Reporter Assay）是验证 DNA-RNA、蛋白-DNA 或 RNA-RNA 相互作用的经典方法。通过将预测的调控元件（如 miRNA 结合位点、启动子、转录因子结合位点）克隆至报告载体，与调控分子（miRNA、转录因子）共转染，检测萤火虫和海肾荧光素酶活性比值变化来定量评估基因表达调控。广泛应用于 miRNA 靶基因验证和转录因子调控研究。',
    steps: [
      '【报告载体构建】',      '选择载体：psiCHECK-2（含萤火虫和海肾双报告基因）、pmirGLO（含萤火虫和海肾）、或 pGL3-basic（含萤火虫）',      '靶序列选择：',      '  - miRNA 靶基因验证：3\' UTR 序列（含预测的 miRNA 结合位点）',      '  - 转录因子验证：靶基因启动子区域（含转录因子结合位点）',      '  - 突变对照：突变 miRNA 结合位点或转录因子结合位点（作为阴性对照）',      '克隆方法：',      '  - 传统酶切克隆：使用 XhoI/NotI 或多克隆位点酶切连接',      '  - 无缝克隆：Gibson Assembly 或 In-Fusion',      '  - 合成：直接合成含调控元件的基因片段',      '转化与验证：DH5α 感受态细胞转化，氨苄青霉素筛选，测序确认',      '',      '【细胞接种与共转染】',      '细胞选择：HEK293T（转染效率高）或目标细胞',      '接种密度：24孔板 60-70% 汇合度',      '实验分组：',      '  - 实验组：报告载体 + 调控分子（如 miRNA mimics）',      '  - 对照组1：报告载体 + NC mimics（验证特异性）',      '  - 对照组2：突变报告载体 + 调控分子（验证结合位点）',      '  - 空白组：报告载体 only（基线活性）',      '转染试剂：Lipofectamine 3000 或 RNAiMAX（如同时转染 siRNA）',      '',      '【细胞裂解】',      '培养时间：37℃培养 24-48 小时',      '裂解：吸去培养基，PBS 洗涤 1 次',      '被动裂解：加入 100μL Passive Lysis Buffer，室温摇晃 15 分钟',      '离心：12000rpm 离心 1 分钟，取上清',      '',      '【荧光素酶检测】',      '萤火虫荧光素酶检测：',      '  - 取 20μL 细胞裂解液加入检测板',      '  - 加入 100μL 萤火虫荧光素酶检测试剂（Luciferase Reagent）',      '  - 读数（FLuc 单位）',      '海肾荧光素酶检测：',      '  - 加入 100μL Stop & Glo Reagent（终止萤火虫反应并启动海肾反应）',      '  - 读数（RLuc 单位）',      '计算：RLuc/FLuc 比值代表报告基因活性',      '',      '【数据处理与分析】'
    ],
    tips: [
      '萤火虫和海肾荧光素酶活性需分别设阳性对照验证试剂有效性',
      '细胞裂解后尽快检测，放置过久会导致酶活性下降',
      '报告载体和调控分子共转染比例需优化（1:1 到 1:3）',
      '每个实验组设置 3 个技术复孔，CV 值应 < 10%',
      '海肾荧光素酶做内参归一化，消除转染效率差异'
    ],
  },
  {
    id: 'mirna-body-fluid-ultrasensitive',
    title: '体液 miRNA 超敏检测（SE-SPTM-PCR）实验指南',
    category: '分子生物学',
    icon: Dna,
    iconColor: 'text-cyan-600',
    bgColor: 'bg-cyan-50',
    difficulty: '高级' as const,
    duration: '1-2天',
    description: '血浆、血清、尿液等体液中 miRNA 浓度极低（<1ng/mL），常规方法难以检测。选择性富集与探针特异性末端介导的茎环 qPCR（SE-SPTM-PCR）等超敏检测平台可实现 fM 级别的检测。',
    steps: [
      '【体液样本收集与处理】',      '血液采集：使用 EDTA 或血清分离管，采集后 30 分钟内处理',      '离心：1500g 离心 10 分钟，取血浆/血清，避免溶血',      '分装：-80℃分装保存，避免反复冻融（最多 3 次）',      '尿液：收集中段晨尿，3000g 离心 10 分钟，取上清 -80℃保存',      '',      '【miRNA 提取（富集 small RNA）】',      '体积排除法：使用 miRNAeasy Serum/Plasma Kit 等通过柱子选择性结合 small RNA',      '酸酚法：TRIzol LS 用于体液样本，提取 total RNA（包括 small RNA）',      'carrier RNA：提取时加入外源 miRNA（如 cel-miR-39）作为提取对照',      '质控：检测260/280 ratio，OD230 等指标',      '',      '【SE-SPTM-PCR 超敏检测】',      '选择性问题探针：设计针对目标 miRNA 的探针（带生物素标记）',      '探针-目标杂交：样本 RNA 与探针杂交，目标 miRNA 与探针特异性结合',      '富集：通过链霉亲和素磁珠捕获杂交复合物',      '洗涤：去除非特异性结合',      '茎环 qPCR：对富集的 miRNA 进行逆转录和 qPCR 检测',      '信号放大：由于富集步骤，检测灵敏度可提高 100-1000 倍',      '',      '【标准曲线与定量】',      '合成 miRNA 标准品：人工合成目标 miRNA 序列',      '梯度稀释：10fM 到 10pM 系列稀释',      '建立标准曲线：绘制 Ct 值与浓度的关系',      '绝对定量：根据标准曲线计算样本中 miRNA 的绝对浓度（fM）',      '',      '【质量控制】',      '提取对照：cel-miR-39 用于监测提取效率（加入量已知，回收率 80-120%）',      'RT 效率：使用 U6 或其他内参校正',      '阴性对照：健康样本 pool 作为阴性对照',      '阳性对照：已知浓度的人工合成 miRNA'
    ],
    tips: [
      'carrier RNA cel-miR-39 加入量需精确，回收率 80-120% 为合格',
      '磁珠捕获后充分洗涤，去除非特异性结合，降低背景',
      '标准曲线用合成 miRNA 梯度稀释绘制，检测限可达 fM 级别',
      '健康样本 pool 作为阴性对照，用于判断检测背景',
      '提取和检测全程 RNase Free 操作，防止 miRNA 降解'
    ],
  },
  {
    id: 'lncrna-transcriptome-seq',
    title: 'lncRNA 全转录组测序（Whole Transcriptome Sequencing）实验指南',
    category: '分子生物学',
    icon: Dna,
    iconColor: 'text-violet-600',
    bgColor: 'bg-violet-50',
    difficulty: '中级' as const,
    duration: '2-3天',
    description: '全转录组测序采用 Ribo-zero 链特异性建库方法，可同时鉴定和定量 lncRNA、mRNA 和 circRNA，分析它们之间的共表达或靶向调控网络（如 ceRNA 网络），是发现和筛选 lncRNA 的首选方法。',
    steps: [
      '【样本准备与 RNA 提取】',      '细胞/组织收集：新鲜样本液氮速冻，-80℃保存',      'total RNA 提取：TRIzol 或 miRNeasy Kit，注意避免 RNase 污染',      'RNA 质控：Agilent Bioanalyzer 检测 RIN > 8.0，28S/18S > 1.5',      '浓度测定：Nanodrop/Qubit，确保 > 5μg total RNA',      '',      '【rRNA 去除（Ribo-zero）】',      '去除核糖体 RNA：使用 Ribo-Zero Kit 去除 rRNA（28S、18S、5S）',      '或使用 Poly(A) 捕获 mRNA + 去除 rRNA 的组合方法',      '质控：检测 rRNA 去除效率 > 95%',      '',      '【链特异性文库构建】',      '片段化：使用二价金属离子或酶法将 RNA 打断为 150-200nt 片段',      '逆转录：使用链特异性逆转录酶，合成第一链 cDNA',      '第二链合成：加入 dUTP 标记第二链（保持链特异性）',      '接头连接：两端连接 Illumina 接头',      'PCR 扩增：使用 index 引物进行 12-15 个循环扩增',      '文库质控：Agilent Bioanalyzer 检测文库大小分布（200-500bp）',      '',      '【测序与数据分析】',      '上机测序：Illumina NovaSeq/NextSeq，PE150 或 PE125',      '数据预处理：去除接头、低质量 reads、rRNA 污染 reads',      '比对：将 clean reads 比对到参考基因组（STAR/HISAT2）',      '转录本组装：StringTie/Cufflinks 进行组装',      'lncRNA 鉴定：筛选长度 > 200nt、不编码蛋白、具有保守二级结构的转录本',      '定量：FPKM/TPM 定量 lncRNA 和 mRNA 表达',      '差异分析：DESeq2/edgeR 进行组间差异分析',      'ceRNA 网络分析：使用 miRanda/TargetScan 预测 miRNA-lncRNA-mRNA 轴',      '共表达分析：WGCNA 构建基因共表达网络，解析 lncRNA 功能'
    ],
    tips: [
      'Ribo-zero 去除 rRNA 效率 > 95%，不足时会影响 lncRNA 检出',
      '链特异性文库构建可保留正义链信息，区分 lncRNA 天然正义链',
      '文库片段化控制在 150-200bp，过长会导致测序质量下降',
      '测序深度 PE150 建议 > 30M reads，保证低丰度转录本覆盖',
      'lncRNA 鉴定需去除编码蛋白的转录本（长度 > 200nt）'
    ],
  },
  {
    id: 'lncrna-crispr-screen',
    title: 'CRISPR lncRNA 功能性筛选实验指南',
    category: '分子生物学',
    icon: Dna,
    iconColor: 'text-purple-600',
    bgColor: 'bg-purple-50',
    difficulty: '高级' as const,
    duration: '1-2周',
    description: 'CRISPR 功能性筛选利用 CRISPR/Cas9 系统对 lncRNA 进行高通量功能筛选。可使用成对 gRNA 介导的大片段删除，或靶向剪接位点的 CRISPR 文库诱导外显子缺失，实现 lncRNA 的完全敲除。',
    steps: [
      '【文库选择与设计】',      '全基因组 CRISPR 文库：如 GeCKO v2，包含 190,000+ gRNA，覆盖 18,000+ 基因和 20,000+ lncRNA',      '靶向剪接位点文库：设计 gRNA 靶向 lncRNA 外显子-内含子边界，诱导剪接异常',      'gRNA 设计：每个 lncRNA 设计 3-5 条 gRNA，使用 CRISPRscan 或 CHOPCHOP 优化',      '文库合成：芯片合成或池合成，含 Illumina 接头序列',      '',      '【病毒包装与细胞感染】',      '文库扩增：DH5α 感受态细胞扩增质粒文库，提取 DNA',      '包装病毒：293T 细胞共转 Cas9 载体 + gRNA 文库质粒 + 包装质粒',      '病毒收集：48-72 小时收集上清，浓缩',      'MOI 测定：确定最佳感染复数（通常 MOI < 0.3 确保单克隆感染）',      '大规模感染：感染足够量的细胞（建议 > 1000x 文库复杂度）',      '',      '【筛选与表型富集】',      '阴性筛选：培养足够时间，淘汰dead cells，收集基因组 DNA',      '阳性筛选：加入药物筛选或流式分选特定表型（如 GFP+）',      '对照组：T0 代细胞（筛选前）vs T_end 代细胞（筛选后）',      '',      '【 NGS 文库制备与数据分析】',      '基因组 DNA 提取：收集细胞（> 1000万），提取基因组 DNA',      'PCR 扩增：使用特异引物扩增 gRNA 区域（加入 index 和桥接接头）',      '文库纯化：PAGE 凝胶电泳，切取 300-400bp 区域',      '测序：Illumina，SE150',      '数据分析：MAGeCK/RRA 算法计算 gene rank，CRISPRcleanR 去除脱靶效应',      '验证：对 top hits 进行 individual gRNA 验证'
    ],
    tips: [
      '文库复杂度需 > 1000x，确保覆盖所有 gRNA',
      'MOI < 0.3 保证单克隆感染，避免多重感染导致假阳性',
      '阴性筛选培养足够时间（14-21 天），确保表型充分表达',
      '阳性筛选加药浓度需预先确定，诱导充分死亡',
      'NGS 测序深度 > 50M reads，保证 gRNA 覆盖度'
    ],
  },
  {
    id: 'lncrna-gain-loss',
    title: 'lncRNA 功能获得与缺失研究实验指南',
    category: '分子生物学',
    icon: Dna,
    iconColor: 'text-indigo-600',
    bgColor: 'bg-indigo-50',
    difficulty: '中级' as const,
    duration: '1-2天',
    description: 'lncRNA 功能研究的核心策略包括敲低（Knockdown）和过表达（Overexpression）。可使用 siRNA/shRNA 进行敲降，CRISPR-Cas9 进行敲除，或 CRISPRi/CRISPRa 进行转录水平调控，以及 cDNA 克隆进行过表达。',
    steps: [
      '【lncRNA 敲低（Knockdown）】',      'siRNA 设计：选择 lncRNA 特异性区域（非重复序列），避免脱靶效应',      'shRNA 设计：构建 shRNA 表达载体（pLKO.1 或 Tet-On 诱导系统）',      '转染：Lipofectamine RNAiMAX 转染 siRNA（48-72 小时敲低）',      '慢病毒感染：包装 shRNA 病毒，感染建立稳定敲低细胞系',      '验证：qPCR 检测敲低效率 > 70%',      '',      '【lncRNA 敲除与调控（Knockout & Regulation）】',      'CRISPR-Cas9 敲除：设计 gRNA 靶向 lncRNA 启动子或外显子，诱导大片段删除',      'CRISPRi：使用 dCas9-KRAB 融合蛋白，在转录起始位点（TSS）附近结合，抑制转录',      'CRISPRa：使用 dCas9-SunTag 或 dCas9-VP64 激活结构域，在 TSS 上游结合，激活转录',      '验证：qPCR 检测表达变化，Western Blot 检测下游靶基因',      '',      '【lncRNA 过表达（Overexpression）】',      'cDNA 克隆：扩增 lncRNA 全长或特定结构域，克隆至 pcDNA3.1、pLVX 或慢病毒载体',      '转染：Lipofectamine 3000 转染过表达质粒',      '稳定细胞系：包装慢病毒，嘌呤霉素筛选，建立稳定过表达细胞系',      '验证：qPCR 检测过表达效率，Northern Blot 验证转录本大小',      '',      '【对照设置】',      '阴性对照：Scramble siRNA 或空载体',      '阳性对照：已知敲低/过表达效率的 lncRNA siRNA/载体',      '拯救实验：敲低 + 过表达回复验证功能特异性'
    ],
    tips: [
      'siRNA 设计避免 lncRNA 重复序列区域，选择特异性区域',
      'CRISPRi 靶向 TSS 上游 200bp，抑制转录起始',
      'CRISPRa 激活转录需在 TSS 上游 500bp 内放置 gRNA',
      '过表达载体用慢病毒可实现稳定细胞系构建',
      '拯救实验：敲低 + 过表达回复验证功能特异性'
    ],
  },
  {
    id: 'lncrna-subcellular-localization',
    title: 'lncRNA 亚细胞定位实验指南',
    category: '分子生物学',
    icon: Dna,
    iconColor: 'text-teal-600',
    bgColor: 'bg-teal-50',
    difficulty: '中级' as const,
    duration: '3-4小时',
    description: 'lncRNA 的亚细胞定位决定了其作用模式。核内 lncRNA 主要参与染色质修饰和转录调控，细胞质 lncRNA 主要作为 ceRNA 或调控翻译。通过核质分离 qPCR 或 RNA-FISH 确定 lncRNA 的定位。',
    steps: [
      '【细胞核-细胞质分离】',      '细胞收集：PBS 洗涤，刮下细胞，4℃离心',      '细胞裂解：使用 NP-40 裂解缓冲液（含 RNase 抑制剂）',      '低速离心：700g 4℃离心 5 分钟，上清为胞质部分',      '核沉淀洗涤：核沉淀用裂解缓冲液洗涤 2 次',      '分别提取 RNA：TRIzol 分别提取核 RNA 和胞质 RNA',      '注意：整个操作 4℃进行，防止 RNase 降解',      '',      '【核质分离 qPCR 检测】',      '逆转录：分别对核 RNA 和胞质 RNA 进行逆转录',      'qPCR：检测目标 lncRNA 和对照基因',      '对照基因：',      '  - 胞质对照：GAPDH、ACTB（胞质富集）',      '  - 核对照：NEAT1、MALAT1（核富集）',      '计算：核/胞质比例，判断 lncRNA 主要定位',      '',      '【RNA-FISH（荧光原位杂交）】',      '探针设计：设计 30-50nt 生物素或荧光素标记的寡核苷酸探针',      '细胞固定：4% PFA 固定细胞爬片，PBS 洗涤',      '通透：0.3% Triton X-100 通透 10 分钟',      '杂交：探针与细胞在 37℃杂交过夜',      '洗涤：SSC 缓冲液洗涤，去除未结合探针',      '检测：荧光二抗（Streptavidin-Cy3 或抗荧光素抗体）',      '核染色：DAPI 染核',      '成像：共聚焦显微镜观察荧光信号定位'
    ],
    tips: [
      '核质分离全程 4℃ 操作，防止 RNase 降解 RNA',
      '核沉淀洗涤轻柔，避免核膜破裂导致核内 RNA 污染胞质',
      'NEAT1 和 MALAT1 作为核定位对照，胞质 fraction 不应检出',
      'GAPDH 和 ACTB 作为胞质定位对照，核 fraction 不应检出',
      'RNA-FISH 探针设计避免与重复序列结合，防止非特异性信号'
    ],
  },
  {
    id: 'lncrna-interaction-capture',
    title: 'lncRNA 互作分子捕获实验指南',
    category: '分子生物学',
    icon: Dna,
    iconColor: 'text-pink-600',
    bgColor: 'bg-pink-50',
    difficulty: '高级' as const,
    duration: '2-3天',
    description: 'lncRNA 通过与 DNA、蛋白或 RNA 分子相互作用发挥功能。ChIRP-seq/CHART-seq 用于捕获 lncRNA 结合的 DNA 染色质；ChIRP-MS/RAP-MS 用于捕获 lncRNA 结合的蛋白；RIP-seq 用于验证 lncRNA 与特定 RNA 结合蛋白（RBP）的相互作用。',
    steps: [
      '【ChIRP-seq / CHART-seq（lncRNA-染色质相互作用）】',      '探针设计：设计 30-40 个 3\'端生物素标记的寡核苷酸探针，覆盖 lncRNA 全长',      '细胞交联：4% 甲醛交联 10 分钟，终止反应（甘氨酸）',      '细胞裂解：细胞核分离，染色质超声打断（200-500bp）',      '杂交：探针与染色质在 37℃杂交 4 小时',      '链霉亲和素磁珠捕获：捕获探针-lncRNA-染色质复合物',      '洗涤：严格洗涤去除非特异性结合',      'DNA 洗脱：蛋白酶 K 消化，苯酚氯仿抽提获取 DNA',      '文库构建：End repair + A-tailing +接头连接 + PCR',      '测序与分析：Illumina 测序，MACS 分析 peak，motif 分析',      '',      '【ChIRP-MS / RAP-MS（lncRNA-蛋白相互作用）】',      '探针设计：同上，针对 lncRNA 设计生物素探针',      '交联与裂解：轻交联（UV 254nm）5 分钟，细胞裂解',      '杂交与捕获：探针与细胞裂解液杂交，链霉亲和素磁珠捕获',      '洗涤：严格洗涤去除非特异性蛋白',      '蛋白洗脱：蛋白酶 K 消化，Trypsin 酶解',      '质谱检测：LC-MS/MS 鉴定蛋白',      '数据分析：与 IgG 对照比较，筛选特异性结合蛋白',      '',      '【RIP-seq（lncRNA-RBP 相互作用验证）】',      '抗体选择：选择目标 RBP 的特异性抗体 + IgG 对照',      '细胞裂解：RIPA 缓冲液裂解，RNA 酶抑制剂保护',      '免疫沉淀：抗体磁珠 4℃孵育 2 小时',      '洗涤：低盐/高盐缓冲液洗涤，去除非特异性结合',      'RNA 洗脱：蛋白酶 K + 苯酚氯仿抽提获取 RNA',      'qPCR 检测：检测目标 lncRNA  enrichment',      '建库测序（如需要）：将捕获的 RNA 进行文库构建和高通量测序'
    ],
    tips: [
      '探针设计覆盖 lncRNA 全长，30-40 条探针效果最佳',
      '交联程度影响 ChIRP 效率，过度交联会导致背景增加',
      '磁珠捕获后严格洗涤，高盐和 LiCl 可去除非特异性结合',
      'IgG 对照设置必不可少，用于扣除背景信号',
      '蛋白洗脱用 Trypsin 酶解，LC-MS/MS 鉴定需设置复孔'
    ],
  },
  {
    id: 'chip-seq',
    title: '染色质免疫共沉淀（ChIP/ChIP-seq）实验指南',
    category: '分子生物学',
    icon: Dna,
    iconColor: 'text-blue-600',
    bgColor: 'bg-blue-50',
    difficulty: '高级' as const,
    duration: '2-3天',
    description: 'ChIP（Chromatin Immunoprecipitation）是研究蛋白质与 DNA 相互作用的"金标准"方法。通过特异性抗体富集与目标蛋白（如转录因子、组蛋白修饰）结合的 DNA 片段，结合 qPCR（ChIP-qPCR）或高通量测序（ChIP-seq），可以精准定位蛋白在基因组上的结合位点，解析基因转录调控机制。',
    steps: [
      '【细胞交联与样本制备】',      '细胞培养：培养目标细胞至 80-90% 汇合度（约 1×10⁷ cells）',      '交联：加入 1% 甲醛，室温摇晃 10 分钟，终止反应（甘氨酸 0.125M）',      '洗涤：PBS 洗涤 2 次，液氮速冻，-80℃保存',      '',      '【染色质断裂】',      '细胞裂解：加入细胞裂解缓冲液（含 RNase 抑制剂）',      '超声打断：使用 Bioruptor 或 Covaris 超声破碎，typical settings: 30s ON / 30s OFF, 20-25 cycles',      '验证：取 20μL 样本，蛋白酶 K 消化后电泳检测，DNA 片段应为 200-500bp',      '',      '【免疫沉淀】',      '预清除：加入 Protein A/G beads，4℃旋转 1 小时，减少非特异性',      '一抗孵育：加入目标蛋白特异性抗体（1-5μg），4℃旋转过夜',      'IgG 对照：设置同物种 IgG 作为阴性对照',      ' beads 结合：加入 30μL Protein A/G beads，4℃旋转 2 小时',      '',      '【洗涤与洗脱】',      '低盐洗涤：RIPA 缓冲液洗涤 3 次',      '高盐洗涤：High salt RIPA 洗涤 1 次',      'LiCl 洗涤：LiCl 缓冲液洗涤 1 次（去除非特异性蛋白-DNA 结合）',      'TE 洗涤：TE 缓冲液洗涤 2 次',      '洗脱：加入 Elution Buffer，65℃ 15 分钟洗脱',      '',      '【去交联与 DNA 纯化】',      '去交联：加入 NaCl，65℃ 孵育 4 小时或过夜',      '蛋白酶 K 处理：加入蛋白酶 K，45℃ 30 分钟',      'DNA 纯化：苯酚氯仿抽提或使用 DNA 纯化试剂盒',      '',      '【ChIP-qPCR 或 ChIP-seq】',      'ChIP-qPCR：使用目的基因引物进行 qPCR，计算 Enrichment %',      'ChIP-seq：文库构建（End repair + A-tailing + adapter + PCR），测序'
    ],
    tips: [

    ],
  },
  {
    id: 'coip',
    title: '免疫共沉淀（Co-IP）实验指南',
    category: '蛋白研究',
    icon: Brain,
    iconColor: 'text-cyan-600',
    bgColor: 'bg-cyan-50',
    difficulty: '高级' as const,
    duration: '1-2天',
    description: 'Co-IP（Co-Immunoprecipitation）是研究蛋白质与蛋白质相互作用的核心方法。利用抗体捕获目标蛋白及其天然结合的蛋白复合物，通过 Western Blot 或质谱（MS）进行鉴定，是探索信号通路上下游关系和蛋白复合物组成的常用手段。',
    steps: [
      '【细胞裂解（温和条件）】',      '收集细胞：PBS 洗涤，刮下细胞，4℃离心',      '裂解缓冲液：使用 NP-40 或 RIPA 缓冲液（不含 SDS），加入蛋白酶抑制剂和磷酸酶抑制剂',      '裂解：冰上裂解 30 分钟，期间轻柔振荡',      '离心：14000rpm，4℃离心 15 分钟，取上清',      '蛋白定量：BCA 法测定浓度，调整各样本至相同浓度',      '',      '【预清除（减少非特异性）】',      '加入 20μL Protein A/G beads，4℃旋转 1 小时',      '离心取上清，此步骤可去除与 beads 非特异性结合的蛋白',      '',      '【免疫沉淀】',      '抗体孵育：加入目标蛋白抗体（1-10μg），4℃旋转过夜',      'beads 结合：加入 30-50μL Protein A/G beads，4℃旋转 2-4 小时',      '离心：4℃离心 3000rpm 1 分钟，弃上清',      '洗涤：依次用裂解缓冲液、低盐缓冲液、高盐缓冲液洗涤各 3 次',      '',      '【洗脱与检测】',      '洗脱：加入 2× Loading Buffer，100℃煮沸 5 分钟',      'Western Blot：一抗 + 二抗孵育，显影',      '检测蛋白：通过抗体检测目标蛋白及其潜在互作蛋白',      '',      '【质谱分析（可选）】',      '银染：SDS-PAGE 银染后切取差异条带',      '胰酶消化：Trypsin 酶解',      'LC-MS/MS：质谱鉴定蛋白',      '数据分析：与 IgG 对照比较，筛选特异性互作蛋白'
    ],
    tips: [
      '裂解用 NP-40 缓冲液（不含 SDS），保持蛋白天然构象',
      '抗体用量需优化，过多会导致轻链污染，影响检测',
      'IgG 对照与实验组条件完全一致，用于判断非特异性结合',
      '洗涤力度要平衡：太松导致非特异性，太紧可能破坏互作',
      '银染检测差异条带时注意背景控制，避免过高背景干扰'
    ],
  },
  {
    id: 'molecular-cloning',
    title: '分子克隆与重组蛋白表达实验指南',
    category: '分子生物学',
    icon: Dna,
    iconColor: 'text-amber-600',
    bgColor: 'bg-amber-50',
    difficulty: '中级' as const,
    duration: '3-5天',
    description: '分子克隆是分子生物学最基础的操作，通过将目的基因插入表达载体，转化到大肠杆菌、酵母或哺乳动物细胞中，诱导并纯化出重组蛋白，用于后续的结构分析、抗体生产或功能实验。',
    steps: [
      '【目的基因获取与引物设计】',      '引物设计：两端添加限制性内切酶位点或同源臂（20-25bp）',      '高保真 PCR：使用高保真 DNA 聚合酶扩增目的基因',      '纯化：PCR 产物电泳后切胶纯化',      '',      '【载体准备】',      '选择载体：根据表达系统选择（细菌：pET 系列；酵母：pPICZα；哺乳动物：pcDNA3.1、pLVX）',      '酶切：使用相应限制性内切酶线性化载体',      '纯化：凝胶回收纯化',      '',      '【连接反应】',      '传统酶连：T4 DNA Ligase，16℃过夜',      '无缝克隆：Gibson Assembly 或 In-Fusion，50℃ 30 分钟',      '转化：连接产物转化 DH5α 感受态细胞',      '抗性筛选：含相应抗生素的 LB 平板筛选',      '',      '【重组载体验证】',      ' Colony PCR：快速鉴定阳性克隆',      '酶切验证：双酶切确认插入片段大小正确',      '测序：Sanger 测序确认序列正确',      '',      '【重组蛋白表达】',      '原核表达：转化 Rosetta/BL21(DE3)，0.5mM IPTG 诱导 4-6 小时',      '真核表达：转染 HEK293T 或 CHO 细胞，或包装慢病毒感染建立稳定细胞系',      '表达检测：Western Blot 或 ELISA 检测蛋白表达',      '',      '【蛋白纯化】',      '标签选择：His-tag（Ni-NTA）、GST-tag（Glutathione Sepharose）、MBP-tag（Amylose Resin）',      '细胞破碎：超声或溶菌酶裂解',      '亲和纯化：使用对应树脂进行亲和层析',      '去除标签：如有需要，使用相应蛋白酶切除标签',      '纯度检测：SDS-PAGE 染色确认纯度'
    ],
    tips: [
      '高保真 PCR 延伸时间按 1kb/分钟计算，片段过长需分段扩增',
      'Gibson Assembly 无缝克隆比传统酶切连接效率更高',
      '转化用 DH5α 感受态细胞，效率 > 10⁸ cfu/μg DNA',
      '阳性克隆需测序确认，避免突变影响蛋白表达',
      'His-tag 纯化时咪唑浓度需优化，20mM 洗杂质，250mM 洗目标蛋白'
    ],
  },
  {
    id: 'single-cell-multiomics',
    title: '单细胞测序与空间组学技术实验指南',
    category: '单细胞分析',
    icon: Activity,
    iconColor: 'text-violet-600',
    bgColor: 'bg-violet-50',
    difficulty: '高级' as const,
    duration: '1-3天',
    description: '单细胞测序技术能够解析单个细胞的基因表达谱，揭示组织或肿瘤内部高度异质性的细胞亚群。空间组学技术在单细胞测序基础上进一步保留空间位置信息，将分子特征与组织形态完美结合。',
    steps: [
      '【单细胞悬液制备】',      '组织处理：新鲜组织剪刀剪碎，酶消化（胶原酶 IV + 透明质酸酶）',      '过滤：使用 40μm 细胞滤网去除团块',      '红细胞裂解：如需要，RBC Lysis Buffer 处理',      '活率检测：台盼蓝染色，活率 >85%',      '浓度调整：700-1200 cells/μL',      '',      '【10× Genomics 单细胞 RNA-seq】',      '细胞加载：Chromium Controller 将单个细胞与 Gel Beads + 酶混合物包裹在油滴中',      'GEMs 形成：每个油滴形成一个 GEM，包含一个细胞',      '逆转录：GEMs 中进行逆转录，生成 cDNA',      '破油回收：加入破裂液，回收 cDNA',      '文库构建：PCR 扩增 + 片段化 + 接头连接',      '测序：Illumina NovaSeq，SE75 或 PE150',      '数据分析：Cell Ranger → Seurat → 细胞注释',      '',      '【单细胞 ATAC-seq（染色质可及性）】',      '细胞核制备：通透细胞核，染色质开放',      'Tn5 转座：标记开放染色质区域',      '文库构建：PCR 扩增带有 index 的片段',      '测序与分析：解析单细胞层面的染色质开放状态',      '',      '【空间组学技术】',      'Visium (10× Genomics)：组织切片放在有 spatial barcode 的载玻片上',      '原位捕获：mRNA 与载玻片上的 barcode 结合',      '文库构建：逆转录 + 扩增 + 测序',      '数据解析：将基因表达映射回空间位置',      'Codecelled imaging (CODEX)：利用抗体条形码 + 荧光成像进行空间蛋白检测',      '',      '【单细胞蛋白质组学】',      '微量蛋白检测：基于质谱的 Single Cell Proteomics（通量有限）',      '抗体条形码策略：AbSeq、REAP-seq 等，使用抗体偶联寡核苷酸标签',      '高通量检测：通过测序读取寡核苷酸标签，实现数十至数百种蛋白的检测',      '数据整合：scRNA-seq + 蛋白数据整合分析'
    ],
    tips: [
      '单细胞悬液活率 > 85%，碎片和团块会影响 10× Chromium 分隔',
      '细胞浓度 700-1200 cells/μL 为最佳，过低导致 GEMs 少，过高导致多细胞',
      'scATAC-seq 核制备是关键，通透程度影响 Tn5 转座效率',
      'Visium 空间切片厚度 10μm，过厚会导致透化不充分',
      'CODEX 抗体panel 需验证，避免交叉反应和光谱重叠'
    ],
  },
  {
    id: 'qpcr-qrtpcr',
    title: 'qRT-PCR（实时荧光定量 PCR）实验指南',
    category: '分子生物学',
    icon: Dna,
    iconColor: 'text-green-600',
    bgColor: 'bg-green-50',
    difficulty: '基础' as const,
    duration: '4-5小时',
    description: 'qRT-PCR（实时荧光定量 PCR）是检测特定基因 mRNA 表达水平最灵敏、最经济的"金标准"方法。通过荧光染料（如 SYBR Green）或探针（如 TaqMan）实时监测 PCR 扩增产物量，用于基因表达分析、临床诊断和病原体检测。',
    steps: [
      '【RNA 提取与质量控制】',      'RNA 提取：TRIzol 或商品化 RNA 提取试剂盒',      '浓度测定：Nanodrop/Qubit，OD260/280 ≈ 2.0',      '完整性检测：Agilent Bioanalyzer RIN > 8.0',      '基因组 DNA 去除：DNase I 处理',      '',      '【cDNA 合成（逆转录）】',      '体系：total RNA 1-2μg，Oligo(dT) 或 Random Primer，PrimeScript RT Master Mix 10μL，RNase Free 水补至 20μL',      '程序：37℃ 15分钟 → 85℃ 5秒 → 4℃ Hold',      '稀释：cDNA 1:5 或 1:10 稀释后作为 qPCR 模板',      '',      '【引物设计与验证】',      '原则：产物长度 80-200bp，Tm 57-63℃，GC 40-60%',      '跨外显子连接区：避免基因组 DNA 污染干扰',      '特异性验证：熔解曲线单峰表示引物特异性好',      '效率验证：标准曲线 R² > 0.99，扩增效率 90-110%',      '',      '【qPCR 反应】',      'SYBR Green 法：cDNA 2μL，Forward/Reverse primer (10μM) 各 0.4μL，SYBR Premix Ex Taq II 10μL，RNase Free 水 7.2μL',      'TaqMan 探针法：cDNA 2μL，探针 0.5μL，Primer 各 0.9μL，Master Mix 10μL，水补至 20μL',      '程序：95℃ 2min → (95℃ 15s → 60℃ 30s) × 40 cycles → 熔解曲线（SYBR）或 4℃ Hold（TaqMan）',      '',      '【数据计算与分析】',      'Ct 值判定：阈值线在扩增曲线指数期，读取各孔 Ct 值',      '内参选择：GAPDH、β-actin、18S rRNA 等，常用 2^-ΔΔCt 法',      '相对定量：ΔCt = Ct(目的基因) - Ct(内参)，ΔΔCt = ΔCt(实验组) - ΔCt(对照组)',      '表达变化：2^-ΔΔCt 表示相对于对照组的表达倍数',      '严格对照：NTC（无模板对照）确保无污染，标准品绘制标准曲线（绝对定量）'
    ],
    tips: [
      '引物设计跨外显子连接区，避免基因组 DNA 污染干扰',
      '熔解曲线单峰代表特异性好，多峰提示有非特异性扩增',
      '标准曲线 R² > 0.99，扩增效率 90-110% 才可使用',
      'cDNA 模板稀释 1:5 或 1:10，避免高浓度导致非特异性扩增',
      '内参基因建议使用 GAPDH 或 β-actin，避免使用 18S rRNA（表达太高）'
    ],
  },
];

export function getProtocolById(id: string): Protocol | undefined {
  return protocols.find(p => p.id === id);
}
