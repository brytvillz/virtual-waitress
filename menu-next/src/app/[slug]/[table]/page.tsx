import { notFound } from 'next/navigation';
import MenuApp from '@/components/MenuApp';

type Props = { params: Promise<{ slug: string; table: string }> };

export default async function MenuPage({ params }: Props) {
  const { slug, table } = await params;

  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) notFound();
  const tableNum = parseInt(table, 10);
  if (!Number.isInteger(tableNum) || tableNum < 1 || tableNum > 999) notFound();

  return <MenuApp slug={slug} table={String(tableNum)} />;
}
