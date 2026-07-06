'use client';

import { useState } from 'react';

export default function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <button
      onClick={copy}
      className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
        copied
          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
          : 'bg-white/[0.05] text-[#9a9098] border border-white/[0.08] hover:bg-white/[0.08]'
      }`}
    >
      {copied ? 'Copied!' : label}
    </button>
  );
}
