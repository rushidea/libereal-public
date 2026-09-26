import Link from 'next/link';

export default function HomeCampaignHero() {
  return <section className="rounded-xl border p-8"><h2 className="text-xl font-semibold">Campaigns</h2><p className="mt-2 text-gray-600">Current campaign details are supplied by the store.</p><Link className="mt-4 inline-block underline" href="/promotions">Browse promotions</Link></section>;
}
