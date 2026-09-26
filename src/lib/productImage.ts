import type { Product } from '@/types/Product';
import { productCategories } from '@/data/categories';

/** L1 category hero images — prefer v2 product-style photography where available.
 *  Product photos must use generic packaging only (no real brand names or logos). */
export const CATEGORY_IMAGES: Record<string, string> = {
  '一抗': '/images/categories/primary-antibodies-v7.png',
  '二抗': '/images/categories/secondary-antibodies-v3.png',
  'ELISA试剂盒': '/images/categories/elisa-kits-v3.png',
  '蛋白和细胞系': '/images/categories/proteins-cell-v3.png',
  '生化和细胞检测试剂盒': '/images/categories/biochemical-assay-v2.png',
  '样本制备和检测试剂盒': '/images/categories/sample-prep-v2.png',
  '分子生物学': '/images/categories/molecular-biology-v3.png',
  '化学试剂': '/images/categories/chemical-reagents-v2.png',
  '细胞生物学': '/images/categories/cell-biology-v3.png',
  '材料合成': '/images/categories/materials-synthesis-v2.png',
  '仪器设备': '/images/categories/instruments-v2.png',
  '抗体偶联试剂盒': '/images/categories/antibody-conjugation-v2.png',
  '新产品': '/images/categories/new-products-v2.png',
  '核酸纯化': '/images/categories/subcategories/nucleic-acid-purification-v1.png',
};

