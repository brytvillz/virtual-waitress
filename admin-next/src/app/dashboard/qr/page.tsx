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

const CARD_DESIGNS = [
  {
    id: 'nightlife-dark',
    name: 'Nightlife Dark',
    style: 'Near-black · Crimson red · Bold type',
    accent: '#C41E3A',
    bg: '#0A0208',
    text: '#F0EDE8',
    best: 'Bars, lounges & nightlife spots',
  },
  {
    id: 'cafe-light',
    name: 'Café Light',
    style: 'Warm cream · Forest green · Clean & cozy',
    accent: '#2D6A4F',
    bg: '#F5F0E8',
    text: '#2C1A0E',
    best: 'Cafés, bakeries & brunch spots',
  },
  {
    id: 'street-energy',
    name: 'Street Energy',
    style: 'Deep navy · Vibrant orange · Urban energy',
    accent: '#FF6B1A',
    bg: '#070D1A',
    text: '#F0F4FF',
    best: 'Fast-casual, suya spots & street food',
  },
  {
    id: 'heritage-gold',
    name: 'Heritage Gold',
    style: 'Dark forest · Rich gold · Nigerian heritage',
    accent: '#C9920A',
    bg: '#0B1508',
    text: '#F5E6C8',
    best: 'Cultural restaurants & traditional dining',
  },
  {
    id: 'pure-luxury',
    name: 'Pure Luxury',
    style: 'Near-black · Champagne gold · Fine dining',
    accent: '#C9A84C',
    bg: '#080808',
    text: '#F0E8D8',
    best: 'Upscale restaurants & hotel dining',
  },
  {
    id: 'tropical-bright',
    name: 'Tropical Bright',
    style: 'Mint white · Vivid green · Fresh & joyful',
    accent: '#16A34A',
    bg: '#F0FDF4',
    text: '#14532D',
    best: 'Family spots, food courts & outdoor dining',
  },
];

const QUANTITIES = [10, 25, 50, 100, 200, 500];

