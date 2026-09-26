'use client';

import React, { useEffect, useState } from 'react';


import {
  Package, Search, Eye, Check, Clock, XCircle,
  RotateCcw, Trash2
} from 'lucide-react';


interface InquiryItem {
  name?: string;
  brand?: string;
  catalogNumber?: string;
  quantity?: number;
  price?: number;
  leadTime?: string;
}

interface Inquiry {
  id: string;
  name: string;
  email: string;
  phone?: string;
  institution?: string;
  department?: string;
  items: InquiryItem[];
  subtotal: number;
  status: string;
  paymentMethod?: string;
  notes?: string;
  createdAt: string;
  archivedAt?: string;
}

function translatePaymentMethod(method: string): string {
  const map: Record<string, string> = {
    'rjmart': '锐竞',
    'ruijing': '锐竞',
    'ruijin': '锐竞',
    'casmart': '喀斯玛',
    'kasima': '喀斯玛',
    'kasm': '喀斯玛',
    'weixin': '微信支付',
    'zfb': '支付宝',
    'card': '银行卡',
    'corporate': '企业转账',
  };
  return map[method.toLowerCase()] || method;
}

export default function ArchivedInquiriesPage() {
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
const [loading, setLoading] = useState(true);
  const [selectedInquiry, setSelectedInquiry] = useState<Inquiry | null>(null);
  const [inquiryItems, setInquiryItems] = useState<InquiryItem[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetchArchivedInquiries();
  }, []);

  async function fetchArchivedInquiries() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/inquiries/archived');
      if (res.ok) {
        const data = await res.json();
        setInquiries(data.inquiries || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (selectedInquiry) {
      setInquiryItems(selectedInquiry.items);
    } else {
      setInquiryItems([]);
    }
  }, [selectedInquiry]);

  async function handleUnarchive(inquiryIds: string[]) {
    if (!confirm(`确定要还原 ${inquiryIds.length} 个询价单吗？`)) return;
    try {
      const res = await fetch('/api/admin/inquiries/archive', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inquiryIds, action: 'unarchive' }),
      });
      if (res.ok) {
        fetchArchivedInquiries();
        setSelectedInquiry(null);
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function handleDelete(inquiryIds: string[]) {
    if (!confirm(`确定要永久删除 ${inquiryIds.length} 个询价单吗？此操作不可恢复！`)) return;
    try {
      const res = await fetch('/api/admin/inquiries/archive', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inquiryIds, action: 'delete' }),
      });
      if (res.ok) {
        fetchArchivedInquiries();
        setSelectedInquiry(null);
      }
    } catch (e) {
      console.error(e);
    }
  }

  const filteredInquiries = inquiries.filter(i =>
    !search ||
    i.name.includes(search) ||
    i.email.includes(search) ||
    (i.institution && i.institution.includes(search)) ||
    i.id.includes(search)
  );

  const formatPrice = (price: number) =>
    new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(price);

  return (
    <div className="space-y-4">
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-4 h-4 text-gray-600 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="搜索归档询价单..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent w-64 text-gray-900"
              />
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-left px-4 py-3 font-semibold text-gray-700">编号</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700">客户</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700">机构</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700">金额</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700">状态</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700">归档时间</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInquiries.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-600">暂无归档询价单</td></tr>
                  ) : filteredInquiries.map(inquiry => (
                    <React.Fragment key={inquiry.id}>
                      <tr
                        className={`border-b border-gray-100 cursor-pointer ${selectedInquiry?.id === inquiry.id ? 'bg-purple-100/50 hover:bg-purple-100/50' : 'hover:bg-gray-50/50'}`}
                        onClick={() => setSelectedInquiry(selectedInquiry?.id === inquiry.id ? null : inquiry)}
                      >
                        <td className="px-4 py-3 font-mono text-xs text-gray-600 break-all">{inquiry.id}</td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900">{inquiry.name}（{inquiry.email}）</div>
                        </td>
                        <td className="px-4 py-3 text-gray-700">{inquiry.institution || '-'}</td>
                        <td className="px-4 py-3 font-semibold text-gray-900">{formatPrice(inquiry.subtotal)}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
                            inquiry.status === 'closed' ? 'bg-gray-100 text-gray-600' :
                            inquiry.status === 'pending_quote' ? 'bg-yellow-100 text-yellow-700' :
                            inquiry.status === 'quote_sent' ? 'bg-blue-100 text-blue-700' :
                            'bg-green-100 text-green-700'
                          }`}>
                            {inquiry.status === 'closed' ? <XCircle className="w-3 h-3" /> :
                             inquiry.status === 'pending_quote' ? <Clock className="w-3 h-3" /> :
                             <Check className="w-3 h-3" />}
                            {inquiry.status === 'closed' ? '已关闭' :
                             inquiry.status === 'pending_quote' ? '待报价' :
                             inquiry.status === 'quote_sent' ? '已发报价' :
                             inquiry.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-600 text-xs">
                          {inquiry.archivedAt ? new Date(inquiry.archivedAt).toLocaleDateString('zh-CN') : '-'}
                        </td>
                        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleUnarchive([inquiry.id])}
                              className="text-blue-600 hover:text-blue-700 font-medium text-xs flex items-center gap-1"
                              title="还原询价单"
                            >
                              <RotateCcw className="w-3.5 h-3.5" /> 还原
                            </button>
                            <button
                              onClick={() => setSelectedInquiry(inquiry)}
                              className="text-brand-600 hover:text-brand-700 font-medium text-xs flex items-center gap-1"
                            >
                              <Eye className="w-3.5 h-3.5" /> 详情
                            </button>
                            <button
                              onClick={() => handleDelete([inquiry.id])}
                              className="text-red-600 hover:text-red-700 font-medium text-xs flex items-center gap-1"
                              title="永久删除"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                      {selectedInquiry?.id === inquiry.id && (
                        <tr>
                          <td colSpan={7} className="bg-purple-100/70 p-4 border-b border-purple-200">
                            <div className="bg-white rounded-lg border border-purple-300 shadow-sm p-4 space-y-4">
                              <div className="grid grid-cols-2 gap-4">
                                <div>
                                  <p className="text-xs text-gray-600 mb-1">客户姓名</p>
                                  <p className="font-medium text-gray-800">{selectedInquiry.name}</p>
                                </div>
                                <div>
                                  <p className="text-xs text-gray-600 mb-1">邮箱</p>
                                  <p className="text-sm text-gray-700">{selectedInquiry.email}</p>
                                </div>
                                <div>
                                  <p className="text-xs text-gray-600 mb-1">电话</p>
                                  <p className="text-sm text-gray-700">{selectedInquiry.phone || '-'}</p>
                                </div>
                                <div>
                                  <p className="text-xs text-gray-600 mb-1">机构</p>
                                  <p className="text-sm text-gray-700">{selectedInquiry.institution || '-'}</p>
                                </div>
                                {selectedInquiry.paymentMethod && (
                                  <div>
                                    <p className="text-xs text-gray-600 mb-1">付款方式</p>
                                    <p className="text-sm font-bold text-orange-600">{translatePaymentMethod(selectedInquiry.paymentMethod)}</p>
                                  </div>
                                )}
                              </div>
                              <div>
                                <p className="text-xs text-gray-600 mb-2">询价产品</p>
                                <div className="border border-gray-200 rounded-lg overflow-hidden">
                                  {inquiryItems.map((item: InquiryItem, i: number) => (
                                    <div key={i} className="px-4 py-3 border-b border-gray-100 last:border-0 hover:bg-gray-50/50">
                                      <div className="flex items-start gap-3">
                                        <div className="w-8 h-8 rounded flex items-center justify-center flex-shrink-0 bg-blue-50 text-blue-600">
                                          <Package className="w-4 h-4" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                          <p className="text-sm font-medium text-gray-900 truncate">{item.name || '未知产品'}</p>
                                          <p className="text-xs text-gray-600">{item.brand} · {item.catalogNumber}</p>
                                        </div>
                                        <div className="text-right">
                                          <p className="text-sm font-medium text-gray-900">{formatPrice((item.price || 0) * (item.quantity || 1))}</p>
                                          <p className="text-xs text-gray-500">x{item.quantity || 1}</p>
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                              <div className="flex justify-between items-center pt-4 border-t border-gray-200">
                                <span className="text-gray-700 font-medium">询价总计</span>
                                <span className="text-xl font-bold text-purple-600">{formatPrice(selectedInquiry.subtotal)}</span>
                              </div>
                              {selectedInquiry.notes && (
                                <div>
                                  <p className="text-xs text-gray-600 mb-1">备注</p>
                                  <p className="text-sm text-gray-700 bg-gray-50 p-3 rounded-lg">{selectedInquiry.notes}</p>
                                </div>
                              )}
                              <div className="flex gap-2 pt-4 border-t border-gray-200">
                                <button
                                  onClick={() => handleUnarchive([selectedInquiry.id])}
                                  className="flex-1 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
                                >
                                  <RotateCcw className="w-4 h-4" /> 还原此询价单
                                </button>
                                <button
                                  onClick={() => handleDelete([selectedInquiry.id])}
                                  className="px-6 py-3 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 transition-colors flex items-center justify-center gap-2"
                                >
                                  <Trash2 className="w-4 h-4" /> 删除
                                </button>
                              </div>
                              <div className="text-xs text-gray-500 text-center">
                                归档时间：{selectedInquiry.archivedAt ? new Date(selectedInquiry.archivedAt).toLocaleString('zh-CN') : '-'}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
  );
}
