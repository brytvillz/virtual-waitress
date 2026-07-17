'use client';

export default function SlugError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div style={{ minHeight: '100svh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0d0d0d', padding: '1.5rem' }}>
      <div style={{ textAlign: 'center', maxWidth: '20rem' }}>
        <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>🍽️</div>
        <p style={{ color: '#f0ede8', fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.5rem' }}>Something went wrong</p>
        <p style={{ color: '#6b6570', fontSize: '0.875rem', marginBottom: '1.5rem' }}>We couldn&apos;t load this page. Tap below to try again.</p>
        <button
          onClick={reset}
          style={{ background: '#C41E3A', color: '#fff', border: 'none', borderRadius: '0.75rem', padding: '0.625rem 1.25rem', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer' }}
        >
          Try again
        </button>
      </div>
    </div>
  );
}
