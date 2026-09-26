import ExcelJS from 'exceljs';

export const PRICING_ADJUSTMENT_TEMPLATE_FILE_NAME = '商品集中调价导入模板.xlsx';

export const PRICING_ADJUSTMENT_TEMPLATE_HEADERS = [
  '商品名', '货号', '目录价格', '市场价格', '促销价格', '进货价', '最低成交价',
  '规格2', '目录价格', '市场价格', '促销价格', '进货价', '最低成交价',
  '规格3', '目录价格', '市场价格', '促销价格', '进货价', '最低成交价',
  '规格4', '目录价格', '市场价格', '促销价格', '进货价', '最低成交价',
  '规格5', '目录价格', '市场价格', '促销价格', '进货价', '最低成交价',
];

export async function buildPricingAdjustmentTemplate(): Promise<{ fileName: string; buffer: Buffer }> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('调价货号');
  sheet.addRow(PRICING_ADJUSTMENT_TEMPLATE_HEADERS);
  sheet.columns = PRICING_ADJUSTMENT_TEMPLATE_HEADERS.map((header) => ({
    width: header.startsWith('规格') ? 10 : header === '商品名' ? 28 : header === '货号' ? 16 : 12,
  }));
  return {
    fileName: PRICING_ADJUSTMENT_TEMPLATE_FILE_NAME,
    buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
  };
}

export async function readPricingAdjustmentTemplate(): Promise<{ fileName: string; buffer: Buffer }> {
  return buildPricingAdjustmentTemplate();
}
