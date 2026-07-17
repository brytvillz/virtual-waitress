'use client';

export default function RootError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0D0D0D]">
      <div className="text-center max-w-sm px-6">
        <p className="text-[#F0EDE8] text-lg font-semibold mb-2">Something went wrong</p>
        <p className="text-[#6B6570] text-sm mb-6">An unexpected error occurred. Try refreshing the page.</p>
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
