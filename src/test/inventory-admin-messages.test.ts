import { describe, expect, it } from 'vitest';
import { inventoryAdminErrorMessage } from '@/lib/inventory-admin-messages';

describe('inventory admin error messages', () => {
  it('maps inventory program codes to Chinese and hides unknown English codes', () => {
    expect(inventoryAdminErrorMessage('INVENTORY_BELOW_RESERVED', '保存失败，请稍后重试。')).toBe('实际库存不能低于已预占数量。');
    expect(inventoryAdminErrorMessage('INVALID_INVENTORY_QUANTITY', '保存失败，请稍后重试。')).toBe('实际库存必须是整数，且不能小于 -1。');
    expect(inventoryAdminErrorMessage('INVALID_INBOUND_QUANTITY', '保存失败，请稍后重试。')).toBe('采购在途必须是不小于 0 的整数。');
    expect(inventoryAdminErrorMessage('INVALID_BATCH_RECEIPT', '入库失败，请稍后重试。')).toBe('请填写批次号，入库数量须为正整数。');
    expect(inventoryAdminErrorMessage('INVALID_EXPIRY_DATE', '入库失败，请稍后重试。')).toBe('有效期不正确，请重新选择。');
    expect(inventoryAdminErrorMessage('Internal server error', '保存失败，请稍后重试。')).toBe('保存失败，请稍后重试。');
    expect(inventoryAdminErrorMessage('SOME_NEW_CODE', '库存列表加载失败，请重试。')).toBe('库存列表加载失败，请重试。');
  });

  it('keeps Chinese API messages', () => {
    expect(inventoryAdminErrorMessage('库存账户不存在', '批次和流水加载失败，请重试。')).toBe('库存账户不存在');
    expect(inventoryAdminErrorMessage('', '保存失败，请稍后重试。')).toBe('保存失败，请稍后重试。');
  });
});
