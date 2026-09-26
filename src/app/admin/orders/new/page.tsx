'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCart } from '@/context/CartContext';
import { ArrowLeft, Users, MapPin, CreditCard, CheckCircle, Zap, ChevronRight, Package, ShoppingCart } from 'lucide-react';
import type { User } from '@prisma/client';
import { formatOrderPaymentMethod, ORDER_PAYMENT_METHODS } from '@/data/payment-methods';

interface Customer extends User {
  addresses: Address[];
}

interface Address {
  id: string;
  userId: string;
  name: string;
  phone: string;
  address: string;
  label: string | null;
  institution: string | null;
  isDefault: number;
  createdAt: Date;
  updatedAt: Date;
}

interface CartProductItem {
  isQuickOrder: false;
  product: {
    id: string;
    name: string;
    brand: string;
    catalogNumber: string;
    spec: string | null;
    target: string | null;
    price: number;
    promotionalPrice: number | null;
    promotion: string | null;
    originalPrice: number | null;
  };
  quantity: number;
}

const PAYMENT_METHODS = ORDER_PAYMENT_METHODS.map(method => ({
  value: method.value,
  label: method.label,
  desc: method.description,
}));

type Step = 'customer' | 'address' | 'payment' | 'confirm';

const STEP_ORDER: Step[] = ['customer', 'address', 'payment', 'confirm'];

