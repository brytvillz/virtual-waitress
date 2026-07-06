import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import DashboardShell from '@/components/DashboardShell';

export const metadata = {
  title: 'Dashboard — Virtual Waitress',
};

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Load restaurant for this manager
  let restaurant: { id: string; name: string; slug: string; plan: string } | null = null;

  const { data: owned } = await supabase
    .from('restaurants')
    .select('id, name, slug, plan')
    .eq('owner_id', user.id)
    .order('created_at')
    .limit(1)
    .single();

  if (owned) {
    restaurant = owned;
  } else {
    const { data: staffRow } = await supabase
      .from('staff')
      .select('restaurant_id')
      .eq('id', user.id)
      .single();

    if (staffRow) {
      const { data: rest } = await supabase
        .from('restaurants')
        .select('id, name, slug, plan')
        .eq('id', staffRow.restaurant_id)
        .single();
      if (rest) restaurant = rest;
    }
  }

  return (
    <DashboardShell user={user} restaurant={restaurant}>
      {children}
    </DashboardShell>
  );
}
