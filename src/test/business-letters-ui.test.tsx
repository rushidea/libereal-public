import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import BusinessLettersManager from '@/components/admin/BusinessLettersManager';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('business letter manager', () => {
  it('shows the complete recipient/message preview and invalidates confirmation when input changes', async () => {
    const template = { id: 'template-one', revision: 1, name: 'Example template', subject: 'Example', body: '{{details}}', enabled: true };
    const letter = { id: 'draft-one', status: 'draft', approvalHash: 'a'.repeat(64), businessReference: 'EX-1', templateRevision: 1,
      snapshot: JSON.stringify({ source: null, message: { from: 'order@example.test', replyTo: 'order@example.test', to: ['recipient@example.test'], subject: 'Example', html: '<p>Example content</p>', text: 'Example content' } }) };
    const fetch = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('business-letter-templates')) return Response.json({ templates: [template], canManage: true, canSend: true, canReadLetters: true });
      if (!options?.method) return Response.json({ letters: [] });
      return Response.json({ letter });
    }); vi.stubGlobal('fetch', fetch);
    render(<BusinessLettersManager />);
    fireEvent.click(await screen.findByRole('button', { name: '调用模板' }));
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
});
