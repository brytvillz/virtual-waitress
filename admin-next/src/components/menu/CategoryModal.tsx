'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Category } from '@/types/menu';

type Props = {
  category: Category | null;
  restaurantName: string;
  onSave: (data: { name: string; emoji: string; ada_message: string }) => Promise<void>;
  onClose: () => void;
};

export default function CategoryModal({ category, restaurantName, onSave, onClose }: Props) {
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('');
  const [adaMessage, setAdaMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState('');

  useEffect(() => {
    setName(category?.name ?? '');
    setEmoji(category?.emoji ?? '');
    setAdaMessage(category?.ada_message ?? '');
    setError('');
    setGenError('');
  }, [category]);

  async function handleGenerateAda() {
    const catName = name.trim();
    if (!catName) {
      setGenError('Enter the category name first, then generate.');
      return;
    }
    setGenerating(true);
    setGenError('');
    try {
      const supabase = createClient();
      const { data, error: fnError } = await supabase.functions.invoke('claude-ai', {
        body: { action: 'ada-message', category_name: catName, restaurant_name: restaurantName },
      });
      if (fnError || !data) throw new Error(fnError?.message || 'AI request failed');
      if (data.error) throw new Error(data.error);
      if (data.message) setAdaMessage(data.message);
    } catch (err) {
      setGenError((err as Error).message || 'Could not generate message. Try again.');
    } finally {
      setGenerating(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError('');
    try {
      await onSave({ name: name.trim(), emoji: emoji.trim(), ada_message: adaMessage.trim() });
      onClose();
    } catch (err) {
      setError((err as Error).message || 'Could not save category.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
      <div className="bg-[#1a1a1a] border border-white/[0.08] rounded-2xl w-full max-w-md p-6">
        <h2 className="text-[#F0EDE8] text-lg font-semibold mb-5">
          {category ? 'Edit Category' : 'New Category'}
        </h2>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-[#9a9098] text-xs font-medium uppercase tracking-wider">Name *</span>
            <input
              type="text"
              required
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Soups"
              className="bg-[#111] border border-white/[0.08] rounded-xl px-4 py-3 text-[#F0EDE8] text-sm placeholder-[#4a4a4a] outline-none focus:border-[#C41E3A]/50 transition-colors"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[#9a9098] text-xs font-medium uppercase tracking-wider">Emoji</span>
            <input
              type="text"
              value={emoji}
              onChange={e => setEmoji(e.target.value)}
              placeholder="e.g. 🥣"
              className="bg-[#111] border border-white/[0.08] rounded-xl px-4 py-3 text-[#F0EDE8] text-sm placeholder-[#4a4a4a] outline-none focus:border-[#C41E3A]/50 transition-colors w-24"
            />
          </label>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[#9a9098] text-xs font-medium uppercase tracking-wider">Ada Message</span>
                <p className="text-[#4a4a4a] text-xs mt-0.5">Message shown to customers when they open this category</p>
              </div>
              <button
                type="button"
                onClick={handleGenerateAda}
                disabled={generating}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[#C41E3A]/30 bg-[#C41E3A]/5 text-[#C41E3A] text-xs font-medium hover:bg-[#C41E3A]/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
              >
                {generating ? (
                  <>
                    <span className="w-3 h-3 border border-[#C41E3A] border-t-transparent rounded-full animate-spin" />
                    Writing…
                  </>
                ) : (
                  <>✨ Generate</>
                )}
              </button>
            </div>

            {genError && (
              <p className="text-amber-400 text-xs bg-amber-400/10 border border-amber-400/20 rounded-xl px-3 py-2">
                {genError}
              </p>
            )}

            <textarea
              value={adaMessage}
              onChange={e => setAdaMessage(e.target.value)}
              placeholder="e.g. Our soups are made fresh every morning"
              rows={3}
              className="bg-[#111] border border-white/[0.08] rounded-xl px-4 py-3 text-[#F0EDE8] text-sm placeholder-[#4a4a4a] outline-none focus:border-[#C41E3A]/50 transition-colors resize-none"
            />
          </div>

          {error && (
            <p className="text-[#ff6b6b] text-sm bg-[#ff6b6b]/10 border border-[#ff6b6b]/20 rounded-xl px-4 py-3">
              {error}
            </p>
          )}

          <div className="flex gap-3 mt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 rounded-xl border border-white/[0.08] text-[#9a9098] text-sm font-medium hover:bg-white/[0.04] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-3 rounded-xl bg-[#C41E3A] hover:bg-[#a01830] disabled:opacity-50 text-white text-sm font-semibold transition-colors"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