/** L2 subcategory images for finer-grained card visuals. */
export const SUBCATEGORY_IMAGES: Record<string, string> = {
  // 一抗
  '单抗和重组抗体': '/images/categories/subcategories/monoclonal-recombinant-antibodies.png',
  '重组多抗和传统多抗': '/images/categories/subcategories/polyclonal-traditional-antibodies.png',
  '直标抗体': '/images/categories/subcategories/direct-labeled-antibodies-v1.png',
  '无载体抗体': '/images/categories/subcategories/carrier-free-antibodies-v1.png',
  '抗体组合套装': '/images/categories/subcategories/antibody-panel-kits-v1.png',
  '同型对照抗体': '/images/categories/subcategories/isotype-control-antibodies-v1.png',
  '内参抗体': '/images/categories/subcategories/loading-control-antibodies-v2.png',
  '标签抗体': '/images/categories/subcategories/tag-antibodies.png',
  'WB抗体': '/images/categories/subcategories/wb-antibodies.png',
  '流式抗体': '/images/categories/subcategories/flow-cytometry-antibodies-v1.png',
  'IHC和成像抗体': '/images/categories/subcategories/ihc-imaging-antibodies-v1.png',
  'ChIP和IP抗体': '/images/categories/subcategories/chip-ip-antibodies-v1.png',
  '磷酸化抗体': '/images/categories/primary-antibodies-v7.png',
  '细胞凋亡': '/images/categories/subcategories/apoptosis-antibodies-v1.png',
  // 二抗
  'HRP偶联二抗': '/images/categories/subcategories/hrp-secondary-antibodies.png',
  'Alexa Fluor偶联二抗': '/images/categories/subcategories/alexa-fluor-secondary-antibodies-v1.png',
  '荧光偶联二抗': '/images/categories/subcategories/fluorescent-secondary-antibodies-v1.png',
  '其它二抗': '/images/categories/subcategories/other-secondary-antibodies.png',
  '按目标种属分类': '/images/categories/subcategories/species-specific-secondary-antibodies-v1.png',
  // ELISA试剂盒
  '夹心法ELISA': '/images/categories/subcategories/sandwich-elisa-kits-v1.png',
  '竞争法ELISA': '/images/categories/subcategories/competitive-elisa-kits-v1.png',
  '抗体对和蛋白标准品': '/images/categories/subcategories/antibody-pairs-standards-v1.png',
  '抗体芯片': '/images/categories/subcategories/antibody-arrays-v1.png',
  'ELISA辅助试剂': '/images/categories/subcategories/elisa-accessory-reagents-v1.png',
  // 蛋白和细胞系
  '重组蛋白': '/images/categories/subcategories/recombinant-proteins-v1.png',
  '细胞因子': '/images/categories/subcategories/cytokines-v1.png',
  '生物活性蛋白': '/images/categories/subcategories/bioactive-proteins-v1.png',
  '多肽和封闭肽': '/images/categories/subcategories/peptides-v1.png',
  '细胞系': '/images/categories/subcategories/cell-lines-v1.png',
  '裂解液': '/images/categories/subcategories/lysates-v1.png',
  // 生化和细胞检测试剂盒
  '代谢检测试剂盒': '/images/categories/subcategories/metabolic-detection-kits-v3.png',
  '细胞健康检测试剂盒': '/images/categories/subcategories/cell-health-detection-kits-v3.png',
  '酶活检测试剂盒': '/images/categories/subcategories/enzyme-activity-assay-kits-v3.png',
  // 样本制备和检测试剂盒
  'IHC和成像试剂': '/images/categories/subcategories/ihc-imaging-reagents-v1.png',
  'WB辅助试剂': '/images/categories/subcategories/wb-auxiliary-reagents-v1.png',
  'ChIP和IP试剂': '/images/categories/subcategories/chip-ip-reagents-v1.png',
  '流式实验试剂': '/images/categories/subcategories/flow-cytometry-reagents-v1.png',
  '样本制备': '/images/categories/subcategories/sample-preparation-v1.png',
  '蛋白提取试剂': '/images/categories/subcategories/sample-preparation-v1.png',
  'RNA实验必备': '/images/categories/subcategories/nucleic-acid-purification-v1.png',
  // 分子生物学
  '小分子化合物': '/images/categories/subcategories/small-molecule-compounds-v1.png',
  '抑制剂': '/images/categories/subcategories/inhibitors-v1.png',
  '拮抗剂': '/images/categories/subcategories/antagonists-v1.png',
  '激动剂': '/images/categories/subcategories/agonists-v1.png',
  '其它化合物': '/images/categories/subcategories/other-compounds-v1.png',
  '分子生物学试剂': '/images/categories/subcategories/molecular-biology-reagents-v1.png',
  '核酸电泳试剂': '/images/categories/subcategories/molecular-biology-reagents-v1.png',
  '反转录试剂': '/images/categories/subcategories/reverse-transcription-reagents-v1.png',
  'PCR试剂': '/images/categories/subcategories/pcr-reagents-v1.png',
  '限制性内切酶': '/images/categories/subcategories/restriction-enzymes-v1.png',
  '修饰酶': '/images/categories/subcategories/modifying-enzymes-v1.png',
  'DNA分子量标准': '/images/categories/subcategories/dna-molecular-weight-standards-v1.png',
  '核酸纯化': '/images/categories/subcategories/nucleic-acid-purification-v1.png',
  '分子生物学耗材': '/images/categories/subcategories/molecular-biology-consumables-v1.png',
  // 化学试剂
  '常规化学试剂': '/images/categories/subcategories/general-chemical-reagents-v1.png',
  '标准品': '/images/categories/standard-reference-v1.png',
  '实验用药品': '/images/categories/subcategories/laboratory-pharmaceuticals-v1.png',
  // 细胞生物学
  '细胞培养试剂': '/images/categories/subcategories/cell-culture-reagents-v1.png',
  '蛋白表达系统': '/images/categories/subcategories/cell-culture-reagents-v1.png',
  '平衡盐溶液': '/images/categories/subcategories/cell-culture-reagents-v1.png',
  '抗生素': '/images/categories/subcategories/cell-culture-reagents-v1.png',
  // 材料合成
  '移液与液体处理': '/images/categories/subcategories/materials-pipetting-v2.webp',
  '管类与样本储存': '/images/categories/subcategories/materials-tubes-storage-v2.webp',
  '样品瓶与容器': '/images/categories/subcategories/materials-sample-containers-v2.webp',
  '微孔板与反应板': '/images/categories/subcategories/materials-reaction-plates-v2.webp',
  '细胞培养器皿': '/images/categories/subcategories/materials-cell-culture-v2.webp',
  '过滤与分离耗材': '/images/categories/subcategories/materials-filtration-separation-v2.webp',
  '显微镜与成像耗材': '/images/categories/subcategories/materials-microscopy-imaging-v2.webp',
  '架子、盒子与固定工具': '/images/categories/subcategories/materials-racks-holders-v2.webp',
  '采样与检测耗材': '/images/categories/subcategories/materials-sampling-testing-v2.webp',
  '个人防护与废弃物': '/images/categories/subcategories/materials-ppe-waste-v2.webp',
  '温度、冷却与常用工具': '/images/categories/subcategories/materials-temperature-tools-v2.webp',
  '专用实验耗材': '/images/categories/subcategories/materials-specialty-consumables-v2.webp',
  // 未选择三级分类时，按数据库实际子分类显示对应图片
  '吸头与移液': '/images/categories/subcategories/materials-pipetting-v2.webp',
  '离心管与冻存': '/images/categories/subcategories/materials-tubes-storage-v2.webp',
  '玻璃试管与管类': '/images/categories/subcategories/materials-tubes-storage-v2.webp',
  '容器与试剂瓶': '/images/categories/subcategories/materials-sample-containers-v2.webp',
  '酶标板与微孔板': '/images/categories/subcategories/materials-reaction-plates-v2.webp',
  'PCR与qPCR耗材': '/images/categories/subcategories/materials-reaction-plates-v2.webp',
  '细胞培养耗材': '/images/categories/subcategories/materials-cell-culture-v2.webp',
  '过滤耗材': '/images/categories/subcategories/materials-filtration-separation-v2.webp',
  '载玻片与包埋': '/images/categories/subcategories/materials-microscopy-imaging-v2.webp',
  '比色皿与光学耗材': '/images/categories/subcategories/materials-microscopy-imaging-v2.webp',
  '防护手套': '/images/categories/subcategories/materials-ppe-waste-v2.webp',
  '磁力与搅拌': '/images/categories/subcategories/materials-temperature-tools-v2.webp',
  '冰盒与冷却': '/images/categories/subcategories/materials-temperature-tools-v2.webp',
  '果蝇实验耗材': '/images/categories/subcategories/materials-specialty-consumables-v2.webp',
  '其他耗材': '/images/categories/subcategories/materials-specialty-consumables-v2.webp',
  '移液器吸头': '/images/categories/subcategories/materials-pipetting-v2.webp',
  '滤芯吸头': '/images/categories/subcategories/materials-pipetting-v2.webp',
  '无菌吸头': '/images/categories/subcategories/materials-pipetting-v2.webp',
  '普通吸头': '/images/categories/subcategories/materials-pipetting-v2.webp',
  '低吸附吸头': '/images/categories/subcategories/materials-pipetting-v2.webp',
  '自动化吸头': '/images/categories/subcategories/materials-pipetting-v2.webp',
  '移液器': '/images/categories/subcategories/materials-pipettes-v1.webp',
  '多通道移液器': '/images/categories/subcategories/materials-pipettes-v1.webp',
  '自动化移液设备': '/images/categories/subcategories/materials-pipettes-v1.webp',
  '血清移液管': '/images/categories/subcategories/materials-pipettes-v1.webp',
  '巴氏吸管': '/images/categories/subcategories/materials-pipettes-v1.webp',
  '胶头滴管': '/images/categories/subcategories/materials-pipettes-v1.webp',
  '吸球': '/images/categories/subcategories/materials-pipettes-v1.webp',
  '吸头盒/适配器': '/images/categories/subcategories/materials-pipetting-v2.webp',
  '玻璃试管': '/images/categories/subcategories/materials-test-tubes-v1.webp',
  '血清试管': '/images/categories/subcategories/materials-test-tubes-v1.webp',
  '迷你试管': '/images/categories/subcategories/materials-test-tubes-v1.webp',
  '尿沉渣管': '/images/categories/subcategories/materials-test-tubes-v1.webp',
  '试管塞': '/images/categories/subcategories/materials-test-tubes-v1.webp',
  '试管盖': '/images/categories/subcategories/materials-test-tubes-v1.webp',
  '聚四氟乙烯标准塞': '/images/categories/subcategories/materials-test-tubes-v1.webp',
  '硅胶塞': '/images/categories/subcategories/materials-test-tubes-v1.webp',
  '样本运输管': '/images/categories/subcategories/materials-test-tubes-v1.webp',
  '试管': '/images/categories/subcategories/materials-tubes-storage-v2.webp',
  '样品管': '/images/categories/subcategories/materials-tubes-storage-v2.webp',
  '离心管': '/images/categories/subcategories/materials-tubes-storage-v2.webp',
  '微量离心管/EP 管': '/images/categories/subcategories/materials-tubes-storage-v2.webp',
  '淋巴细胞分离管': '/images/categories/subcategories/materials-tubes-storage-v2.webp',
  '细胞冻存管': '/images/categories/subcategories/materials-cryostorage-v1.webp',
  '冻存管内旋': '/images/categories/subcategories/materials-cryostorage-v1.webp',
  '冻存管外旋': '/images/categories/subcategories/materials-cryostorage-v1.webp',
  '冻存盒': '/images/categories/subcategories/materials-cryostorage-v1.webp',
  '2D 冻存盒': '/images/categories/subcategories/materials-cryostorage-v1.webp',
  'SBS 冻存板架': '/images/categories/subcategories/materials-cryostorage-v1.webp',
  '程序降温盒': '/images/categories/subcategories/materials-cryostorage-v1.webp',
  '样品瓶': '/images/categories/subcategories/materials-sample-containers-v2.webp',
  '试剂瓶/滴瓶': '/images/categories/subcategories/materials-sample-containers-v2.webp',
  '培养基瓶': '/images/categories/subcategories/materials-sample-containers-v2.webp',
  '储液瓶': '/images/categories/subcategories/materials-sample-containers-v2.webp',
  '储液罐': '/images/categories/subcategories/materials-sample-containers-v2.webp',
  '储液槽/加样槽': '/images/categories/subcategories/materials-reservoirs-v1.webp',
  '瓶、罐和壶': '/images/categories/subcategories/materials-sample-containers-v2.webp',
  '细口大瓶': '/images/categories/subcategories/materials-sample-containers-v2.webp',
  '标本瓶': '/images/categories/subcategories/materials-sampling-testing-v2.webp',
  '玻璃高回收瓶': '/images/categories/subcategories/materials-sample-containers-v2.webp',
  '洗瓶': '/images/categories/subcategories/materials-sample-containers-v2.webp',
  '样本杯': '/images/categories/subcategories/materials-sampling-testing-v2.webp',
  '瓶塞和瓶盖': '/images/categories/subcategories/materials-sample-containers-v2.webp',
  '瓶盖': '/images/categories/subcategories/materials-sample-containers-v2.webp',
  'GL45 瓶盖': '/images/categories/subcategories/materials-sample-containers-v2.webp',
  '微孔板': '/images/categories/subcategories/materials-reaction-plates-v2.webp',
  '微孔过滤板': '/images/categories/subcategories/materials-reaction-plates-v2.webp',
  '深孔板': '/images/categories/subcategories/materials-reaction-plates-v2.webp',
  '酶标板': '/images/categories/subcategories/materials-reaction-plates-v2.webp',
  '酶标条': '/images/categories/subcategories/materials-reaction-plates-v2.webp',
  '血凝反应板': '/images/categories/subcategories/materials-reaction-plates-v2.webp',
  '96 孔 PCR/qPCR 板': '/images/categories/subcategories/materials-pcr-consumables-v1.webp',
  '384 孔 PCR/qPCR 板': '/images/categories/subcategories/materials-pcr-consumables-v1.webp',
  'PCR 八排/八连管': '/images/categories/subcategories/materials-pcr-consumables-v1.webp',
  'PCR 四排管': '/images/categories/subcategories/materials-pcr-consumables-v1.webp',
  'PCR 反应管': '/images/categories/subcategories/materials-pcr-consumables-v1.webp',
  'PCR 平盖薄壁管': '/images/categories/subcategories/materials-pcr-consumables-v1.webp',
  'PCR 单管': '/images/categories/subcategories/materials-pcr-consumables-v1.webp',
  'PCR 耗材': '/images/categories/subcategories/materials-pcr-consumables-v1.webp',
  '封板膜': '/images/categories/subcategories/materials-pcr-consumables-v1.webp',
  '细胞培养板': '/images/categories/subcategories/materials-cell-culture-v2.webp',
  '细胞培养瓶': '/images/categories/subcategories/materials-cell-culture-v2.webp',
  '细胞培养皿': '/images/categories/subcategories/materials-cell-culture-v2.webp',
  '培养皿': '/images/categories/subcategories/materials-cell-culture-v2.webp',
  '培养瓶': '/images/categories/subcategories/materials-cell-culture-v2.webp',
  '细胞培养小室': '/images/categories/subcategories/materials-cell-culture-v2.webp',
  '细胞刮/推刮器': '/images/categories/subcategories/materials-cell-culture-v2.webp',
  '细胞爬片': '/images/categories/subcategories/materials-cell-culture-v2.webp',
  '玻璃器皿与量器': '/images/categories/subcategories/materials-glassware-v1.webp',
  '烧杯和盖': '/images/categories/subcategories/materials-glassware-v1.webp',
  '烧杯/烧瓶': '/images/categories/subcategories/materials-glassware-v1.webp',
  '锥形瓶': '/images/categories/subcategories/materials-glassware-v1.webp',
  '容量瓶': '/images/categories/subcategories/materials-glassware-v1.webp',
  '量筒': '/images/categories/subcategories/materials-glassware-v1.webp',
  '刻度量杯': '/images/categories/subcategories/materials-glassware-v1.webp',
  '滴定管': '/images/categories/subcategories/materials-glassware-v1.webp',
  '专用实验室玻璃器皿': '/images/categories/subcategories/materials-glassware-v1.webp',
  '玻璃容器': '/images/categories/subcategories/materials-glassware-v1.webp',
  '玻璃搅拌棒': '/images/categories/subcategories/materials-glassware-v1.webp',
  '电泳玻璃板': '/images/categories/subcategories/materials-glassware-v1.webp',
  '熔点毛细管': '/images/categories/subcategories/materials-glassware-v1.webp',
  '点样毛细管': '/images/categories/subcategories/materials-glassware-v1.webp',
  '过滤器和过滤': '/images/categories/subcategories/materials-filtration-separation-v2.webp',
  '滤膜/滤器': '/images/categories/subcategories/materials-filtration-separation-v2.webp',
  '微孔滤膜': '/images/categories/subcategories/materials-filtration-separation-v2.webp',
  '注射器过滤器': '/images/categories/subcategories/materials-filtration-separation-v2.webp',
  '针头过滤器': '/images/categories/subcategories/materials-filtration-separation-v2.webp',
  '离心管过滤器': '/images/categories/subcategories/materials-filtration-separation-v2.webp',
  '瓶顶过滤器': '/images/categories/subcategories/materials-filtration-separation-v2.webp',
  '培养上清过滤器': '/images/categories/subcategories/materials-filtration-separation-v2.webp',
  '真空过滤器': '/images/categories/subcategories/materials-filtration-separation-v2.webp',
  '真空过滤系统': '/images/categories/subcategories/materials-filtration-separation-v2.webp',
  '玻璃过滤器': '/images/categories/subcategories/materials-funnels-filtration-v1.webp',
  '漏斗': '/images/categories/subcategories/materials-funnels-filtration-v1.webp',
  '布氏漏斗': '/images/categories/subcategories/materials-funnels-filtration-v1.webp',
  '三角漏斗': '/images/categories/subcategories/materials-funnels-filtration-v1.webp',
  '闪滤瓶': '/images/categories/subcategories/materials-funnels-filtration-v1.webp',
  '超滤': '/images/categories/subcategories/materials-dialysis-ultrafiltration-v1.webp',
  '透析袋': '/images/categories/subcategories/materials-dialysis-ultrafiltration-v1.webp',
  '透析袋夹': '/images/categories/subcategories/materials-dialysis-ultrafiltration-v1.webp',
  '固相萃取': '/images/categories/subcategories/materials-chromatography-columns-v1.webp',
  'SPE 柱': '/images/categories/subcategories/materials-chromatography-columns-v1.webp',
  '亲和层析柱': '/images/categories/subcategories/materials-chromatography-columns-v1.webp',
  '亲和层析柱空柱': '/images/categories/subcategories/materials-chromatography-columns-v1.webp',
  '中压层析柱空柱': '/images/categories/subcategories/materials-chromatography-columns-v1.webp',
  '层析柱': '/images/categories/subcategories/materials-chromatography-columns-v1.webp',
  '凝胶柱': '/images/categories/subcategories/materials-chromatography-columns-v1.webp',
  '蛋白纯化空柱': '/images/categories/subcategories/materials-chromatography-columns-v1.webp',
  '离心式蛋白纯化空柱': '/images/categories/subcategories/materials-chromatography-columns-v1.webp',
  '旋盖式蛋白纯化空柱': '/images/categories/subcategories/materials-chromatography-columns-v1.webp',
  '空柱管': '/images/categories/subcategories/materials-chromatography-columns-v1.webp',
  '核酸纯化柱': '/images/categories/subcategories/materials-chromatography-columns-v1.webp',
  '质粒过滤柱': '/images/categories/subcategories/materials-chromatography-columns-v1.webp',
  '细胞滤网': '/images/categories/subcategories/materials-cell-strainers-v1.webp',
  '过滤板': '/images/categories/subcategories/materials-cell-strainers-v1.webp',
  '收集板': '/images/categories/subcategories/materials-cell-strainers-v1.webp',
  '转印膜': '/images/categories/subcategories/materials-filtration-separation-v2.webp',
  'NC 膜': '/images/categories/subcategories/materials-filtration-separation-v2.webp',
  'PVDF 膜': '/images/categories/subcategories/materials-filtration-separation-v2.webp',
  'MCE 膜': '/images/categories/subcategories/materials-filtration-separation-v2.webp',
  '尼龙膜': '/images/categories/subcategories/materials-filtration-separation-v2.webp',
  '显微镜载玻片': '/images/categories/subcategories/materials-microscopy-imaging-v2.webp',
  '载玻片': '/images/categories/subcategories/materials-microscopy-imaging-v2.webp',
  '腔室载玻片': '/images/categories/subcategories/materials-microscopy-imaging-v2.webp',
  '染色器材': '/images/categories/subcategories/materials-microscopy-imaging-v2.webp',
  '血球计数板': '/images/categories/subcategories/materials-microscopy-imaging-v2.webp',
  '包埋盒': '/images/categories/subcategories/materials-microscopy-imaging-v2.webp',
  '比色皿和流动池': '/images/categories/subcategories/materials-microscopy-imaging-v2.webp',
  '比色皿': '/images/categories/subcategories/materials-microscopy-imaging-v2.webp',
  '微量比色皿': '/images/categories/subcategories/materials-microscopy-imaging-v2.webp',
  '石英比色皿': '/images/categories/subcategories/materials-microscopy-imaging-v2.webp',
  '半微量比色皿': '/images/categories/subcategories/materials-microscopy-imaging-v2.webp',
  '流动比色皿': '/images/categories/subcategories/materials-microscopy-imaging-v2.webp',
  '密闭式比色皿': '/images/categories/subcategories/materials-microscopy-imaging-v2.webp',
  '个人防护装备': '/images/categories/subcategories/materials-ppe-waste-v2.webp',
  '急救和医疗': '/images/categories/subcategories/materials-ppe-waste-v2.webp',
  '乳胶手套': '/images/categories/subcategories/materials-ppe-waste-v2.webp',
  '丁腈手套': '/images/categories/subcategories/materials-ppe-waste-v2.webp',
  '护目镜': '/images/categories/subcategories/materials-ppe-waste-v2.webp',
  '防护面屏': '/images/categories/subcategories/materials-ppe-waste-v2.webp',
  '口罩': '/images/categories/subcategories/materials-ppe-waste-v2.webp',
  '实验废弃物袋': '/images/categories/subcategories/materials-ppe-waste-v2.webp',
  '利器盒': '/images/categories/subcategories/materials-ppe-waste-v2.webp',
  '高温灭菌袋': '/images/categories/subcategories/materials-ppe-waste-v2.webp',
  '架子': '/images/categories/subcategories/materials-racks-holders-v2.webp',
  '盒子': '/images/categories/subcategories/materials-racks-holders-v2.webp',
  '试管架': '/images/categories/subcategories/materials-racks-holders-v2.webp',
  '冻存架': '/images/categories/subcategories/materials-racks-holders-v2.webp',
  '夹具和支架': '/images/categories/subcategories/materials-racks-holders-v2.webp',
  '实验夹具': '/images/categories/subcategories/materials-racks-holders-v2.webp',
  '铁架台': '/images/categories/subcategories/materials-racks-holders-v2.webp',
  '铁架台/三脚架': '/images/categories/subcategories/materials-racks-holders-v2.webp',
  '试管沥水架': '/images/categories/subcategories/materials-racks-holders-v2.webp',
  '试管夹': '/images/categories/subcategories/materials-racks-holders-v2.webp',
  '滴定夹': '/images/categories/subcategories/materials-racks-holders-v2.webp',
  '三爪夹': '/images/categories/subcategories/materials-racks-holders-v2.webp',
  '十字夹': '/images/categories/subcategories/materials-racks-holders-v2.webp',
  '止水夹': '/images/categories/subcategories/materials-racks-holders-v2.webp',
  '弹簧止水夹': '/images/categories/subcategories/materials-racks-holders-v2.webp',
  '橡胶漏斗托': '/images/categories/subcategories/materials-racks-holders-v2.webp',
  '实验室升降台': '/images/categories/subcategories/materials-racks-holders-v2.webp',
  '磁力架': '/images/categories/subcategories/materials-racks-holders-v2.webp',
  '磁棒套': '/images/categories/subcategories/materials-racks-holders-v2.webp',
  '环境采样器': '/images/categories/subcategories/materials-sampling-testing-v2.webp',
  '水和废水检测耗材': '/images/categories/subcategories/materials-sampling-testing-v2.webp',
  '临床标本采集': '/images/categories/subcategories/materials-sampling-testing-v2.webp',
  '采样袋': '/images/categories/subcategories/materials-sampling-testing-v2.webp',
  '均质袋': '/images/categories/subcategories/materials-sampling-testing-v2.webp',
  '接种环/采样棒': '/images/categories/subcategories/materials-sampling-testing-v2.webp',
  '接种环/针': '/images/categories/subcategories/materials-sampling-testing-v2.webp',
  '涂布棒': '/images/categories/subcategories/materials-sampling-testing-v2.webp',
  '生物样本子母袋': '/images/categories/subcategories/materials-sampling-testing-v2.webp',
  '精密试纸': '/images/categories/subcategories/materials-sampling-testing-v2.webp',
  'pH 试纸': '/images/categories/subcategories/materials-sampling-testing-v2.webp',
  '温度计和温度测量': '/images/categories/subcategories/materials-temperature-tools-v2.webp',
  '金属冰盒': '/images/categories/subcategories/materials-temperature-tools-v2.webp',
  'PCR 冰盒': '/images/categories/subcategories/materials-temperature-tools-v2.webp',
  '冰盒配件': '/images/categories/subcategories/materials-temperature-tools-v2.webp',
  '定时器': '/images/categories/subcategories/materials-temperature-tools-v2.webp',
  '磁力搅拌子': '/images/categories/subcategories/materials-weighing-hand-tools-v1.webp',
  '药勺': '/images/categories/subcategories/materials-weighing-hand-tools-v1.webp',
  '称量纸': '/images/categories/subcategories/materials-weighing-hand-tools-v1.webp',
  '方形称量盘': '/images/categories/subcategories/materials-weighing-hand-tools-v1.webp',
  '船形称量盘': '/images/categories/subcategories/materials-weighing-hand-tools-v1.webp',
  '菱形称量盘': '/images/categories/subcategories/materials-weighing-hand-tools-v1.webp',
  '镊子': '/images/categories/subcategories/materials-weighing-hand-tools-v1.webp',
  '精细镊子': '/images/categories/subcategories/materials-weighing-hand-tools-v1.webp',
  '方头镊子': '/images/categories/subcategories/materials-weighing-hand-tools-v1.webp',
  '剪刀': '/images/categories/subcategories/materials-weighing-hand-tools-v1.webp',
  '刀柄': '/images/categories/subcategories/materials-weighing-hand-tools-v1.webp',
  '止血钳': '/images/categories/subcategories/materials-weighing-hand-tools-v1.webp',
  '坩埚钳': '/images/categories/subcategories/materials-weighing-hand-tools-v1.webp',
  '标签打印机': '/images/categories/subcategories/materials-labels-wipes-v1.webp',
  '扫码仪': '/images/categories/subcategories/materials-labels-wipes-v1.webp',
  '指示胶带': '/images/categories/subcategories/materials-labels-wipes-v1.webp',
  '吸水纸': '/images/categories/subcategories/materials-labels-wipes-v1.webp',
  '擦拭纸': '/images/categories/subcategories/materials-labels-wipes-v1.webp',
  '脱脂棉': '/images/categories/subcategories/materials-labels-wipes-v1.webp',
  '喷壶': '/images/categories/subcategories/materials-labels-wipes-v1.webp',
  'WB 孵育盒': '/images/categories/subcategories/materials-specialty-consumables-v2.webp',
  '抗体孵育袋': '/images/categories/subcategories/materials-specialty-consumables-v2.webp',
  // 仪器设备
  '实验室常规仪器': '/images/categories/subcategories/lab-general-instruments-v1.png',
  '生命科学仪器': '/images/categories/subcategories/life-science-instruments-v1.png',
  '分析仪器': '/images/categories/subcategories/analytical-instruments-v1.png',
  '光学仪器': '/images/categories/subcategories/optical-instruments-v1.png',
  '液氮储存': '/images/categories/subcategories/materials-cryostorage-v1.webp',
  '低温冰箱': '/images/categories/subcategories/materials-temperature-tools-v2.webp',
  '模型相关设备': '/images/categories/subcategories/model-equipment-v1.png',
  '其他设备': '/images/categories/subcategories/other-equipment-v1.png',
  '配件': '/images/categories/subcategories/instrument-accessories-v1.png',
  // 抗体偶联试剂盒
  'Alexa Fluor偶联试剂盒': '/images/categories/subcategories/alexa-fluor-conjugation-kits-v1.png',
  '荧光偶联试剂盒': '/images/categories/subcategories/fluorescent-conjugation-kits-v1.png',
  'HRP和AP偶联试剂盒': '/images/categories/subcategories/hrp-ap-conjugation-kits-v1.png',
  'Biotin偶联试剂盒': '/images/categories/subcategories/biotin-conjugation-kits-v1.png',
};

