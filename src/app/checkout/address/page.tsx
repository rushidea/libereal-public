import { redirect } from 'next/navigation';

export default function LegacyCheckoutAddressPage() {
  redirect('/order');
}
