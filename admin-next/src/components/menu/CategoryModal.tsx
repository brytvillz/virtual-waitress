'use client';

import { useState, useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { cropAndResize } from '@/lib/image';
import type { Category } from '@/types/menu';

// Category photos are always 3:2 at 1200×800.
const CROP_OUT_W = 1200;
const CROP_OUT_H = 800;

type SavePayload = {
  name: string;
  emoji: string;
  ada_message: string;
  file: File | null;
  removeImage: boolean;
};

type Props = {
  category: Category | null;
  restaurantName: string;
  onSave: (data: SavePayload) => Promise<void>;
  onClose: () => void;
};

export default function CategoryModal({ category, restaurantName, onSave, onClose }: Props) {
  const [name, setName]           = useState('');
  const [emoji, setEmoji]         = useState('');
  const [adaMessage, setAdaMessage] = useState('');
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError]   = useState('');

  // Committed photo state
  const [croppedFile, setCroppedFile]       = useState<File | null>(null);
  const [croppedPreview, setCroppedPreview] = useState<string | null>(null);
  const [removeImage, setRemoveImage]       = useState(false);

  // Crop phase
  const [cropPhase, setCropPhase] = useState<'idle' | 'cropping'>('idle');
  const [rawFile, setRawFile]     = useState<File | null>(null);
  const [rawUrl, setRawUrl]       = useState('');
  const [imgLoaded, setImgLoaded] = useState(false);
  const [naturalW, setNaturalW]   = useState(0);
  const [naturalH, setNaturalH]   = useState(0);
  const [displayW, setDisplayW]   = useState(0);
  const [displayH, setDisplayH]   = useState(0);
  const [offsetX, setOffsetX]     = useState(0);
  const [offsetY, setOffsetY]     = useState(0);
  const [cropping, setCropping]   = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef       = useRef<HTMLImageElement>(null);
  const dragRef      = useRef<{ sx: number; sy: number; sox: number; soy: number } | null>(null);
  const fileRef      = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setName(category?.name ?? '');
    setEmoji(category?.emoji ?? '');
    setAdaMessage(category?.ada_message ?? '');
    setCroppedFile(null);
    setCroppedPreview(category?.image_url ?? null);
    setRemoveImage(false);
    setCropPhase('idle');
    setError('');
    setGenError('');
  }, [category]);

  // Revoke raw URL on unmount or when it changes
  useEffect(() => {
    return () => { if (rawUrl) URL.revokeObjectURL(rawUrl); };
  }, [rawUrl]);

  // ── File selection ────────────────────────────────────────────────────────

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (rawUrl) URL.revokeObjectURL(rawUrl);
    const url = URL.createObjectURL(f);
    setRawFile(f);
    setRawUrl(url);
    setImgLoaded(false);
    setNaturalW(0);
    setNaturalH(0);
    setDisplayW(0);
    setDisplayH(0);
    setOffsetX(0);
    setOffsetY(0);
    setCropPhase('cropping');
    if (fileRef.current) fileRef.current.value = '';
  }

  // ── Image load — compute cover-fit scale and center ──────────────────────

  function handleImgLoad() {
    const img = imgRef.current;
    const cont = containerRef.current;
    if (!img || !cont) return;
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    const cw = cont.clientWidth;
    const ch = cont.clientHeight;
    const scale = Math.max(cw / nw, ch / nh);
    const dw = Math.round(nw * scale);
    const dh = Math.round(nh * scale);
    setNaturalW(nw);
    setNaturalH(nh);
    setDisplayW(dw);
    setDisplayH(dh);
    setOffsetX(Math.round(-(dw - cw) / 2));
    setOffsetY(Math.round(-(dh - ch) / 2));
    setImgLoaded(true);
  }

  // ── Drag to reposition ───────────────────────────────────────────────────

  function clamp(ox: number, oy: number): { x: number; y: number } {
    const cont = containerRef.current;
    if (!cont || !displayW || !displayH) return { x: ox, y: oy };
    const cw = cont.clientWidth;
    const ch = cont.clientHeight;
    return {
      x: Math.min(0, Math.max(-(displayW - cw), ox)),
      y: Math.min(0, Math.max(-(displayH - ch), oy)),
    };
  }

  function onMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    dragRef.current = { sx: e.clientX, sy: e.clientY, sox: offsetX, soy: offsetY };
  }

  function onMouseMove(e: React.MouseEvent) {
    if (!dragRef.current) return;
    const { x, y } = clamp(
      dragRef.current.sox + (e.clientX - dragRef.current.sx),
      dragRef.current.soy + (e.clientY - dragRef.current.sy),
    );
    setOffsetX(x);
    setOffsetY(y);
  }

  function onMouseUp() { dragRef.current = null; }

  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    dragRef.current = { sx: t.clientX, sy: t.clientY, sox: offsetX, soy: offsetY };
  }

  function onTouchMove(e: React.TouchEvent) {
    if (!dragRef.current) return;
    const t = e.touches[0];
    const { x, y } = clamp(
      dragRef.current.sox + (t.clientX - dragRef.current.sx),
      dragRef.current.soy + (t.clientY - dragRef.current.sy),
    );
    setOffsetX(x);
    setOffsetY(y);
  }

  function onTouchEnd() { dragRef.current = null; }

  // ── Apply crop ───────────────────────────────────────────────────────────

  async function applyCrop() {
    if (!rawFile || !containerRef.current || !naturalW || !displayW) return;
    setCropping(true);
    try {
      const cont = containerRef.current;
      const scale = displayW / naturalW;
      const srcX = Math.max(0, Math.round(-offsetX / scale));
      const srcY = Math.max(0, Math.round(-offsetY / scale));
      const srcW = Math.min(naturalW - srcX, Math.round(cont.clientWidth / scale));
      const srcH = Math.min(naturalH - srcY, Math.round(cont.clientHeight / scale));
      const file = await cropAndResize(rawFile, srcX, srcY, srcW, srcH, CROP_OUT_W, CROP_OUT_H);
      const preview = URL.createObjectURL(file);
      // Revoke previous cropped preview if it was a blob URL
      if (croppedPreview && croppedPreview.startsWith('blob:')) URL.revokeObjectURL(croppedPreview);
      setCroppedFile(file);
      setCroppedPreview(preview);
      setRemoveImage(false);
      setCropPhase('idle');
      URL.revokeObjectURL(rawUrl);
      setRawUrl('');
      setRawFile(null);
    } finally {
      setCropping(false);
    }
  }

  function cancelCrop() {
    URL.revokeObjectURL(rawUrl);
    setRawUrl('');
    setRawFile(null);
    setCropPhase('idle');
  }

  function handleRemoveImage() {
    if (croppedPreview && croppedPreview.startsWith('blob:')) URL.revokeObjectURL(croppedPreview);
    setCroppedFile(null);
    setCroppedPreview(null);
    setRemoveImage(true);
  }

  // ── AI generate ──────────────────────────────────────────────────────────

  async function handleGenerateAda() {
    const catName = name.trim();
    if (!catName) { setGenError('Enter the category name first, then generate.'); return; }
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

  // ── Submit ───────────────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError('');
    try {
      await onSave({ name: name.trim(), emoji: emoji.trim(), ada_message: adaMessage.trim(), file: croppedFile, removeImage });
      onClose();
    } catch (err) {
      setError((err as Error).message || 'Could not save category.');
    } finally {
      setSaving(false);
    }
  }

  // ── Crop phase UI ────────────────────────────────────────────────────────

  if (cropPhase === 'cropping') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 overflow-y-auto">
        <div className="bg-[#1a1a1a] border border-white/[0.08] rounded-2xl w-full max-w-md p-5 my-4">
          <h2 className="text-[#F0EDE8] text-base font-semibold mb-1">Crop photo</h2>
          <p className="text-[#6B6570] text-xs mb-3">Drag to position · 3:2</p>

          <div
            ref={containerRef}
            style={{
              width: '100%', aspectRatio: '3 / 2',
              overflow: 'hidden', borderRadius: 10,
              border: '1px solid #333', position: 'relative',
              cursor: dragRef.current ? 'grabbing' : 'grab',
              userSelect: 'none', background: '#111',
            }}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
          >
            {/* Hidden img used only to trigger onLoad and read natural dimensions */}
            <img
              ref={imgRef}
              src={rawUrl}
              onLoad={handleImgLoad}
              alt=""
              style={{ display: 'none' }}
            />
            {/* Displayed img — shown only after dimensions are known */}
            {imgLoaded && rawUrl && (
              <img
                src={rawUrl}
                alt=""
                draggable={false}
                style={{
                  position: 'absolute',
                  left: offsetX,
                  top: offsetY,
                  width: displayW,
                  height: displayH,
                  maxWidth: 'none',
                  userSelect: 'none',
                  pointerEvents: 'none',
                }}
              />
            )}
            {!imgLoaded && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ color: '#555', fontSize: 13 }}>Loading…</span>
              </div>
            )}
          </div>

          <div className="flex gap-3 mt-4">
            <button
              type="button"
              onClick={cancelCrop}
              className="flex-1 py-2.5 rounded-xl border border-white/[0.08] text-[#9a9098] text-sm font-medium hover:bg-white/[0.04] transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={applyCrop}
              disabled={cropping || !imgLoaded}
              className="flex-1 py-2.5 rounded-xl bg-[#C41E3A] hover:bg-[#a01830] disabled:opacity-50 text-white text-sm font-semibold transition-colors"
            >
              {cropping ? 'Cropping…' : 'Use this crop'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Main form ────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 overflow-y-auto">
      <div className="bg-[#1a1a1a] border border-white/[0.08] rounded-2xl w-full max-w-md p-6 my-4">
        <h2 className="text-[#F0EDE8] text-lg font-semibold mb-5">
          {category ? 'Edit Category' : 'New Category'}
        </h2>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">

          {/* Photo */}
          <div className="flex flex-col gap-2">
            <span className="text-[#9a9098] text-xs font-medium uppercase tracking-wider">Photo</span>
            {croppedPreview && (
              <img
                src={croppedPreview}
                alt="Category preview"
                style={{ width: '100%', aspectRatio: '3 / 2', objectFit: 'cover', borderRadius: 10, border: '1px solid #252525' }}
              />
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="px-3 py-2 rounded-xl border border-white/[0.08] text-[#9a9098] text-xs font-medium hover:bg-white/[0.04] transition-colors"
              >
                {croppedPreview ? 'Change photo' : 'Add photo'}
              </button>
              {croppedPreview && (
                <button
                  type="button"
                  onClick={handleRemoveImage}
                  className="px-3 py-2 rounded-xl border border-[#ff6b6b]/20 text-[#ff6b6b] text-xs font-medium hover:bg-[#ff6b6b]/10 transition-colors"
                >
                  Remove
                </button>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>

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