export default function NewOrderPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const { items, removeItem } = useCart();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [selectedAddress, setSelectedAddress] = useState<Address | null>(null);
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');


  // Load customers
  useEffect(() => {
    fetch('/api/admin/customers')
      .then(r => r.json())
      .then(data => {
        if (data.customers) setCustomers(data.customers);
      });
  }, []);

  const productItems = items.filter(i => !i.isQuickOrder) as unknown as CartProductItem[];

  const subtotal = productItems.reduce((sum, item) => {
    return sum + (item.product.promotionalPrice ?? item.product.price) * item.quantity;
  }, 0);

  const formatPrice = (price: number) =>
    new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(price);

  const extraFee = 0;
  const grandTotal = subtotal + extraFee;

  const handleCustomerSelect = (c: Customer) => {
    setSelectedCustomer(c);
    setSelectedAddress(null);
    setShowCustomerDropdown(false);
    setCustomerSearch('');
  };

  // Close dropdown on outside click
  useEffect(() => {
    if (!showCustomerDropdown) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Element;
      if (!target.closest('.customer-dropdown')) {
        setShowCustomerDropdown(false);
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [showCustomerDropdown]);

  const handleSubmit = async () => {
    if (!selectedCustomer || !paymentMethod || productItems.length === 0) return;
    setSubmitting(true);
    setError('');
    try {
      const orderItems = productItems.map(item => ({
        productId: item.product.id,
        name: item.product.name,
        brand: item.product.brand,
        catalogNumber: item.product.catalogNumber,
        spec: item.product.spec || null,
        price: item.product.promotionalPrice ?? item.product.price,
        quantity: item.quantity,
        shippedQty: 0,
        leadTime: null,
        status: 'pending',
      }));
      const body = {
        items: orderItems,
        paymentMethod,
        forCustomerId: selectedCustomer.id,
        addressId: selectedAddress?.id,
        extraFee,
      };
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || '创建订单失败');
      }
      const data = await res.json();
      productItems.forEach(item => removeItem(item.product.id));
      router.push(`/account/orders?new=${data.orderId}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '创建订单失败，请重试');
      setSubmitting(false);
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const canProceed = (step: Step) => {
    switch (step) {
      case 'customer': return !!selectedCustomer;
      case 'address': return true; // address is optional
      case 'payment': return !!paymentMethod;
      case 'confirm': return true;
      default: return false;
    }
  };

  if (!session || (session.user as User)?.role !== 'admin') {
    return (
      <div className="min-h-screen libereal-service-page flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-500 mb-4">请先以管理员身份登录</p>
          <Link href="/admin" className="text-brand-600 hover:underline">返回管理后台</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
        {/* Step indicator */}
        <div className="mb-8 w-full overflow-x-auto pb-1">
          <div className="flex min-w-max items-center gap-2">
            {STEP_ORDER.map((step, idx) => {
            const labels: Record<Step, string> = {
              customer: '选择客户',
              address: '配送地址',
              payment: '付款方式',
              confirm: '确认订单',
            };
            const icons: Record<Step, React.ReactNode> = {
              customer: <Users className="w-4 h-4" />,
              address: <MapPin className="w-4 h-4" />,
              payment: <CreditCard className="w-4 h-4" />,
              confirm: <CheckCircle className="w-4 h-4" />,
            };
            const isActive = step === 'customer';
            const isDone = idx < STEP_ORDER.indexOf('customer');
            return (
              <div key={step} className="flex items-center gap-2">
                <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  isActive ? 'bg-brand-500 text-white' : isDone ? 'bg-brand-100 text-brand-700' : 'bg-gray-100 text-gray-400'
                }`}>
                  {icons[step]}
                  {labels[step]}
                </div>
                {idx < STEP_ORDER.length - 1 && <ChevronRight className="w-4 h-4 text-gray-300" />}
              </div>
            );
            })}
          </div>
        </div>

        {/* Step 1: Customer */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-4">
          <div className="flex items-center gap-2 mb-4">
            <Users className="w-5 h-5 text-brand-600" />
            <h2 className="text-lg font-semibold text-gray-900">选择客户</h2>
          </div>
          <div className="relative customer-dropdown">
            <button
              onClick={() => setShowCustomerDropdown(v => !v)}
              className="w-full flex items-center justify-between px-4 py-3 border border-gray-200 rounded-xl text-left hover:border-brand-400 transition-colors customer-dropdown"
            >
              {selectedCustomer ? (
                <span className="text-gray-800">
                  {selectedCustomer.name}
                  {selectedCustomer.institution ? <span className="text-gray-400"> · {selectedCustomer.institution}</span> : null}
                  <span className="text-gray-400"> · {selectedCustomer.email}</span>
                </span>
              ) : (
                <span className="text-gray-400">请选择客户...</span>
              )}
              <ChevronRight className={`w-4 h-4 text-gray-400 transition-transform ${showCustomerDropdown ? 'rotate-90' : ''}`} />
            </button>
            {showCustomerDropdown && (
              <div className="absolute left-0 right-0 top-full mt-1 bg-white rounded-xl shadow-xl border border-gray-100 z-50">
                <div className="p-2 border-b border-gray-100 sticky top-0 bg-white rounded-t-xl">
                  <input
                    type="text"
                    value={customerSearch}
                    onChange={e => setCustomerSearch(e.target.value)}
                    placeholder="搜索客户姓名/机构/邮箱..."
                    autoFocus
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-brand-400 text-gray-900 placeholder-gray-400"
                  />
                </div>
                <div className="max-h-64 overflow-y-auto customer-dropdown">
                  {customers
                    .filter(c => {
                      if (!customerSearch) return true;
                      const q = customerSearch.toLowerCase();
                      return (
                        (c.name || '').toLowerCase().includes(q) ||
                        (c.institution?.toLowerCase().includes(q) ?? false) ||
                        c.email.toLowerCase().includes(q)
                      );
                    })
                    .map(c => (
                      <button
                        key={c.id}
                        onClick={() => handleCustomerSelect(c)}
                        className={`w-full text-left px-4 py-3 hover:bg-brand-50 transition-colors border-b border-gray-50 last:border-0 ${selectedCustomer?.id === c.id ? 'bg-brand-50' : ''}`}
                      >
                        <div className="text-sm font-medium text-gray-800">{c.name}</div>
                        <div className="text-xs text-gray-400">{c.institution || c.email}</div>
                      </button>
                    ))}
                  {customers.filter(c => {
                    if (!customerSearch) return true;
                    const q = customerSearch.toLowerCase();
                    return (
                        (c.name || '').toLowerCase().includes(q) ||
                      (c.institution?.toLowerCase().includes(q) ?? false) ||
                      c.email.toLowerCase().includes(q)
                    );
                  }).length === 0 && (
                    <div className="px-4 py-6 text-sm text-gray-400 text-center">无匹配结果</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Step 2: Address */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-4">
          <div className="flex items-center gap-2 mb-4">
            <MapPin className="w-5 h-5 text-brand-600" />
            <h2 className="text-lg font-semibold text-gray-900">配送地址</h2>
            <span className="text-xs text-gray-400 ml-1">（可选）</span>
          </div>
          {!selectedCustomer ? (
            <p className="text-sm text-gray-400">请先选择客户</p>
          ) : selectedCustomer.addresses.length === 0 ? (
            <p className="text-sm text-gray-400">该客户暂无地址信息</p>
          ) : (
            <div className="space-y-2">
              {selectedCustomer.addresses.map(addr => (
                <button
                  key={addr.id}
                  onClick={() => setSelectedAddress(addr.id === selectedAddress?.id ? null : addr)}
                  className={`w-full text-left px-4 py-3 rounded-xl transition-colors border ${
                    selectedAddress?.id === addr.id
                      ? 'border-brand-400 bg-brand-50'
                      : 'border-gray-100 hover:border-gray-200'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${selectedAddress?.id === addr.id ? 'bg-brand-500' : 'bg-gray-300'}`} />
                    <div>
                      <div className="text-sm font-medium text-gray-800">{addr.name} · {addr.phone}</div>
                      <div className="text-xs text-gray-400 mt-0.5">{addr.address}</div>
                      {addr.isDefault === 1 && (
                        <span className="inline-block mt-1 text-xs px-1.5 py-0.5 bg-brand-100 text-brand-700 rounded">默认</span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Step 3: Payment */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-4">
          <div className="flex items-center gap-2 mb-4">
            <CreditCard className="w-5 h-5 text-brand-600" />
            <h2 className="text-lg font-semibold text-gray-900">付款方式</h2>
          </div>
          <div className="space-y-2">
            {PAYMENT_METHODS.map(pm => (
              <button
                key={pm.value}
                onClick={() => setPaymentMethod(pm.value)}
                className={`w-full text-left px-4 py-3 rounded-xl transition-colors border flex items-center justify-between ${
                  paymentMethod === pm.value ? 'border-brand-400 bg-brand-50' : 'border-gray-100 hover:border-gray-200'
                }`}
              >
                <div>
                  <div className="text-sm font-medium text-gray-800">{pm.label}</div>
                  <div className="text-xs text-gray-400">{pm.desc}</div>
                </div>
                {paymentMethod === pm.value && (
                  <div className="w-5 h-5 rounded-full bg-brand-500 flex items-center justify-center">
                    <CheckCircle className="w-3.5 h-3.5 text-white" />
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Step 4: Confirm */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-4">
          <div className="flex items-center gap-2 mb-4">
            <Package className="w-5 h-5 text-brand-600" />
            <h2 className="text-lg font-semibold text-gray-900">确认订单</h2>
          </div>

          {/* Order summary */}
          <div className="bg-gray-50 rounded-xl p-4 mb-4">
            <div className="flex items-center gap-2 mb-3">
              <Users className="w-4 h-4 text-gray-400" />
              <span className="text-sm text-gray-600">
                {selectedCustomer ? (
                  <>
                    <span className="font-medium text-gray-800">{selectedCustomer.name}</span>
                    <span className="text-gray-400"> · {selectedCustomer.institution || selectedCustomer.email}</span>
                  </>
                ) : <span className="text-gray-400">未选择客户</span>}
              </span>
            </div>
            {selectedAddress && (
              <div className="flex items-center gap-2 mb-3">
                <MapPin className="w-4 h-4 text-gray-400" />
                <span className="text-sm text-gray-600">{selectedAddress.name} · {selectedAddress.phone} · {selectedAddress.address}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-gray-400" />
              <span className="text-sm text-gray-600">{paymentMethod ? formatOrderPaymentMethod(paymentMethod) : <span className="text-gray-400">未选择</span>}</span>
            </div>
          </div>

          {/* Product list */}
          {productItems.length === 0 ? (
            <div className="text-center py-6">
              <ShoppingCart className="w-10 h-10 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-400">购物车为空</p>
              <Link href="/products" className="text-brand-600 text-sm hover:underline mt-1 inline-block">去添加产品</Link>
            </div>
          ) : (
            <div className="space-y-3">
              {productItems.map(item => (
                <div key={item.product.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                  <div className="bg-brand-100 rounded-lg p-2 flex-shrink-0">
                    <Package className="w-4 h-4 text-brand-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-800 truncate">{item.product.name}</div>
                    <div className="text-xs text-gray-400">{item.product.brand} · {item.product.catalogNumber}</div>
                  </div>
                  <div className="text-sm text-gray-500">× {item.quantity}</div>
                  <div className="text-sm font-semibold text-brand-600">
                    {formatPrice((item.product.promotionalPrice ?? item.product.price) * item.quantity)}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Total */}
          {productItems.length > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <div className="flex items-center justify-between mb-2">
                <span className="text-gray-500">小计</span>
                <span className="text-gray-800">{formatPrice(subtotal)}</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="font-semibold text-gray-900">合计</span>
                <span className="text-xl font-bold text-brand-600">{formatPrice(grandTotal)}</span>
              </div>
            </div>
          )}

          {error && (
            <div className="mt-3 text-sm text-red-500">{error}</div>
          )}
        </div>

        {/* Submit button */}
        <div className="flex items-center gap-3 mt-6">
          <Link
            href="/cart"
            className="px-6 py-3 border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50 transition-colors flex items-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />返回购物车
          </Link>
          <button
            onClick={handleSubmit}
            disabled={!selectedCustomer || !paymentMethod || productItems.length === 0 || submitting}
            className="flex-1 bg-brand-500 hover:bg-brand-600 disabled:bg-brand-300 text-white py-3 rounded-xl font-semibold transition-colors flex items-center justify-center gap-2"
          >
            {submitting ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <Zap className="w-4 h-4" />
            )}
            确认下单（代客户确认）
          </button>
        </div>
        <p className="text-xs text-gray-400 text-center mt-3">订单将发送至客户账户，客户确认后生效</p>
      </div>
  );
}
