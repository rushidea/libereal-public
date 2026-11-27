import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import BusinessLettersManager from '@/components/admin/BusinessLettersManager';
import BusinessLetterContacts from '@/components/admin/BusinessLetterContacts';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('business letter manager', () => {
  it('shows the complete recipient/message preview and invalidates confirmation when input changes', async () => {
    const template = { id: 'template-one', revision: 1, name: 'Example template', subject: 'Example', body: '{{details}}', enabled: true };
    const letter = { id: 'draft-one', status: 'draft', approvalHash: 'a'.repeat(64), businessReference: 'EX-1', templateRevision: 1,
      snapshot: JSON.stringify({ source: null, message: { from: 'order@example.test', replyTo: 'order@example.test', to: ['recipient@example.test'], subject: 'Example', html: '<p>Example content</p>', text: 'Example content' } }) };
    const fetch = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('business-letter-templates')) return Response.json({ templates: [template], canManage: true, canSend: true, canReadLetters: true });
      if (url.includes('business-letter-contacts')) return Response.json({ contacts: [], brands: [], canManage: true, hasMore: false });
      if (!options?.method) return Response.json({ letters: [] });
      return Response.json({ letter });
    }); vi.stubGlobal('fetch', fetch);
    render(<BusinessLettersManager initialReference="EX-INITIAL" />);
    fireEvent.click(await screen.findByRole('button', { name: '调用模板' }));
    expect(screen.getByLabelText('业务编号')).toHaveValue('EX-INITIAL');
    fireEvent.change(screen.getByLabelText('收件人邮箱'), { target: { value: 'recipient@example.test' } });
    fireEvent.change(screen.getByLabelText('业务编号'), { target: { value: 'EX-1' } });
    fireEvent.click(screen.getByRole('button', { name: '生成完整预览' }));
    const send = await screen.findByRole('button', { name: '确认并发送' });
    expect(send).toBeDisabled();
    expect(screen.getByText('唯一收件人：recipient@example.test（无抄送或密送）')).toBeInTheDocument();
    expect(screen.getByTitle('商务信函 HTML 预览')).toHaveAttribute('sandbox', '');
    fireEvent.click(screen.getByRole('checkbox', { name: /我已核对/ }));
    expect(send).toBeEnabled();
    fireEvent.change(screen.getByLabelText('收件人邮箱'), { target: { value: 'changed@example.test' } });
    expect(screen.queryByRole('button', { name: '确认并发送' })).not.toBeInTheDocument();
    expect(fetch.mock.calls.filter(call => call[1]?.body && JSON.parse(call[1].body as string).action === 'send')).toHaveLength(0);
  });

  it('uses a searched contact for recipient and salutation and binds its revision to the preview', async () => {
    const contact = { id: 'contact-one', revision: 3, companyName: 'Example Supplier', contactName: 'Example Person',
      email: 'supplier@example.test', salutation: '业务负责人：', phone: '', qq: '', brandIds: ['brand-one'], brands: [{ id: 'brand-one', name: 'Example Brand' }], enabled: true };
    const template = { id: 'template-one', revision: 1, name: 'Example template', subject: 'Example', body: '{{details}}', enabled: true };
    const fetch = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.includes('business-letter-contacts')) return Response.json({ contacts: [contact], brands: contact.brands, canManage: false, hasMore: false });
      if (url.endsWith('business-letter-templates')) return Response.json({ templates: [template], canManage: false, canSend: true, canReadLetters: true });
      if (!options?.method) return Response.json({ letters: [] });
      return Response.json({ letter: { id: 'draft-one', status: 'draft', businessReference: 'EX-1', templateRevision: 1,
        snapshot: JSON.stringify({ contact, source: null, message: { to: [contact.email], from: 'order@example.test', replyTo: 'order@example.test', subject: 'Example', html: '<p>Letter</p>', text: 'Letter' } }) } });
    }); vi.stubGlobal('fetch', fetch);
    render(<BusinessLettersManager initialReference="EX-1" />);
    fireEvent.click(await screen.findByRole('button', { name: '用于本次信函' }));
    expect(screen.getByLabelText('收件人邮箱')).toHaveValue(contact.email);
    expect(screen.getByLabelText('称呼')).toHaveValue(contact.salutation);
    fireEvent.change(screen.getByLabelText('检索供应商、品牌或联系人'), { target: { value: 'Example Brand' } });
    fireEvent.click(screen.getByRole('button', { name: /^检索$/ }));
    fireEvent.click(await screen.findByRole('button', { name: '调用模板' }));
    fireEvent.click(screen.getByRole('button', { name: '生成完整预览' }));
    expect(await screen.findByText('收件联系人：Example Supplier · Example Person · 第 3 版。资料变更后须重新预览确认。')).toBeInTheDocument();
    const call = fetch.mock.calls.find(c => c[1]?.body && JSON.parse(String(c[1].body)).action === 'preview');
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ contactId: contact.id, contactRevision: 3, to: contact.email });
    expect(fetch.mock.calls.some(c => c[0].includes('q=Example%20Brand'))).toBe(true);
    fireEvent.change(screen.getByLabelText('收件人邮箱'), { target: { value: 'manual@example.test' } });
    expect(screen.queryByText(/已选用：Example Supplier/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '确认并发送' })).not.toBeInTheDocument();
  });

  it('clears directory confirmation after any edit and saves only the displayed new version', async () => {
    const contact = { id: 'contact-one', revision: 1, companyName: 'Example Supplier', contactName: 'Example Person',
      email: 'supplier@example.test', salutation: '负责人：', phone: '', qq: '', brandIds: [], brands: [], notes: '', sourceReference: 'Owner', enabled: true };
    const changed = vi.fn();
    const fetch = vi.fn(async (_url: string, options?: RequestInit) => {
      if (!options?.method) return Response.json({ contacts: [contact], brands: [], canManage: true, hasMore: false });
      const body = JSON.parse(String(options.body));
      return body.action === 'preview' ? Response.json({ preview: { before: contact, after: { ...body, brands: [] }, previewHash: body.email } })
        : Response.json({ contact: { ...body, id: contact.id, revision: 2, brands: [] } });
    }); vi.stubGlobal('fetch', fetch);
    render(<BusinessLetterContacts onSelect={vi.fn()} onChanged={changed} canSelect />);
    fireEvent.click(await screen.findByRole('button', { name: '查看与编辑' }));
    fireEvent.click(screen.getByRole('button', { name: '预览资料变更' }));
    const save = await screen.findByRole('button', { name: '确认保存联系人' });
    expect(save).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /我已核对以上资料/ }));
    expect(save).toBeEnabled();
    fireEvent.change(screen.getByLabelText('邮箱', { exact: true }), { target: { value: 'changed@example.test' } });
    expect(screen.queryByRole('button', { name: '确认保存联系人' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '预览资料变更' }));
    expect(await screen.findByRole('button', { name: '确认保存联系人' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /我已核对以上资料/ }));
    fireEvent.click(screen.getByRole('button', { name: '确认保存联系人' }));
    expect(await screen.findByText('已保存 Example Supplier · Example Person 第 2 版。')).toBeInTheDocument();
    expect(changed).toHaveBeenCalledWith(expect.objectContaining({ email: 'changed@example.test', revision: 2 }));
    const saves = fetch.mock.calls.filter(c => c[1]?.body && JSON.parse(String(c[1].body)).action === 'save');
    expect(saves).toHaveLength(1);
    expect(JSON.parse(String(saves[0][1]?.body))).toMatchObject({ confirm: true, email: 'changed@example.test', previewHash: 'changed@example.test' });
  });
});
