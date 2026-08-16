'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

type StepId = 'menu' | 'tables' | 'staff' | 'qr';

type Step = {
  id: StepId;
  label: string;
  description: string;
  href: string;
  done: boolean;
};

export default function GettingStarted({
  restaurantId,
}: {
  restaurantId: string;
}) {
  const [loading, setLoading]       = useState(true);
  const [dismissed, setDismissed]   = useState(false);
  const [hasItems, setHasItems]     = useState(false);
  const [hasTables, setHasTables]   = useState(false);
  const [hasStaff, setHasStaff]     = useState(false);
  const [hasQr, setHasQr]           = useState(false);

  const dismissKey = `vw_checklist_dismissed_${restaurantId}`;
  const qrKey      = `vw_qr_visited_${restaurantId}`;

  useEffect(() => {
    if (localStorage.getItem(dismissKey) === 'true') {
      setDismissed(true);
      setLoading(false);
      return;
    }
    setHasQr(localStorage.getItem(qrKey) === 'true');

    const supabase = createClient();
    Promise.all([
      supabase.from('menu_items').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId),
      supabase.from('tables').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId),
      supabase.from('staff').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId).eq('role', 'waiter'),
    ]).then(([items, tables, staff]) => {
      setHasItems((items.count ?? 0) > 0);
      setHasTables((tables.count ?? 0) > 0);
      setHasStaff((staff.count ?? 0) > 0);
      setLoading(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId]);

  function dismiss() {
    localStorage.setItem(dismissKey, 'true');
    setDismissed(true);
  }

  function markQrVisited() {
    localStorage.setItem(qrKey, 'true');
    setHasQr(true);
  }

  if (loading || dismissed) return null;

  const steps: Step[] = [
    {
      id: 'menu',
      label: 'Add your menu',
      description: 'Create categories and add your food & drink items',
      href: '/dashboard/menu',
      done: hasItems,
    },
    {
      id: 'tables',
      label: 'Set up your tables',
      description: 'Tell us how many tables your restaurant has',
      href: '/dashboard/tables',
      done: hasTables,
    },
    {
      id: 'staff',
      label: 'Add a waiter',
      description: 'Create a login code your waiter uses to receive orders',
      href: '/dashboard/staff',
      done: hasStaff,
    },
    {
      id: 'qr',
      label: 'Get your QR codes',
      description: 'Print QR codes and place one on each table — customers scan to order',
      href: '/dashboard/qr',
      done: hasQr,
    },
  ];

  const doneCount = steps.filter(s => s.done).length;

  if (doneCount === steps.length) return null;

  return (
    <div className="bg-[#161616] border border-white/[0.06] rounded-2xl p-6 mb-6">

      {/* Header */}
      <div className="flex items-start justify-between mb-1">
        <div>
          <h2 className="text-[#F0EDE8] text-sm font-semibold">Get started</h2>
          <p className="text-[#6B6570] text-xs mt-0.5">{doneCount} of {steps.length} steps complete</p>
        </div>
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="text-[#4a4a4a] hover:text-[#9a9098] transition-colors p-1 -mt-1 -mr-1"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-white/[0.05] rounded-full mb-5 mt-3 overflow-hidden">
        <div
          className="h-full bg-[#C41E3A] rounded-full transition-all duration-500"
          style={{ width: `${(doneCount / steps.length) * 100}%` }}
        />
      </div>

      {/* Steps */}
      <div className="flex flex-col gap-1">
        {steps.map((step, idx) => (
          <Link
            key={step.id}
            href={step.href}
            onClick={step.id === 'qr' ? markQrVisited : undefined}
            className={`flex items-center gap-4 px-3 py-3 rounded-xl transition-colors group ${
              step.done
                ? 'pointer-events-none opacity-40'
                : 'hover:bg-white/[0.04] cursor-pointer'
            }`}
          >
            {/* Circle: number or checkmark */}
            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-colors ${
              step.done
                ? 'bg-emerald-500/15'
                : 'bg-white/[0.05] border border-white/[0.10] group-hover:border-[#C41E3A]/40'
            }`}>
              {step.done ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6L9 17l-5-5"/>
                </svg>
              ) : (
                <span className="text-[#6B6570] text-xs font-semibold group-hover:text-[#C41E3A] transition-colors">{idx + 1}</span>
              )}
            </div>

            {/* Text */}
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-medium leading-snug ${step.done ? 'line-through text-[#6B6570]' : 'text-[#F0EDE8]'}`}>
                {step.label}
              </p>
              <p className="text-[#4a4a4a] text-xs mt-0.5 leading-snug">{step.description}</p>
            </div>

            {/* Arrow */}
            {!step.done && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4a4a4a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                className="shrink-0 group-hover:stroke-[#9a9098] transition-colors">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
