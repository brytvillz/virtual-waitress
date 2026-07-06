'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useRestaurant } from '@/components/DashboardShell';
import CopyButton from '@/components/CopyButton';

const APP_ORIGIN = 'https://app.virtualwaitress.com';

type Table = { table_number: number };

function qrUrl(slug: string, tableNumber: number) {
  return `${APP_ORIGIN}/${slug}/${tableNumber}`;
}

function qrImageSrc(url: string) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=6&color=1A1A1A&bgcolor=FFF8F0&data=${encodeURIComponent(url)}`;
}

export default function QrPage() {
  const restaurant = useRestaurant();
  const [tables, setTables] = useState<Table[]>([]);
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [tagline, setTagline] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (restaurantId: string) => {
    const supabase = createClient();
    const [{ data: rest }, { data: tbls }] = await Promise.all([
      supabase.from('restaurants').select('slug, name, tagline').eq('id', restaurantId).single(),
      supabase.from('tables').select('table_number').eq('restaurant_id', restaurantId).order('table_number'),
    ]);
    if (rest) {
      setSlug(rest.slug ?? '');
      setName(rest.name ?? 'Restaurant');
      setTagline(rest.tagline ?? '');
    }
    setTables((tbls ?? []) as Table[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!restaurant) return;
    load(restaurant.id);
  }, [restaurant, load]);

  function handlePrint() {
    const tableNums = tables.map(t => t.table_number).join(',');
    const params = new URLSearchParams({ r: slug, name, tagline, tables: tableNums });
    window.open(`${APP_ORIGIN}/qr-cards?${params.toString()}`, '_blank');
  }

  if (!restaurant) return null;

  const menuUrl = slug ? `${APP_ORIGIN}/${slug}/1` : '';

  return (
    <div className="p-8 max-w-5xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[#F0EDE8] text-2xl font-bold tracking-tight">QR Codes</h1>
          <p className="text-[#6B6570] text-sm mt-1">One QR code per table — customers scan to view your menu</p>
        </div>
        {tables.length > 0 && (
          <button
            onClick={handlePrint}
            className="bg-[#C41E3A] hover:bg-[#a01830] text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors"
          >
            Print QR Cards
          </button>
        )}
      </div>

      {/* Menu link bar */}
      {menuUrl && (
        <div className="bg-[#161616] border border-white/[0.06] rounded-xl px-4 py-3 flex items-center gap-3 mb-8 flex-wrap">
          <span className="text-[#6B6570] text-xs font-medium shrink-0">Your menu link:</span>
          <a
            href={menuUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#9a9098] text-xs hover:text-[#F0EDE8] transition-colors flex-1 truncate"
          >
            {menuUrl}
          </a>
          <CopyButton text={menuUrl} />
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-[#6B6570] text-sm">
          <span className="w-4 h-4 border-2 border-[#6B6570] border-t-transparent rounded-full animate-spin" />
          Loading…
        </div>
      ) : tables.length === 0 ? (
        <div className="bg-[#161616] border border-white/[0.06] rounded-2xl p-12 text-center">
          <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-[#1f1f1f] flex items-center justify-center">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#4a4a4a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="3" height="3"/></svg>
          </div>
          <h2 className="text-[#F0EDE8] text-lg font-semibold mb-2">No tables yet</h2>
          <p className="text-[#6B6570] text-sm mb-6">
            Add your tables first — each table gets its own QR code.
          </p>
          <Link
            href="/dashboard/tables"
            className="inline-block bg-[#C41E3A] hover:bg-[#a01830] text-white text-sm font-semibold px-5 py-3 rounded-xl transition-colors"
          >
            Go to Tables →
          </Link>
        </div>
      ) : (
        <>
          {/* QR grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {tables.map(table => {
              const url = qrUrl(slug, table.table_number);
              return (
                <div
                  key={table.table_number}
                  className="bg-[#161616] border border-white/[0.06] rounded-2xl p-4 flex flex-col items-center gap-3"
                >
                  {/* QR image */}
                  <div className="w-full aspect-square rounded-xl overflow-hidden bg-[#FFF8F0]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={qrImageSrc(url)}
                      alt={`QR code for Table ${table.table_number}`}
                      loading="lazy"
                      className="w-full h-full object-contain"
                    />
                  </div>

                  <p className="text-[#F0EDE8] text-sm font-semibold">Table {table.table_number}</p>

                  <CopyButton text={url} label="Copy link" />
                </div>
              );
            })}
          </div>

          {/* Print hint */}
          <p className="text-[#4a4a4a] text-xs text-center mt-6">
            Click <span className="text-[#6B6570]">Print QR Cards</span> to open a print-ready page with all table codes.
          </p>
        </>
      )}
    </div>
  );
}
