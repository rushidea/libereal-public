export async function startAlipayCheckout(orderId: string): Promise<void> {
  const paymentRes = await fetch(`/api/orders/${encodeURIComponent(orderId)}/alipay`, { method: 'POST' });
  const paymentData = await paymentRes.json() as { redirectUrl?: unknown; error?: string };
  if (!paymentRes.ok || typeof paymentData.redirectUrl !== 'string') {
    throw new Error(paymentData.error || '支付宝支付创建失败');
  }
  window.location.assign(paymentData.redirectUrl);
}
