import Link from 'next/link';

export const metadata = { title: 'Promotions', description: 'Promotion engine interface and catalog shell.' };

export default function PromotionsPage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <h1 className="text-3xl font-semibold">Promotions</h1>
      <p className="mt-4 max-w-2xl text-gray-600">Campaign availability and terms are provided by the store at runtime.</p>
      <Link className="mt-8 inline-flex underline" href="/products">Browse products</Link>
    </main>
  );
}
