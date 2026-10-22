import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InquiryIdDisplay, InquiryIdText, abbreviateInquiryId, splitInquiryIdText } from '@/components/InquiryIdDisplay';

const ID = 'id_68011acc-6134-4f0a-9c2b-111111111111';
const OTHER_ID = 'id_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

describe('InquiryIdDisplay', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the full inquiry id in monospace that can wrap', () => {
    render(<InquiryIdDisplay id={ID} />);
    const node = screen.getByText(ID);
    expect(node.className).toContain('font-mono');
    expect(node.className).toContain('break-all');
    expect(node.className).toContain('lg:inline');
    expect(node.className).not.toContain('truncate');
    expect(screen.queryByText(`${ID.slice(0, 16)}...`)).toBeNull();
    expect(document.body.textContent).toContain(ID);
  });

  it('abbreviates on small screens and expands or collapses from the button', () => {
    render(<InquiryIdDisplay id={ID} />);
    const toggle = screen.getByRole('button', { name: `展开询价编号 ${ID}` });
    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle).toHaveAttribute('type', 'button');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle.className).toContain('lg:hidden');
    expect(toggle.className).toContain('border-dashed');
    expect(toggle.textContent).toContain('id_68011acc…111111');
    expect(toggle.textContent).not.toContain(ID);

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle.textContent).toContain(ID);
    expect(screen.getByRole('button', { name: `收起询价编号 ${ID}` })).toBe(toggle);

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle.textContent).toContain('id_68011acc…111111');
    expect(toggle.textContent).not.toContain(ID);
  });

  it('keeps parent row clicks from firing when the id is toggled or copied', async () => {
    const onRow = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(
      <div onClick={onRow}>
        <InquiryIdDisplay id={ID} />
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: `展开询价编号 ${ID}` }));
    fireEvent.click(screen.getByRole('button', { name: '复制询价编号' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(ID));
    expect(onRow).not.toHaveBeenCalled();
  });

  it('copies the full id while the abbreviated form is showing', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<InquiryIdDisplay id={ID} />);
    const toggle = screen.getByRole('button', { name: `展开询价编号 ${ID}` });
    fireEvent.click(screen.getByRole('button', { name: '复制询价编号' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(ID));
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle.textContent).toContain('id_68011acc…111111');
  });

  it('copies the full id and shows 已复制', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<InquiryIdDisplay id={ID} />);
    fireEvent.click(screen.getByRole('button', { name: '复制询价编号' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(ID));
    expect(await screen.findByText('已复制')).toBeTruthy();
    expect(screen.getByRole('button', { name: '已复制' })).toBeTruthy();
  });

  it('does not show 已复制 when the clipboard write fails', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    const execCommand = vi.fn().mockReturnValue(false);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    render(<InquiryIdDisplay id={ID} />);
    fireEvent.click(screen.getByRole('button', { name: '复制询价编号' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(ID));
    await waitFor(() => expect(execCommand).toHaveBeenCalledWith('copy'));
    expect(screen.queryByText('已复制')).toBeNull();
    expect(screen.getByRole('button', { name: '复制询价编号' })).toBeTruthy();
  });

  it('leaves short ids fully visible without an expand control', () => {
    render(<InquiryIdDisplay id="id_short" />);
    expect(screen.getByText('id_short').className).toContain('font-mono');
    expect(screen.queryByRole('button', { name: /展开询价编号/ })).toBeNull();
    expect(screen.getByRole('button', { name: '复制询价编号' })).toBeTruthy();
  });
});

describe('abbreviateInquiryId', () => {
  it('keeps the start and end of a standard inquiry id', () => {
    expect(abbreviateInquiryId(ID)).toBe('id_68011acc…111111');
  });

  it('leaves short ids unchanged', () => {
    expect(abbreviateInquiryId('id_short')).toBe('id_short');
    expect(abbreviateInquiryId('id_68011acc111111')).toBe('id_68011acc111111');
  });

  it('abbreviates once the id is longer than the prefix, suffix, and ellipsis', () => {
    expect(abbreviateInquiryId('id_68011accX111111')).toBe('id_68011accX111111');
    expect(abbreviateInquiryId('id_68011accXX111111')).toBe('id_68011acc…111111');
  });
});

describe('splitInquiryIdText', () => {
  it('isolates inquiry ids inside notification copy', () => {
    expect(splitInquiryIdText(`新询价单 ${ID}，客户：甲`)).toEqual([
      { type: 'text', value: '新询价单 ' },
      { type: 'id', value: ID },
      { type: 'text', value: '，客户：甲' },
    ]);
  });

  it('isolates every inquiry id and keeps the original casing', () => {
    const upper = ID.toUpperCase();
    expect(splitInquiryIdText(`先 ${ID} 再 ${upper}`)).toEqual([
      { type: 'text', value: '先 ' },
      { type: 'id', value: ID },
      { type: 'text', value: ' 再 ' },
      { type: 'id', value: upper },
    ]);
  });

  it('leaves quote, order, and user ids as plain text', () => {
    const quote = '报价 clh0abc123';
    const order = '订单 ord_68011acc-6134-4f0a-9c2b-111111111111';
    const user = '用户 usr_68011acc-6134-4f0a-9c2b-111111111111';
    expect(splitInquiryIdText(quote)).toEqual([{ type: 'text', value: quote }]);
    expect(splitInquiryIdText(order)).toEqual([{ type: 'text', value: order }]);
    expect(splitInquiryIdText(user)).toEqual([{ type: 'text', value: user }]);
    expect(splitInquiryIdText('编号 id_not-a-uuid')).toEqual([{ type: 'text', value: '编号 id_not-a-uuid' }]);
  });
});

describe('InquiryIdText', () => {
  it('renders an embedded inquiry id with a copy control', () => {
    render(<InquiryIdText as="p" text={`您的询价单 ${ID} 的产品实际货期已更新`} />);
    const id = screen.getByText(ID);
    expect(id.className).toContain('break-all');
    expect(id.className).toContain('font-mono');
    expect(screen.getByRole('button', { name: '复制询价编号' })).toBeTruthy();
    expect(screen.getByText(/产品实际货期已更新/)).toBeTruthy();
  });

  it('renders each embedded inquiry id separately and leaves the surrounding copy', () => {
    render(<InquiryIdText as="div" text={`询价 ${ID} 与 ${OTHER_ID} 已更新`} />);
    expect(screen.getByText(ID)).toBeTruthy();
    expect(screen.getByText(OTHER_ID)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: '复制询价编号' })).toHaveLength(2);
    expect(screen.getByText(/已更新/)).toBeTruthy();
    expect(screen.queryByText(/ord_/)).toBeNull();
  });
});