const materialSynthesisItems = [
  ...new Set(
    productCategories
      .find(({ name }) => name === '材料合成')
      ?.sub.flatMap(({ child }) => child ?? []) ?? [],
  ),
];

export const MATERIAL_SYNTHESIS_ITEM_IMAGES: Record<string, string> = Object.fromEntries(
  materialSynthesisItems.map((name, index) => [
    name,
    `/images/categories/material-items/materials-item-${String(index + 1).padStart(3, '0')}.webp`,
  ]),
);

for (const [name, image] of Object.entries(MATERIAL_SYNTHESIS_ITEM_IMAGES)) {
  if (!SUBCATEGORY_IMAGES[name]) {
    SUBCATEGORY_IMAGES[name] = image;
  }
}

/** Soft gradient accents when no image is available. */
export const CATEGORY_GRADIENTS: Record<string, string> = {
  '一抗': 'from-blue-600/20 via-indigo-500/10 to-slate-100',
  '二抗': 'from-violet-600/20 via-purple-500/10 to-slate-100',
  'ELISA试剂盒': 'from-emerald-600/20 via-teal-500/10 to-slate-100',
  '蛋白和细胞系': 'from-cyan-600/20 via-sky-500/10 to-slate-100',
  '生化和细胞检测试剂盒': 'from-amber-600/20 via-orange-500/10 to-slate-100',
  '样本制备和检测试剂盒': 'from-rose-600/20 via-pink-500/10 to-slate-100',
  '分子生物学': 'from-brand-600/20 via-blue-500/10 to-slate-100',
  '化学试剂': 'from-lime-600/20 via-green-500/10 to-slate-100',
  '细胞生物学': 'from-fuchsia-600/20 via-purple-500/10 to-slate-100',
  '材料合成': 'from-stone-600/20 via-neutral-500/10 to-slate-100',
  '仪器设备': 'from-slate-600/20 via-gray-500/10 to-slate-100',
  '抗体偶联试剂盒': 'from-indigo-600/20 via-violet-500/10 to-slate-100',
  '新产品': 'from-brand-500/25 via-amber-400/10 to-slate-100',
  '核酸纯化': 'from-teal-600/20 via-cyan-500/10 to-slate-100',
};

