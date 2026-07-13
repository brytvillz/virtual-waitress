import { notFound } from 'next/navigation';
import WaiterApp from '@/components/WaiterApp';

type Props = { params: Promise<{ slug: string }> };

export default async function SlugWaiterPage({ params }: Props) {
  const { slug } = await params;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) notFound();
  return <WaiterApp slug={slug} />;
}
