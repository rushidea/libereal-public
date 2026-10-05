import { connection } from 'next/server';
import ProductsCatalogClient from './ProductsCatalogClient';

export default async function ProductsCatalogPage() {
  await connection();
  return <ProductsCatalogClient />;
}