const DEFAULT_GRADIENT = 'from-brand-500/15 via-blue-400/10 to-slate-100';

/** L1 hero images for these categories take precedence over L2 subcategory thumbnails. */
const CATEGORY_PREFERRED_OVER_SUBCATEGORY = new Set(['一抗', '二抗']);

const IMAGE_PATH_EXTENSION = /\.(?:jpe?g|png|webp|gif|svg)$/i;

const INVALID_IMAGE_HOSTS = ['abcepta.com.cn', 'www.abcepta.com.cn'];

/** True when imageUrl points at an actual image file, not a vendor product page. */
export function isValidProductImageUrl(url?: string | null): url is string {
  if (!url?.trim()) return false;
  try {
    const normalized = url.trim();
    let path: string;
    if (normalized.startsWith('http')) {
      const parsed = new URL(normalized);
      if (INVALID_IMAGE_HOSTS.includes(parsed.hostname.toLowerCase())) return false;
      path = parsed.pathname.toLowerCase();
    } else {
      path = (normalized.split('?')[0] ?? '').toLowerCase();
    }
    // Vendor catalog pages: /products/{slug} — not /assets/uploads/products/...
    if (/^\/products\//.test(path)) return false;
    return IMAGE_PATH_EXTENSION.test(path);
  } catch {
    return false;
  }
}

export function getCategoryGradient(category?: string | null): string {
  if (!category) return DEFAULT_GRADIENT;
  return CATEGORY_GRADIENTS[category] ?? DEFAULT_GRADIENT;
}

export function getProductImageUrl(product: Pick<Product, 'imageUrl' | 'category' | 'subcategory'>): string | undefined {
  if (product.imageUrl && isValidProductImageUrl(product.imageUrl)) return product.imageUrl;
  if (
    product.category &&
    CATEGORY_PREFERRED_OVER_SUBCATEGORY.has(product.category) &&
    CATEGORY_IMAGES[product.category]
  ) {
    return CATEGORY_IMAGES[product.category];
  }
  if (
    product.category === '材料合成' &&
    product.subcategory &&
    MATERIAL_SYNTHESIS_ITEM_IMAGES[product.subcategory]
  ) {
    return MATERIAL_SYNTHESIS_ITEM_IMAGES[product.subcategory];
  }
  if (product.subcategory && SUBCATEGORY_IMAGES[product.subcategory]) {
    return SUBCATEGORY_IMAGES[product.subcategory];
  }
  if (product.category && CATEGORY_IMAGES[product.category]) {
    return CATEGORY_IMAGES[product.category];
  }
  return undefined;
}

export function getProductImageAlt(
  product: Pick<Product, 'name'> &
    Partial<Pick<Product, 'brand' | 'catalogNumber' | 'category' | 'subcategory' | 'subBrand'>>,
): string {
  const brand = product.brand
    ? getDisplayBrand({ brand: product.brand, subBrand: product.subBrand })
    : '';
  if (product.catalogNumber) {
    return [brand, product.name, product.catalogNumber].filter(Boolean).join(' ');
  }
  return product.subcategory || product.category || product.name;
}

export function getDisplayBrand(product: Pick<Product, 'brand' | 'subBrand'>): string {
  if (product.brand === 'Thermo Fisher' && product.subBrand) return product.subBrand;
  return product.brand;
}
