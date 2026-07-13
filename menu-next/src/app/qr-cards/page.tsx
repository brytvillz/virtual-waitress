'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

const APP_ORIGIN = 'https://app.virtualwaitress.com';

const DEFAULTS = {
  slug:    'nnewi-buka',
  name:    'Nnewi Buka',
  tagline: 'Authentic Igbo Home Cooking',
  tables:  ['1', '2', '3', '4', '5', '6'],
};

function VwMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <rect width="22" height="22" rx="5" fill="#1A1A1A"/>
      <text x="11" y="16" textAnchor="middle" fill="white" fontSize="9" fontWeight="900" fontFamily="system-ui,sans-serif" letterSpacing="0.5">VW</text>
    </svg>
  );
}

function QrCard({ slug, name, tagline, table }: { slug: string; name: string; tagline: string; table: string }) {
  const menuUrl = `${APP_ORIGIN}/${slug}/${table}`;
  const qrUrl   = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=6&color=1A1A1A&bgcolor=FFF8F0&data=${encodeURIComponent(menuUrl)}`;

  return (
    <div className="qr-card">
      <div className="card-header">
        <p className="card-restaurant">{name}</p>
        <p className="card-tagline">{tagline}</p>
      </div>
      <div className="card-body">
        <p className="card-cta">Scan to view our menu</p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={qrUrl}
          alt={`QR code for table ${table}`}
          width={160}
          height={160}
          className="card-qr"
        />
        <p className="card-sub">No app needed · Works on any phone</p>
      </div>
      <div className="card-footer">
        <div className="card-table-row">
          <VwMark />
          <span className="card-table-num">Table {table}</span>
        </div>
        <p className="card-brand">Virtual Waitress</p>
      </div>
    </div>
  );
}

function QrCardsInner() {
  const params  = useSearchParams();
  const slug    = params.get('r')        || DEFAULTS.slug;
  const name    = params.get('name')     || DEFAULTS.name;
  const tagline = params.get('tagline')  || DEFAULTS.tagline;
  const tables  = params.get('tables')
    ? params.get('tables')!.split(',').map(t => t.trim()).filter(Boolean)
    : DEFAULTS.tables;

  return (
    <>
      <style>{`
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        body{background:#E8E0D8;font-family:system-ui,-apple-system,sans-serif;padding:16px}

        .page-header{
          display:flex;align-items:center;justify-content:space-between;
          max-width:720px;margin:0 auto 20px;
        }
        .page-title{font-size:17px;font-weight:700;color:#1A1A1A}
        .page-sub{font-size:12px;color:#6B6570;margin-top:2px}

        .print-btn{
          background:#1A1A1A;color:#FFF8F0;border:none;
          font-size:13px;font-weight:600;
          padding:9px 20px;border-radius:10px;
          cursor:pointer;letter-spacing:0.01em;
          transition:background 0.15s;
        }
        .print-btn:hover{background:#333}

        .cards-grid{
          display:grid;
          grid-template-columns:repeat(2,90mm);
          gap:6mm;
          justify-content:center;
          max-width:720px;
          margin:0 auto;
        }

        /* ── Card ── */
        .qr-card{
          width:90mm;
          border-radius:10px;
          overflow:hidden;
          box-shadow:0 2px 12px rgba(0,0,0,0.18);
          page-break-inside:avoid;
          break-inside:avoid;
        }
        .card-header{
          background:#1A1A1A;
          padding:12px 14px 10px;
          text-align:center;
        }
        .card-restaurant{
          color:#FFF8F0;
          font-size:14px;
          font-weight:800;
          letter-spacing:0.02em;
        }
        .card-tagline{
          color:#9a9098;
          font-size:9px;
          font-weight:500;
          letter-spacing:0.06em;
          text-transform:uppercase;
          margin-top:3px;
        }
        .card-body{
          background:#FFF8F0;
          display:flex;
          flex-direction:column;
          align-items:center;
          padding:14px 14px 10px;
          gap:8px;
        }
        .card-cta{
          font-size:11px;
          font-weight:600;
          color:#3A2E2E;
          letter-spacing:0.02em;
        }
        .card-qr{
          display:block;
          width:160px;
          height:160px;
          border-radius:6px;
        }
        .card-sub{
          font-size:9px;
          color:#9a8f8a;
          letter-spacing:0.03em;
        }
        .card-footer{
          background:#1A1A1A;
          padding:10px 14px;
          display:flex;
          align-items:center;
          justify-content:space-between;
        }
        .card-table-row{
          display:flex;
          align-items:center;
          gap:7px;
        }
        .card-table-num{
          color:#FFF8F0;
          font-size:13px;
          font-weight:700;
          letter-spacing:0.01em;
        }
        .card-brand{
          color:#6B6570;
          font-size:9px;
          font-weight:500;
          letter-spacing:0.05em;
          text-transform:uppercase;
        }

        /* ── Print ── */
        @media print{
          body{background:#E8E0D8;padding:0}
          .page-header{display:none}
          .cards-grid{
            gap:6mm;
            margin:0 auto;
          }
          .qr-card{box-shadow:none}
          @page{size:A4;margin:8mm}
        }
      `}</style>

      <div className="page-header">
        <div>
          <p className="page-title">{name} — QR Cards</p>
          <p className="page-sub">{tables.length} table{tables.length !== 1 ? 's' : ''} · Print on A4, cut along borders</p>
        </div>
        <button className="print-btn" onClick={() => window.print()}>
          Print Cards
        </button>
      </div>

      <div className="cards-grid">
        {tables.map(t => (
          <QrCard key={t} slug={slug} name={name} tagline={tagline} table={t} />
        ))}
      </div>
    </>
  );
}

export default function QrCardsPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#E8E0D8', color: '#1A1A1A', fontSize: '14px' }}>
        Loading…
      </div>
    }>
      <QrCardsInner />
    </Suspense>
  );
}
