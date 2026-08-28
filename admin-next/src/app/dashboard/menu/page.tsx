'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRestaurant } from '@/components/DashboardShell';
import CategoryModal from '@/components/menu/CategoryModal';
import ItemModal from '@/components/menu/ItemModal';
import type { Category, MenuItem } from '@/types/menu';

function fmt(price: number) {
  return '₦' + price.toLocaleString('en-NG');
}

function slugify(name: string) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

type CategoryModalState = { open: true; category: Category | null } | { open: false };
type ItemModalState = { open: true; item: MenuItem | null; categoryId: string; categoryName: string } | { open: false };

type ScanCategory = { name: string; items: Array<{ name: string; price: number; description: string }> };
type ScanResult = { categories: ScanCategory[] };

function IconScan() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/>
      <path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/>
      <line x1="3" y1="12" x2="21" y2="12"/>
    </svg>
  );
}

function IconCamera() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/>
      <circle cx="12" cy="13" r="3"/>
    </svg>
  );
}

function IconFood() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/>
      <path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/>
    </svg>
  );
}

function CategoryBadge({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-[#1a0f14] border border-[#C41E3A]/25 text-[#C41E3A] text-xs font-bold shrink-0 select-none">
      {(name || '?').charAt(0).toUpperCase()}
    </span>
  );
}

export default function MenuPage() {
  const restaurant = useRestaurant();
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [applyingTemplate, setApplyingTemplate] = useState(false);
  const [categoryModal, setCategoryModal] = useState<CategoryModalState>({ open: false });
  const [itemModal, setItemModal] = useState<ItemModalState>({ open: false });

  // Scan state
  const [scanOpen, setScanOpen] = useState(false);
  const [scanStep, setScanStep] = useState<'upload' | 'preview' | 'importing'>('upload');
  const [scanFile, setScanFile] = useState<File | null>(null);
  const [scanPreviewUrl, setScanPreviewUrl] = useState('');
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (restaurantId: string) => {
    const supabase = createClient();
    const [{ data: cats }, { data: its }] = await Promise.all([
      supabase.from('menu_categories').select('*').eq('restaurant_id', restaurantId).order('sort_order'),
      supabase.from('menu_items').select('*').eq('restaurant_id', restaurantId).order('sort_order'),
    ]);
    setCategories((cats ?? []) as Category[]);
    setItems((its ?? []) as MenuItem[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!restaurant) return;
    load(restaurant.id);
  }, [restaurant, load]);

  async function applyTemplate() {
    if (!restaurant) return;
    setApplyingTemplate(true);
    const supabase = createClient();
    try {
      const res = await fetch('/data/menu-templates.json');
      const templates = await res.json();
      const template = templates.find((t: { id: string }) => t.id === 'nigerian-restaurant');
      if (!template) throw new Error('Template not found');

      for (let ci = 0; ci < template.categories.length; ci++) {
        const cat = template.categories[ci];
        const slug = slugify(cat.name) + '-' + Date.now().toString(36);
        const { data: catRow } = await supabase
          .from('menu_categories')
          .insert({ restaurant_id: restaurant.id, name: cat.name, slug, emoji: cat.emoji, ada_message: cat.ada_message, sort_order: ci + 1 })
          .select('id')
          .single();
        if (!catRow) continue;

        const itemRows = cat.items.map((item: { name: string; price: number; description: string; ada_message: string }, ii: number) => ({
          restaurant_id: restaurant.id,
          category_id: catRow.id,
          name: item.name,
          price: item.price,
          description: item.description,
          ada_message: item.ada_message,
          available: true,
          sort_order: ii + 1,
        }));
        await supabase.from('menu_items').insert(itemRows);
      }
      await load(restaurant.id);
    } catch {
      alert('Could not apply template. Please try again.');
    } finally {
      setApplyingTemplate(false);
    }
  }

  async function saveCategory(data: { name: string; emoji: string; ada_message: string }) {
    if (!restaurant) return;
    const supabase = createClient();
    if (categoryModal.open && categoryModal.category) {
      const { error } = await supabase.from('menu_categories').update(data).eq('id', categoryModal.category.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase.from('menu_categories').insert({
        ...data,
        restaurant_id: restaurant.id,
        slug: slugify(data.name) + '-' + Date.now().toString(36),
        sort_order: categories.length + 1,
      });
      if (error) throw new Error(error.message);
    }
    await load(restaurant.id);
  }

  async function deleteCategory(cat: Category) {
    if (!confirm(`Delete "${cat.name}" and all its items? This cannot be undone.`)) return;
    const supabase = createClient();
    await supabase.from('menu_categories').delete().eq('id', cat.id);
    await load(restaurant!.id);
  }

  async function saveItem(data: {
    name: string; price: number; description: string; ada_message: string;
    file: File | null; removeImage: boolean;
  }) {
    if (!restaurant || !itemModal.open) return;
    const supabase = createClient();

    const payload: Record<string, unknown> = {
      name: data.name,
      price: data.price,
      description: data.description,
      ada_message: data.ada_message,
    };

    if (data.file) {
      const ext = (data.file.name.split('.').pop() || 'jpg').toLowerCase();
      const itemId = itemModal.item?.id ?? Date.now().toString();
      const path = `${restaurant.id}/${itemId}.${ext}`;
      const { error: uploadError } = await supabase.storage.from('menu-images').upload(path, data.file, { upsert: true });
      if (!uploadError) {
        payload.image_url = supabase.storage.from('menu-images').getPublicUrl(path).data.publicUrl;
      }
    } else if (data.removeImage) {
      payload.image_url = null;
    }

    if (itemModal.item) {
      const { error } = await supabase.from('menu_items').update(payload).eq('id', itemModal.item.id);
      if (error) throw new Error(error.message);
    } else {
      const trialActive = restaurant.trial_ends_at && new Date(restaurant.trial_ends_at) > new Date();
      const isPro = restaurant.plan === 'pro' && restaurant.plan_status === 'active';
      if (!isPro && !trialActive && items.length >= 20) {
        throw new Error('Upgrade to Pro for unlimited menu items — ₦9,900/month.');
      }
      const catItems = items.filter(i => i.category_id === itemModal.categoryId);
      const { error } = await supabase.from('menu_items').insert({
        ...payload,
        restaurant_id: restaurant.id,
        category_id: itemModal.categoryId,
        available: true,
        sort_order: catItems.length + 1,
      });
      if (error) throw new Error(error.message);
    }

    await load(restaurant.id);
  }

  async function deleteItem(item: MenuItem) {
    if (!confirm(`Delete "${item.name}"?`)) return;
    const supabase = createClient();
    await supabase.from('menu_items').delete().eq('id', item.id);
    await load(restaurant!.id);
  }

  async function toggleAvailable(item: MenuItem, available: boolean) {
    const supabase = createClient();
    await supabase.from('menu_items').update({ available }).eq('id', item.id);
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, available } : i));
  }

  // ── Scan paper menu ────────────────────────────────────────────────────────

  function openScan() {
    setScanStep('upload');
    setScanFile(null);
    setScanPreviewUrl('');
    setScanResult(null);
    setScanError('');
    setScanOpen(true);
  }

  function closeScan() {
    setScanOpen(false);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setScanFile(file);
    setScanPreviewUrl(URL.createObjectURL(file));
    setScanError('');
  }

  async function analyseScan() {
    if (!scanFile || !restaurant) return;
    setScanLoading(true);
    setScanError('');
    try {
      const reader = new FileReader();
      const b64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(scanFile);
      });

      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();

      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/scan-menu`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({ image: b64, mimeType: scanFile.type }),
        }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || 'Analysis failed. Try a clearer photo.');
      }

      const result: ScanResult = await res.json();
      if (!result.categories?.length) throw new Error('No menu items found in the image. Try a clearer, well-lit photo.');
      setScanResult(result);
      setScanStep('preview');
    } catch (e) {
      setScanError((e as Error).message || 'Could not analyse image. Please try again.');
    } finally {
      setScanLoading(false);
    }
  }

  async function importScanResult() {
    if (!scanResult || !restaurant) return;
    setScanStep('importing');
    const supabase = createClient();
    try {
      for (let ci = 0; ci < scanResult.categories.length; ci++) {
        const cat = scanResult.categories[ci];
        const slug = slugify(cat.name) + '-' + Date.now().toString(36) + ci;
        const { data: catRow } = await supabase
          .from('menu_categories')
          .insert({
            restaurant_id: restaurant.id,
            name: cat.name,
            slug,
            sort_order: categories.length + ci + 1,
          })
          .select('id')
          .single();
        if (!catRow) continue;

        if (cat.items.length > 0) {
          await supabase.from('menu_items').insert(
            cat.items.map((item, ii) => ({
              restaurant_id: restaurant.id,
              category_id: catRow.id,
              name: item.name,
              price: item.price || 0,
              description: item.description || '',
              available: true,
              sort_order: ii + 1,
            }))
          );
        }
      }
      await load(restaurant.id);
      closeScan();
    } catch {
      setScanError('Import failed. Please try again.');
      setScanStep('preview');
    }
  }

  if (!restaurant) return null;

  const totalItems = scanResult?.categories.reduce((sum, c) => sum + c.items.length, 0) ?? 0;

  return (
    <div className="p-4 sm:p-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-8">
        <div>
          <h1 className="text-[#F0EDE8] text-2xl font-bold tracking-tight">Menu Editor</h1>
          <p className="text-[#6B6570] text-sm mt-1">{categories.length} categories · {items.length} items</p>
        </div>
        {categories.length > 0 && (
          <div className="flex flex-col sm:flex-row gap-2 shrink-0">
            <button
              onClick={openScan}
              className="flex items-center gap-1.5 border border-white/[0.1] text-[#9a9098] hover:text-[#F0EDE8] hover:bg-white/[0.04] text-sm font-medium px-3 py-2 rounded-xl transition-colors"
            >
              <IconScan />
              <span className="hidden sm:inline">Scan paper menu</span>
              <span className="sm:hidden">Scan</span>
            </button>
            <button
              onClick={() => setCategoryModal({ open: true, category: null })}
              className="bg-[#C41E3A] hover:bg-[#a01830] text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors"
            >
              + Category
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-[#6B6570] text-sm">
          <span className="w-4 h-4 border-2 border-[#6B6570] border-t-transparent rounded-full animate-spin" />
          Loading menu…
        </div>
      ) : categories.length === 0 ? (
        /* Empty state */
        <div className="bg-[#161616] border border-white/[0.06] rounded-2xl p-10 text-center">
          <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-[#1f1f1f] flex items-center justify-center text-[#4a4a4a]">
            <IconFood />
          </div>
          <h2 className="text-[#F0EDE8] text-lg font-semibold mb-2">Your menu is empty</h2>
          <p className="text-[#6B6570] text-sm mb-8 max-w-sm mx-auto">
            Start from scratch, use a ready-made template, or scan your existing paper menu.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={applyTemplate}
              disabled={applyingTemplate}
              className="bg-[#C41E3A] hover:bg-[#a01830] disabled:opacity-50 text-white text-sm font-semibold px-5 py-3 rounded-xl transition-colors"
            >
              {applyingTemplate ? 'Applying…' : 'Use Nigerian Restaurant Template'}
            </button>
            <button
              onClick={openScan}
              className="border border-white/[0.1] text-[#9a9098] hover:text-[#F0EDE8] hover:bg-white/[0.04] text-sm font-medium px-5 py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              <IconScan /> Scan paper menu
            </button>
            <button
              onClick={() => setCategoryModal({ open: true, category: null })}
              className="border border-white/[0.1] text-[#9a9098] hover:text-[#F0EDE8] hover:bg-white/[0.04] text-sm font-medium px-5 py-3 rounded-xl transition-colors"
            >
              + Build from scratch
            </button>
          </div>
        </div>
      ) : (
        /* Category list */
        <div className="flex flex-col gap-4">
          {categories.map(cat => {
            const catItems = items.filter(i => i.category_id === cat.id);
            return (
              <div key={cat.id} className="bg-[#161616] border border-white/[0.06] rounded-2xl overflow-hidden">
                {/* Category header */}
                <div className="flex items-center justify-between px-4 sm:px-5 py-3.5 border-b border-white/[0.05]">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <CategoryBadge name={cat.name} />
                    <span className="text-[#F0EDE8] font-semibold text-sm sm:text-base truncate">{cat.name}</span>
                    <span className="text-[#4a4a4a] text-xs shrink-0">{catItems.length}</span>
                  </div>
                  <div className="flex gap-2 ml-3 shrink-0">
                    <button
                      onClick={() => setCategoryModal({ open: true, category: cat })}
                      className="px-3 py-1.5 rounded-lg border border-white/[0.08] text-[#9a9098] text-xs font-medium hover:bg-white/[0.04] transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => deleteCategory(cat)}
                      className="px-3 py-1.5 rounded-lg border border-[#ff6b6b]/20 text-[#ff6b6b] text-xs font-medium hover:bg-[#ff6b6b]/10 transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {/* Items */}
                <div className="divide-y divide-white/[0.04]">
                  {catItems.length === 0 ? (
                    <p className="px-5 py-4 text-[#4a4a4a] text-sm">No items yet</p>
                  ) : catItems.map(item => (
                    <div key={item.id} className="flex gap-3 px-4 sm:px-5 py-3.5">
                      {/* Image */}
                      {item.image_url ? (
                        <img src={item.image_url} alt={item.name} className="w-11 h-11 rounded-lg object-cover shrink-0 mt-0.5" />
                      ) : (
                        <div className="w-11 h-11 rounded-lg bg-[#1f1f1f] flex items-center justify-center shrink-0 mt-0.5 text-[#4a4a4a]">
                          <IconFood />
                        </div>
                      )}

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        {/* Name row */}
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-[#F0EDE8] text-sm font-medium leading-snug flex-1">
                            {item.name}
                            {!item.available && (
                              <span className="ml-2 inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#ff6b6b]/10 text-[#ff6b6b] align-middle">
                                Sold out
                              </span>
                            )}
                          </p>
                          {/* Toggle */}
                          <button
                            onClick={() => toggleAvailable(item, !item.available)}
                            className={`relative flex-shrink-0 w-11 h-6 rounded-full transition-colors duration-200 ${item.available ? 'bg-[#C41E3A]' : 'bg-[#333]'}`}
                            title={item.available ? 'Mark as sold out' : 'Mark as available'}
                            aria-label={item.available ? 'Mark as sold out' : 'Mark as available'}
                          >
                            <span
                              className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${item.available ? 'translate-x-5' : 'translate-x-0'}`}
                            />
                          </button>
                        </div>

                        {/* Price */}
                        <p className="text-[#6B6570] text-xs mt-1">{fmt(item.price)}</p>

                        {/* Actions */}
                        <div className="flex gap-2 mt-2.5">
                          <button
                            onClick={() => setItemModal({ open: true, item, categoryId: cat.id, categoryName: cat.name })}
                            className="px-3 py-1.5 rounded-lg border border-white/[0.08] text-[#9a9098] text-xs font-medium hover:bg-white/[0.04] transition-colors"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => deleteItem(item)}
                            className="px-3 py-1.5 rounded-lg border border-[#ff6b6b]/20 text-[#ff6b6b] text-xs font-medium hover:bg-[#ff6b6b]/10 transition-colors"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="px-4 sm:px-5 py-3 border-t border-white/[0.05]">
                  <button
                    onClick={() => setItemModal({ open: true, item: null, categoryId: cat.id, categoryName: cat.name })}
                    className="text-[#6B6570] hover:text-[#9a9098] text-sm transition-colors"
                  >
                    + Add item to {cat.name}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Modals ── */}
      {categoryModal.open && (
        <CategoryModal
          category={categoryModal.category}
          restaurantName={restaurant.name}
          onSave={saveCategory}
          onClose={() => setCategoryModal({ open: false })}
        />
      )}
      {itemModal.open && (
        <ItemModal
          item={itemModal.item}
          categoryId={itemModal.categoryId}
          categoryName={itemModal.categoryName}
          restaurantName={restaurant.name}
          onSave={saveItem}
          onClose={() => setItemModal({ open: false })}
        />
      )}

      {/* ── Scan paper menu modal ── */}
      {scanOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={closeScan} />
          <div className="relative w-full sm:max-w-lg bg-[#161616] border border-white/[0.08] rounded-t-2xl sm:rounded-2xl overflow-hidden">

            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-[#1a0f14] border border-[#C41E3A]/25 flex items-center justify-center text-[#C41E3A]">
                  <IconScan />
                </div>
                <div>
                  <p className="text-[#F0EDE8] text-sm font-semibold">Scan paper menu</p>
                  <p className="text-[#6B6570] text-xs">AI reads your menu and imports it automatically</p>
                </div>
              </div>
              <button onClick={closeScan} className="w-8 h-8 flex items-center justify-center rounded-lg text-[#6B6570] hover:text-[#F0EDE8] hover:bg-white/[0.06] transition-colors">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            <div className="p-5">
              {/* Step: upload */}
              {scanStep === 'upload' && (
                <div>
                  {scanPreviewUrl ? (
                    <div className="relative mb-4 rounded-xl overflow-hidden bg-[#1f1f1f]">
                      <img src={scanPreviewUrl} alt="Menu preview" className="w-full max-h-56 object-contain" />
                      <button
                        onClick={() => { setScanFile(null); setScanPreviewUrl(''); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                        className="absolute top-2 right-2 w-7 h-7 bg-black/60 rounded-full flex items-center justify-center text-white hover:bg-black/80"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full mb-4 border-2 border-dashed border-white/[0.1] hover:border-[#C41E3A]/40 rounded-xl p-8 flex flex-col items-center gap-3 text-[#6B6570] hover:text-[#9a9098] transition-colors"
                    >
                      <span className="text-[#4a4a4a]"><IconCamera /></span>
                      <span className="text-sm font-medium">Tap to take a photo or upload an image</span>
                      <span className="text-xs text-[#4a4a4a]">Clear, well-lit photo works best</span>
                    </button>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={handleFileSelect}
                  />
                  {scanError && (
                    <p className="text-[#ff6b6b] text-sm mb-4 bg-[#ff6b6b]/10 px-4 py-3 rounded-xl">{scanError}</p>
                  )}
                  <button
                    onClick={analyseScan}
                    disabled={!scanFile || scanLoading}
                    className="w-full bg-[#C41E3A] hover:bg-[#a01830] disabled:opacity-40 text-white text-sm font-semibold py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
                  >
                    {scanLoading ? (
                      <>
                        <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                        Analysing menu…
                      </>
                    ) : 'Analyse menu'}
                  </button>
                </div>
              )}

              {/* Step: preview */}
              {scanStep === 'preview' && scanResult && (
                <div>
                  <div className="mb-4 bg-[#0f1a0f] border border-[#2a5a2a]/40 rounded-xl px-4 py-3">
                    <p className="text-[#6aab6a] text-sm font-medium">
                      Found {scanResult.categories.length} {scanResult.categories.length === 1 ? 'category' : 'categories'} and {totalItems} items
                    </p>
                  </div>
                  <div className="max-h-64 overflow-y-auto flex flex-col gap-3 mb-4">
                    {scanResult.categories.map((cat, ci) => (
                      <div key={ci} className="bg-[#1a1a1a] rounded-xl p-3">
                        <p className="text-[#F0EDE8] text-sm font-semibold mb-2 flex items-center gap-2">
                          <CategoryBadge name={cat.name} />
                          {cat.name}
                        </p>
                        <div className="flex flex-col gap-1.5">
                          {cat.items.map((item, ii) => (
                            <div key={ii} className="flex items-center justify-between gap-2">
                              <span className="text-[#9a9098] text-xs">{item.name}</span>
                              <span className="text-[#6B6570] text-xs shrink-0">{item.price ? fmt(item.price) : '—'}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  {scanError && (
                    <p className="text-[#ff6b6b] text-sm mb-4 bg-[#ff6b6b]/10 px-4 py-3 rounded-xl">{scanError}</p>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setScanStep('upload'); setScanResult(null); setScanError(''); }}
                      className="flex-1 border border-white/[0.1] text-[#9a9098] text-sm font-medium py-2.5 rounded-xl hover:bg-white/[0.04] transition-colors"
                    >
                      Try again
                    </button>
                    <button
                      onClick={importScanResult}
                      className="flex-1 bg-[#C41E3A] hover:bg-[#a01830] text-white text-sm font-semibold py-2.5 rounded-xl transition-colors"
                    >
                      Import {totalItems} items
                    </button>
                  </div>
                </div>
              )}

              {/* Step: importing */}
              {scanStep === 'importing' && (
                <div className="py-8 flex flex-col items-center gap-4">
                  <span className="w-8 h-8 border-2 border-[#C41E3A]/30 border-t-[#C41E3A] rounded-full animate-spin" />
                  <p className="text-[#9a9098] text-sm">Importing your menu…</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
