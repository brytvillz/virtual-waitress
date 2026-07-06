'use client';

import { useState, useEffect, useRef } from 'react';
import type { MenuItem } from '@/types/menu';

type SavePayload = {
  name: string;
  price: number;
  description: string;
  ada_message: string;
  file: File | null;
  removeImage: boolean;
};

type Props = {
  item: MenuItem | null;
  categoryId: string;
  onSave: (data: SavePayload) => Promise<void>;
  onClose: () => void;
};

export default function ItemModal({ item, categoryId: _categoryId, onSave, onClose }: Props) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const [adaMessage, setAdaMessage] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setName(item?.name ?? '');
    setPrice(item?.price != null ? String(item.price) : '');
    setDescription(item?.description ?? '');
    setAdaMessage(item?.ada_message ?? '');
    setPreview(item?.image_url ?? null);
    setFile(null);
    setRemoveImage(false);
    setError('');
  }, [item]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setRemoveImage(false);
    const reader = new FileReader();
    reader.onload = ev => setPreview(ev.target?.result as string);
    reader.readAsDataURL(f);
  }

  function handleRemoveImage() {
    setFile(null);
    setRemoveImage(true);
    setPreview(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !price) return;
    setSaving(true);
    setError('');
    try {
      await onSave({
        name: name.trim(),
        price: Number(price),
        description: description.trim(),
        ada_message: adaMessage.trim(),
        file,
        removeImage,
      });
      onClose();
    } catch (err) {
      setError((err as Error).message || 'Could not save item.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 overflow-y-auto">
      <div className="bg-[#1a1a1a] border border-white/[0.08] rounded-2xl w-full max-w-md p-6 my-4">
        <h2 className="text-[#F0EDE8] text-lg font-semibold mb-5">
          {item ? 'Edit Item' : 'New Item'}
        </h2>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">

          {/* Image */}
          <div className="flex flex-col gap-2">
            <span className="text-[#9a9098] text-xs font-medium uppercase tracking-wider">Photo</span>
            {preview && (
              <img
                src={preview}
                alt="Preview"
                className="w-24 h-24 rounded-xl object-cover border border-white/[0.08]"
              />
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="px-3 py-2 rounded-xl border border-white/[0.08] text-[#9a9098] text-xs font-medium hover:bg-white/[0.04] transition-colors"
              >
                {preview ? 'Change photo' : 'Add photo'}
              </button>
              {preview && (
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
            <span className="text-[#9a9098] text-xs font-medium uppercase tracking-wider">Item Name *</span>
            <input
              type="text"
              required
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Egusi Soup"
              className="bg-[#111] border border-white/[0.08] rounded-xl px-4 py-3 text-[#F0EDE8] text-sm placeholder-[#4a4a4a] outline-none focus:border-[#C41E3A]/50 transition-colors"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[#9a9098] text-xs font-medium uppercase tracking-wider">Price (₦) *</span>
            <input
              type="number"
              required
              min="0"
              value={price}
              onChange={e => setPrice(e.target.value)}
              placeholder="1500"
              className="bg-[#111] border border-white/[0.08] rounded-xl px-4 py-3 text-[#F0EDE8] text-sm placeholder-[#4a4a4a] outline-none focus:border-[#C41E3A]/50 transition-colors"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[#9a9098] text-xs font-medium uppercase tracking-wider">Description</span>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Short description of the dish"
              rows={2}
              className="bg-[#111] border border-white/[0.08] rounded-xl px-4 py-3 text-[#F0EDE8] text-sm placeholder-[#4a4a4a] outline-none focus:border-[#C41E3A]/50 transition-colors resize-none"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[#9a9098] text-xs font-medium uppercase tracking-wider">Ada Message</span>
            <span className="text-[#4a4a4a] text-xs -mt-1">What Ada says to customers about this item</span>
            <textarea
              value={adaMessage}
              onChange={e => setAdaMessage(e.target.value)}
              placeholder="e.g. Egusi is loaded with protein — great with pounded yam! 💪"
              rows={2}
              className="bg-[#111] border border-white/[0.08] rounded-xl px-4 py-3 text-[#F0EDE8] text-sm placeholder-[#4a4a4a] outline-none focus:border-[#C41E3A]/50 transition-colors resize-none"
            />
          </label>

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
