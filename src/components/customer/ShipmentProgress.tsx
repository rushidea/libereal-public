export type CustomerShipmentProgress = {
  deliveredAt?: string | null;
  fulfillmentParcel?: { status: string } | null;
};
export default function ShipmentProgress({ shipment }: { shipment: CustomerShipmentProgress }) {
  const status = shipment.fulfillmentParcel?.status;
  if (status === 'exception') return <span className="text-amber-800"> · 物流异常，正在核对</span>;
  if (status === 'shortfall') return <span className="text-amber-800"> · 已核实有短少或退回</span>;
  if (shipment.deliveredAt) return <span> · 已签收（{new Date(shipment.deliveredAt).toLocaleString('zh-CN')}）</span>;
  if (status === 'partially_received') return <span> · 部分签收</span>;
  if (status === 'in_transit') return <span> · 运输中</span>;
  return null;
}
