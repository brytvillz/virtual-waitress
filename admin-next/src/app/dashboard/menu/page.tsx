'use client';

import { useEffect, useState, useCallback } from 'react';
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
type ItemModalState = { open: true; item: MenuItem | null; categoryId: string } | { open: false };

export default function MenuPage() {
  const restaurant = useRestaurant();
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [applyingTemplate, setApplyingTemplate] = useState(false);
  const [categoryModal, setCategoryModal] = useState<CategoryModalState>({ open: false });
  const [itemModal, setItemModal] = useState<ItemModalState>({ open: false });

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
      if (restaurant.plan === 'free' && items.length >= 20) {
        throw new Error('Free plan is limited to 20 menu items. Upgrade to Pro for unlimited items.');
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

  if (!restaurant) return null;

  return (
    <div className="p-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-[#F0EDE8] text-2xl font-bold tracking-tight">Menu Editor</h1>
          <p className="text-[#6B6570] text-sm mt-1">{categories.length} categories · {items.length} items</p>
        </div>
        {categories.length > 0 && (
          <button
            onClick={() => setCategoryModal({ open: true, category: null })}
            className="bg-[#C41E3A] hover:bg-[#a01830] text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors"
          >
            + Add category
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-[#6B6570] text-sm">
          <span className="w-4 h-4 border-2 border-[#6B6570] border-t-transparent rounded-full animate-spin" />
          Loading menu…
        </div>
      ) : categories.length === 0 ? (
        /* Empty state */
        <div className="bg-[#161616] border border-white/[0.06] rounded-2xl p-12 text-center">
          <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-[#1f1f1f] flex items-center justify-center">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#4a4a4a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/></svg>
          </div>
          <h2 className="text-[#F0EDE8] text-lg font-semibold mb-2">Your menu is empty</h2>
          <p className="text-[#6B6570] text-sm mb-8 max-w-sm mx-auto">
            Start from scratch or use our ready-made Nigerian restaurant template — 6 categories and 34 items, ready to customise.
          </p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={applyTemplate}
              disabled={applyingTemplate}
              className="bg-[#C41E3A] hover:bg-[#a01830] disabled:opacity-50 text-white text-sm font-semibold px-5 py-3 rounded-xl transition-colors"
            >
              {applyingTemplate ? 'Applying…' : 'Use Nigerian Restaurant Template'}
            </button>
            <button
              onClick={() => setCategoryModal({ open: true, category: null })}
              className="border border-white/[0.1] text-[#9a9098] hover:text-[#F0EDE8] hover:bg-white/[0.04] text-sm font-medium px-5 py-3 rounded-xl transition-colors"
            >
              + Build from Scratch
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
                <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.05]">
                  <span className="text-[#F0EDE8] font-semibold">
                    {cat.emoji && <span className="mr-2">{cat.emoji}</span>}
                    {cat.name}
                  </span>
                  <div className="flex gap-2">
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
                    <div key={item.id} className="flex items-center gap-4 px-5 py-3">
                      {item.image_url ? (
                        <img src={item.image_url} alt={item.name} className="w-10 h-10 rounded-lg object-cover shrink-0" />
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-[#1f1f1f] flex items-center justify-center shrink-0">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4a4a4a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/></svg>
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-[#F0EDE8] text-sm font-medium truncate">
                          {item.name}
                          {!item.available && <span className="ml-2 text-[#ff6b6b] text-xs font-normal">Sold out</span>}
                        </p>
                        <p className="text-[#6B6570] text-xs">{fmt(item.price)}</p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <button
                          onClick={() => toggleAvailable(item, !item.available)}
                          className={`relative w-9 h-5 rounded-full transition-colors ${item.available ? 'bg-[#C41E3A]' : 'bg-[#333]'}`}
                          title={item.available ? 'Mark as sold out' : 'Mark as available'}
                        >
                          <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${item.available ? 'translate-x-4' : 'translate-x-0.5'}`} />
                        </button>
                        <button
                          onClick={() => setItemModal({ open: true, item, categoryId: cat.id })}
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
                  ))}
                </div>

                <div className="px-5 py-3 border-t border-white/[0.05]">
                  <button
                    onClick={() => setItemModal({ open: true, item: null, categoryId: cat.id })}
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

      {categoryModal.open && (
        <CategoryModal
          category={categoryModal.category}
          onSave={saveCategory}
          onClose={() => setCategoryModal({ open: false })}
        />
      )}
      {itemModal.open && (
        <ItemModal
          item={itemModal.item}
          categoryId={itemModal.categoryId}
          onSave={saveItem}
          onClose={() => setItemModal({ open: false })}
        />
      )}
    </div>
  );
}
