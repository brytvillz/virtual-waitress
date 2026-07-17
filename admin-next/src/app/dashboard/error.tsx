'use client';

export default function DashboardError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="p-8 max-w-4xl mx-auto flex items-center justify-center min-h-[60vh]">
      <div className="text-center">
        <p className="text-[#F0EDE8] text-lg font-semibold mb-2">Something went wrong</p>
        <p className="text-[#6B6570] text-sm mb-6">This page failed to load. Your data is safe — try again.</p>
        <button
          onClick={reset}
          className="bg-[#C41E3A] hover:bg-[#a01830] text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
