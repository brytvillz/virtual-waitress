'use client';

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

type DataPoint = { date: string; revenue: number };

function fmt(n: number) {
  if (n >= 1000) return '₦' + (n / 1000).toFixed(0) + 'k';
  return '₦' + n;
}

export default function RevenueChart({ data }: { data: DataPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#C41E3A" stopOpacity={0.25} />
            <stop offset="95%" stopColor="#C41E3A" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fill: '#4a4a4a', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tickFormatter={fmt}
          tick={{ fill: '#4a4a4a', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={48}
        />
        <Tooltip
          contentStyle={{
            background: '#1a1a1a',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '12px',
            padding: '10px 14px',
          }}
          labelStyle={{ color: '#9a9098', fontSize: 12, marginBottom: 4 }}
          itemStyle={{ color: '#F0EDE8', fontSize: 13, fontWeight: 600 }}
          formatter={(value) => [fmt(Number(value)), 'Revenue']}
          cursor={{ stroke: 'rgba(255,255,255,0.06)' }}
        />
        <Area
          type="monotone"
          dataKey="revenue"
          stroke="#C41E3A"
          strokeWidth={2}
          fill="url(#revenueGrad)"
          dot={false}
          activeDot={{ r: 4, fill: '#C41E3A', strokeWidth: 0 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