export default function QrPage() {
  const restaurant = useRestaurant();
  const [tables, setTables] = useState<Table[]>([]);
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [tagline, setTagline] = useState('');
  const [loading, setLoading] = useState(true);

  // Physical card order state
  const [selectedDesign, setSelectedDesign] = useState('');
  const [cardFormat, setCardFormat] = useState<'tent' | 'flyer'>('tent');
  const [quantity, setQuantity] = useState(50);
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliveryPhone, setDeliveryPhone] = useState('');
  const [orderSubmitted, setOrderSubmitted] = useState(false);

  function toSlug(str: string) {
    return str.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  const load = useCallback(async (restaurantId: string) => {
    const supabase = createClient();
    const [{ data: rest }, { data: tbls }] = await Promise.all([
      supabase.from('restaurants').select('slug, name, tagline').eq('id', restaurantId).single(),
      supabase.from('tables').select('table_number').eq('restaurant_id', restaurantId).order('table_number'),
    ]);
    if (rest) {
      setName(rest.name ?? 'Restaurant');
      setTagline(rest.tagline ?? '');

      if (rest.slug) {
        setSlug(rest.slug);
      } else {
        // Auto-generate a unique slug if missing
        const base = toSlug(rest.name ?? 'restaurant') || 'restaurant';
        let candidate = base;
        let counter = 2;
        while (true) {
          const { data: existing } = await supabase
            .from('restaurants')
            .select('id')
            .eq('slug', candidate)
            .maybeSingle();
          if (!existing) break;
          candidate = `${base}-${counter++}`;
        }
        await supabase.from('restaurants').update({ slug: candidate }).eq('id', restaurantId);
        setSlug(candidate);
      }
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

  function handleOrderSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedDesign) return;
    const design = CARD_DESIGNS.find(d => d.id === selectedDesign);
    const formatLabel = cardFormat === 'tent' ? 'Table Tent (A6 folded, stands upright)' : 'Flat Flyer (A5, displayed in holder)';
    const subject = `Physical QR Card Order — ${restaurant?.name ?? name}`;
    const body = [
      `Restaurant: ${restaurant?.name ?? name}`,
      `Design: ${design?.name}`,
      `Format: ${formatLabel}`,
      `Quantity: ${quantity} cards`,
      `Delivery Address: ${deliveryAddress}`,
      `Contact Phone: ${deliveryPhone}`,
      `Menu Slug: ${slug}`,
      `Tables: ${tables.map(t => t.table_number).join(', ') || 'None set yet'}`,
    ].join('\n');
    window.location.href = `mailto:support@virtualwaitress.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    setOrderSubmitted(true);
  }

  if (!restaurant) return null;

  const menuUrl = slug ? `${APP_ORIGIN}/${slug}/1` : '';

  return (
    <div className="p-8 max-w-5xl mx-auto">

      {/* ── Header ─────────────────────────────────────────────────── */}
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

      {/* ── Menu link bar ───────────────────────────────────────────── */}
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

      {loading || !slug ? (
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
          {/* ── QR grid ─────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {tables.map(table => {
              const url = qrUrl(slug, table.table_number);
              return (
                <div
                  key={table.table_number}
                  className="bg-[#161616] border border-white/[0.06] rounded-2xl p-4 flex flex-col items-center gap-3"
                >
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

          <p className="text-[#4a4a4a] text-xs text-center mt-6">
            Click <span className="text-[#6B6570]">Print QR Cards</span> to open a print-ready page with all table codes.
          </p>
        </>
      )}

      {/* ── Physical Card Order ─────────────────────────────────────── */}
      <div className="mt-14 pt-12 border-t border-white/[0.06]">
        <div className="mb-8">
          <h2 className="text-[#F0EDE8] text-xl font-bold mb-1">Order Physical QR Cards</h2>
          <p className="text-[#6B6570] text-sm">
            Professionally printed card stands for your tables — customers pick them up, read them, and scan. We handle printing and delivery.
          </p>
        </div>

        {orderSubmitted ? (
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-8 text-center">
            <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-emerald-500/10 flex items-center justify-center">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <h3 className="text-[#F0EDE8] font-semibold mb-2">Request sent!</h3>
            <p className="text-[#6B6570] text-sm">
              We&apos;ll reach out within 24 hours with pricing and delivery details for your order.
            </p>
            <button
              onClick={() => setOrderSubmitted(false)}
              className="mt-6 text-[#6B6570] hover:text-[#9a9098] text-sm transition-colors"
            >
              Submit another request
            </button>
          </div>
        ) : (
          <form onSubmit={handleOrderSubmit} className="space-y-8">

            {/* Step 1: Choose design */}
            <div>
              <p className="text-[#9a9098] text-xs font-semibold uppercase tracking-wider mb-4">
                Step 1 — Choose a design
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {CARD_DESIGNS.map(design => {
                  const active = selectedDesign === design.id;
                  return (
                    <button
                      key={design.id}
                      type="button"
                      onClick={() => setSelectedDesign(design.id)}
                      className={`relative flex flex-col rounded-xl overflow-hidden border-2 transition-all text-left ${
                        active
                          ? 'border-[#C41E3A] ring-2 ring-[#C41E3A]/25 scale-[1.02]'
                          : 'border-white/[0.06] hover:border-white/20'
                      }`}
                    >
                      {/* colour preview */}
                      <div style={{ background: design.bg }} className="h-16 w-full relative flex items-center justify-center">
                        <div style={{ background: design.accent }} className="absolute bottom-0 left-0 right-0 h-[6px]" />
                        <span style={{ color: design.text }} className="text-sm font-black opacity-70 select-none">Aa</span>
                      </div>
                      {/* label */}
                      <div className="bg-[#111] px-3 py-2.5">
                        <div className="text-[#F0EDE8] text-[11px] font-semibold leading-tight">{design.name}</div>
                        <div className="text-[#4a4a4a] text-[10px] mt-0.5 leading-tight">{design.best}</div>
                      </div>
                      {active && (
                        <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-[#C41E3A] flex items-center justify-center shadow-lg">
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                            <path d="M2 5l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Step 2: Choose format */}
            <div>
              <p className="text-[#9a9098] text-xs font-semibold uppercase tracking-wider mb-4">
                Step 2 — Choose a format
              </p>
              <div className="grid sm:grid-cols-2 gap-3">
                {[
                  {
                    id: 'tent' as const,
                    name: 'Table Tent',
                    size: 'A6 folded · 105 × 148 mm',
                    desc: 'Folds and stands upright on the table. Double-sided — front shows the QR and pain point, back shows additional info.',
                    icon: (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 20h18M6 20V4l6 4 6-4v16"/>
                      </svg>
                    ),
                  },
                  {
                    id: 'flyer' as const,
                    name: 'Flat Flyer / Standee',
                    size: 'A5 · 148 × 210 mm',
                    desc: 'Flat card placed in an acrylic holder or left flat on the table. More space for your branding and information.',
                    icon: (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2"/>
                        <line x1="3" y1="12" x2="21" y2="12"/>
                      </svg>
                    ),
                  },
                ].map(fmt => {
                  const active = cardFormat === fmt.id;
                  return (
                    <button
                      key={fmt.id}
                      type="button"
                      onClick={() => setCardFormat(fmt.id)}
                      className={`text-left rounded-2xl p-5 border transition-all ${
                        active
                          ? 'border-[#C41E3A]/60 bg-[#C41E3A]/08'
                          : 'border-white/[0.06] bg-[#161616] hover:border-white/[0.12]'
                      }`}
                    >
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-3 ${active ? 'bg-[#C41E3A]/15 text-[#C41E3A]' : 'bg-[#1f1f1f] text-[#6B6570]'}`}>
                        {fmt.icon}
                      </div>
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <p className="text-[#F0EDE8] text-sm font-semibold">{fmt.name}</p>
                        {active && (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#C41E3A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-0.5">
                            <polyline points="20 6 9 17 4 12"/>
                          </svg>
                        )}
                      </div>
                      <p className="text-[#4a4a4a] text-xs mb-2">{fmt.size}</p>
                      <p className="text-[#6B6570] text-xs leading-relaxed">{fmt.desc}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Step 3: Quantity */}
            <div>
              <p className="text-[#9a9098] text-xs font-semibold uppercase tracking-wider mb-4">
                Step 3 — Quantity
              </p>
              <div className="flex flex-wrap gap-2">
                {QUANTITIES.map(q => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setQuantity(q)}
                    className={`px-5 py-2.5 rounded-xl text-sm font-medium border transition-all ${
                      quantity === q
                        ? 'border-[#C41E3A]/60 bg-[#C41E3A]/10 text-[#F0EDE8]'
                        : 'border-white/[0.08] text-[#6B6570] hover:border-white/[0.14] hover:text-[#9a9098]'
                    }`}
                  >
                    {q}
                  </button>
                ))}
              </div>
              <p className="text-[#4a4a4a] text-xs mt-2">Pricing based on quantity — we&apos;ll quote you after your request.</p>
            </div>

            {/* Step 4: Delivery details */}
            <div>
              <p className="text-[#9a9098] text-xs font-semibold uppercase tracking-wider mb-4">
                Step 4 — Delivery details
              </p>
              <div className="grid sm:grid-cols-2 gap-4">
                <label className="flex flex-col gap-1.5">
                  <span className="text-[#9a9098] text-xs">Delivery address *</span>
                  <textarea
                    required
                    rows={3}
                    value={deliveryAddress}
                    onChange={e => setDeliveryAddress(e.target.value)}
                    placeholder="Restaurant address or delivery location"
                    className="bg-[#111] border border-white/[0.08] rounded-xl px-4 py-3 text-[#F0EDE8] text-sm placeholder-[#4a4a4a] outline-none focus:border-[#C41E3A]/50 transition-colors resize-none"
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[#9a9098] text-xs">Phone number *</span>
                  <input
                    required
                    type="tel"
                    value={deliveryPhone}
                    onChange={e => setDeliveryPhone(e.target.value)}
                    placeholder="+234 80X XXX XXXX"
                    className="bg-[#111] border border-white/[0.08] rounded-xl px-4 py-3 text-[#F0EDE8] text-sm placeholder-[#4a4a4a] outline-none focus:border-[#C41E3A]/50 transition-colors"
                  />
                  <span className="text-[#4a4a4a] text-xs">For delivery coordination and order confirmation</span>
                </label>
              </div>
            </div>

            {/* Order summary */}
            {selectedDesign && (
              <div className="bg-[#161616] border border-white/[0.06] rounded-xl p-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
                <span className="text-[#6B6570]">Design: <span className="text-[#F0EDE8]">{CARD_DESIGNS.find(d => d.id === selectedDesign)?.name}</span></span>
                <span className="text-[#6B6570]">Format: <span className="text-[#F0EDE8]">{cardFormat === 'tent' ? 'Table Tent' : 'Flat Flyer'}</span></span>
                <span className="text-[#6B6570]">Quantity: <span className="text-[#F0EDE8]">{quantity} cards</span></span>
              </div>
            )}

            <button
              type="submit"
              disabled={!selectedDesign}
              className="bg-[#C41E3A] hover:bg-[#a01830] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold px-6 py-3.5 rounded-xl transition-colors"
            >
              Request a Quote →
            </button>

            <p className="text-[#4a4a4a] text-xs -mt-4">
              This sends a request to our team. We&apos;ll contact you within 24 hours with pricing, timeline, and payment options.
            </p>
          </form>
        )}
      </div>

    </div>
  );
}
