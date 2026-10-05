import { connection } from 'next/server';
import SupportClient from './SupportClient';

export default async function SupportPage() {
  await connection();
  return <SupportClient />;
}
