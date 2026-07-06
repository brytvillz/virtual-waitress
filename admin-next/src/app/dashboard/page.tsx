'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRestaurant } from '@/components/DashboardShell';
import RevenueChart from '@/components/RevenueChart';
import OrdersChart from '@/components/OrdersChart';

type Order = {
  id: string;
  total: number;
  status: string;
  table_number: string | number;
  created_at: string;
  handled_by: string;
  order_items: { item_name: string; quantity: number; price: number }[];
};
type Staff = { id: string; name: string; role: string };
type DailyData = { date: string; revenue: number; orders: number };

function fmt(n: number) {
  return '₦' + n.toLocaleString('en-NG', { minimumFractionDigits: 0 });
}
function startOf(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString();
}
function last7Days(): DailyData[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return { date: d.toLocaleDateString('en-US', { weekday: 'short' }), revenue: 0, orders: 0 };
  });
}
function trend(current: number, previous: number) {
  if (previous === 0) return null;
  const pct = Math.round(((current - previous) / previous) * 100);
  return pct;
}

export default function AnalyticsPage() {
  const restaurant = useRestaurant();
  const [loading, setLoading] = useState(true);
  const [todayRevenue, setTodayRevenue] = useState(0);
  const [todayOrders, setTodayOrders] = useState(0);
  const [yesterdayRevenue, setYesterdayRevenue] = useState(0);
  const [yesterdayOrders, setYesterdayOrders] = useState(0);
  const [totalOrders, setTotalOrders] = useState(0);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [chartData, setChartData] = useState<DailyData[]>(last7Days());
  const [staff, setStaff] = useState<Staff[]>([]);
  const [waiterStats, setWaiterStats] = useState<Record<string, { orders: number; revenue: number }>>({});
  const [bestSellers, setBestSellers] = useState<{ name: string; qty: number; revenue: number }[]>([]);
  const [recentOrders, setRecentOrders] = useState<Order[]>([]);

  useEffect(() => {
    if (!restaurant) return;
    load(restaurant.id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurant]);

  async function load(restaurantId: string) {
    const supabase = createClient();
    const todayStr = startOf(new Date());
    const yesterdayStart = startOf(new Date(Date.now() - 86400000));
    const sevenDaysAgo = startOf(new Date(Date.now() - 6 * 86400000));

    const [
      { data: todayData },
      { data: yesterdayData },
      { data: allOrders, count: orderCount },
      { data: orderItems },
      { data: recent },
      { data: staffList },
      { data: sevenDayOrders },
    ] = await Promise.all([
      supabase.from('orders').select('total, handled_by').eq('restaurant_id', restaurantId).gte('created_at', todayStr),
      supabase.from('orders').select('total').eq('restaurant_id', restaurantId).gte('created_at', yesterdayStart).lt('created_at', todayStr),
      supabase.from('orders').select('total', { count: 'exact' }).eq('restaurant_id', restaurantId),
      supabase.from('order_items').select('item_name, quantity, price, orders!inner(restaurant_id)').eq('orders.restaurant_id', restaurantId),
      supabase.from('orders').select('id, total, status, table_number, created_at, handled_by, order_items(item_name, quantity, price)').eq('restaurant_id', restaurantId).order('created_at', { ascending: false }).limit(10),
      supabase.from('staff').select('id, name, role').eq('restaurant_id', restaurantId).order('name'),
      supabase.from('orders').select('total, created_at, handled_by').eq('restaurant_id', restaurantId).gte('created_at', sevenDaysAgo),
    ]);

    const todayRev = (todayData ?? []).reduce((s: number, o: { total: number }) => s + (o.total || 0), 0);
    const yestRev  = (yesterdayData ?? []).reduce((s: number, o: { total: number }) => s + (o.total || 0), 0);
    setTodayRevenue(todayRev);
    setTodayOrders((todayData ?? []).length);
    setYesterdayRevenue(yestRev);
    setYesterdayOrders((yesterdayData ?? []).length);

    const allRev = (allOrders ?? []).reduce((s: number, o: { total: number }) => s + (o.total || 0), 0);
    setTotalRevenue(allRev);
    setTotalOrders(orderCount ?? 0);

    // 7-day chart
    const days = last7Days();
    (sevenDayOrders ?? []).forEach((o: { total: number; created_at: string }) => {
      const label = new Date(o.created_at).toLocaleDateString('en-US', { weekday: 'short' });
      const idx = days.findIndex(d => d.date === label);
      if (idx !== -1) { days[idx].revenue += o.total || 0; days[idx].orders++; }
    });
    setChartData([...days]);

    // Waiter stats (7 days)
    const ws: Record<string, { orders: number; revenue: number }> = {};
    (sevenDayOrders ?? []).forEach((o: { handled_by: string; total: number }) => {
      if (!ws[o.handled_by]) ws[o.handled_by] = { orders: 0, revenue: 0 };
      ws[o.handled_by].orders++;
      ws[o.handled_by].revenue += o.total || 0;
    });
    setWaiterStats(ws);
    setStaff((staffList ?? []).filter((s: Staff) => s.role === 'waiter'));

    // Best sellers
    const totals: Record<string, { qty: number; revenue: number }> = {};
    (orderItems ?? []).forEach((i: { item_name: string; quantity: number; price: number }) => {
      if (!totals[i.item_name]) totals[i.item_name] = { qty: 0, revenue: 0 };
      totals[i.item_name].qty += i.quantity;
      totals[i.item_name].revenue += i.quantity * i.price;
    });
    setBestSellers(Object.entries(totals).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.qty - a.qty).slice(0, 5));
    setRecentOrders((recent ?? []) as Order[]);
    setLoading(false);
  }

  if (!restaurant) {
    return <div className="flex items-center justify-center h-96 text-[#6B6570] text-sm">No restaurant found.</div>;
  }

  const revTrend  = trend(todayRevenue, yesterdayRevenue);
  const ordTrend  = trend(todayOrders, yesterdayOrders);
  const totalOrdersLast7 = chartData.reduce((s, d) => s + d.orders, 0);
  const totalRevLast7    = chartData.reduce((s, d) => s + d.revenue, 0);

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-[#F0EDE8] text-2xl font-bold tracking-tight">{restaurant.name}</h1>
        <p className="text-[#6B6570] text-sm mt-1">
          {new Date().toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-[#6B6570] text-sm">
          <span className="w-4 h-4 border-2 border-[#6B6570] border-t-transparent rounded-full animate-spin" />
          Loading analytics…
        </div>
      ) : (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6">
            <KpiCard
              label="Today's Revenue"
              value={fmt(todayRevenue)}
              sub="vs yesterday"
              trend={revTrend}
              accent
            />
            <KpiCard
              label="Today's Orders"
              value={String(todayOrders)}
              sub="vs yesterday"
              trend={ordTrend}
            />
            <KpiCard
              label="7-Day Revenue"
              value={fmt(totalRevLast7)}
              sub={`${totalOrdersLast7} orders`}
            />
            <KpiCard
              label="All-Time Orders"
              value={totalOrders.toLocaleString()}
              sub={fmt(totalRevenue) + ' total'}
            />
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-4">

            {/* Revenue area chart — wider */}
            <div className="lg:col-span-3 bg-[#161616] border border-white/[0.06] rounded-2xl p-5">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="text-[#F0EDE8] text-sm font-semibold">Revenue</h2>
                  <p className="text-[#4a4a4a] text-xs mt-0.5">Last 7 days · Naira</p>
                </div>
                <span className="text-[#F0EDE8] text-lg font-bold">{fmt(totalRevLast7)}</span>
              </div>
              <RevenueChart data={chartData} />
            </div>

            {/* Orders bar chart — narrower */}
            <div className="lg:col-span-2 bg-[#161616] border border-white/[0.06] rounded-2xl p-5">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="text-[#F0EDE8] text-sm font-semibold">Orders</h2>
                  <p className="text-[#4a4a4a] text-xs mt-0.5">Last 7 days</p>
                </div>
                <span className="text-[#F0EDE8] text-lg font-bold">{totalOrdersLast7}</span>
              </div>
              <OrdersChart data={chartData} />
            </div>
          </div>

          {/* Bottom row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">

            {/* Staff performance */}
            <div className="bg-[#161616] border border-white/[0.06] rounded-2xl p-5">
              <h2 className="text-[#F0EDE8] text-sm font-semibold mb-4">Staff Performance <span className="text-[#4a4a4a] font-normal">(7 days)</span></h2>
              {staff.length === 0 ? (
                <p className="text-[#4a4a4a] text-sm">No staff added yet.</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {staff
                    .sort((a, b) => (waiterStats[b.id]?.revenue ?? 0) - (waiterStats[a.id]?.revenue ?? 0))
                    .map((w, idx) => {
                      const s = waiterStats[w.id] ?? { orders: 0, revenue: 0 };
                      const maxRev = Math.max(...staff.map(st => waiterStats[st.id]?.revenue ?? 0), 1);
                      const barPct = Math.round((s.revenue / maxRev) * 100);
                      return (
                        <div key={w.id}>
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2">
                              <span className="text-[#4a4a4a] text-xs w-3">{idx + 1}</span>
                              <div className="w-7 h-7 rounded-full bg-[#C41E3A]/15 flex items-center justify-center shrink-0">
                                <span className="text-[#C41E3A] text-xs font-bold">{w.name.charAt(0).toUpperCase()}</span>
                              </div>
                              <p className="text-[#F0EDE8] text-sm font-medium">{w.name}</p>
                            </div>
                            <div className="text-right">
                              <p className="text-[#F0EDE8] text-sm font-semibold">{fmt(s.revenue)}</p>
                              <p className="text-[#6B6570] text-xs">{s.orders} order{s.orders !== 1 ? 's' : ''}</p>
                            </div>
                          </div>
                          {/* Progress bar */}
                          <div className="ml-5 h-1 rounded-full bg-white/[0.05] overflow-hidden">
                            <div
                              className="h-full rounded-full bg-[#C41E3A]/60 transition-all"
                              style={{ width: `${barPct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>

            {/* Best sellers */}
            <div className="bg-[#161616] border border-white/[0.06] rounded-2xl p-5">
              <h2 className="text-[#F0EDE8] text-sm font-semibold mb-4">Best Sellers <span className="text-[#4a4a4a] font-normal">(all time)</span></h2>
              {bestSellers.length === 0 ? (
                <p className="text-[#4a4a4a] text-sm">No orders yet.</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {bestSellers.map((item, idx) => {
                    const maxQty = bestSellers[0].qty;
                    const barPct = Math.round((item.qty / maxQty) * 100);
                    return (
                      <div key={item.name}>
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-3">
                            <span className="text-[#4a4a4a] text-xs font-mono w-4 text-right">{idx + 1}</span>
                            <span className="text-[#F0EDE8] text-sm truncate max-w-[160px]">{item.name}</span>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <span className="text-[#6B6570] text-xs">{item.qty}×</span>
                            <span className="text-[#9a9098] text-sm font-medium">{fmt(item.revenue)}</span>
                          </div>
                        </div>
                        <div className="ml-7 h-1 rounded-full bg-white/[0.05] overflow-hidden">
                          <div
                            className="h-full rounded-full bg-[#C41E3A]/40 transition-all"
                            style={{ width: `${barPct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Recent orders */}
          <div className="bg-[#161616] border border-white/[0.06] rounded-2xl p-5">
            <h2 className="text-[#F0EDE8] text-sm font-semibold mb-4">Recent Orders</h2>
            {recentOrders.length === 0 ? (
              <p className="text-[#4a4a4a] text-sm">No orders yet.</p>
            ) : (
              <div className="overflow-x-auto -mx-1">
                <table className="w-full text-sm min-w-[500px]">
                  <thead>
                    <tr className="text-[#4a4a4a] text-xs uppercase tracking-wider border-b border-white/[0.05]">
                      <th className="text-left pb-3 font-medium pl-1">Table</th>
                      <th className="text-left pb-3 font-medium">Items</th>
                      <th className="text-left pb-3 font-medium">Status</th>
                      <th className="text-right pb-3 font-medium">Total</th>
                      <th className="text-right pb-3 font-medium pr-1">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {recentOrders.map(order => (
                      <tr key={order.id} className="hover:bg-white/[0.02] transition-colors">
                        <td className="py-3 text-[#F0EDE8] pl-1">Table {order.table_number}</td>
                        <td className="py-3 text-[#6B6570] max-w-[220px] truncate">
                          {order.order_items?.map(i => `${i.item_name} ×${i.quantity}`).join(', ') || '—'}
                        </td>
                        <td className="py-3"><StatusBadge status={order.status} /></td>
                        <td className="py-3 text-right text-[#9a9098] font-semibold">{fmt(order.total)}</td>
                        <td className="py-3 text-right text-[#4a4a4a] text-xs pr-1">
                          {new Date(order.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function KpiCard({ label, value, sub, trend: trendPct, accent }: {
  label: string; value: string; sub: string; trend?: number | null; accent?: boolean;
}) {
  const up   = trendPct != null && trendPct > 0;
  const down = trendPct != null && trendPct < 0;

  return (
    <div className={`bg-[#161616] border rounded-2xl p-4 md:p-5 relative overflow-hidden ${
      accent ? 'border-[#C41E3A]/20' : 'border-white/[0.06]'
    }`}>
      {accent && (
        <div className="absolute top-0 left-0 w-1 h-full bg-[#C41E3A] rounded-l-2xl" />
      )}
      <p className="text-[#6B6570] text-xs font-medium uppercase tracking-wider mb-2 pl-1">{label}</p>
      <p className="text-[#F0EDE8] text-xl md:text-2xl font-bold tracking-tight mb-1 pl-1">{value}</p>
      <div className="flex items-center gap-1.5 pl-1">
        {trendPct != null ? (
          <>
            <span className={`text-xs font-semibold ${up ? 'text-emerald-400' : down ? 'text-[#ff6b6b]' : 'text-[#6B6570]'}`}>
              {up ? '↑' : down ? '↓' : '—'} {Math.abs(trendPct)}%
            </span>
            <span className="text-[#4a4a4a] text-xs">{sub}</span>
          </>
        ) : (
          <span className="text-[#4a4a4a] text-xs">{sub}</span>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    completed: 'bg-emerald-500/10 text-emerald-400',
    pending:   'bg-amber-500/10 text-amber-400',
    cancelled: 'bg-red-500/10 text-red-400',
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium capitalize ${styles[status] ?? 'bg-white/5 text-[#6B6570]'}`}>
      {status}
    </span>
  );
}
