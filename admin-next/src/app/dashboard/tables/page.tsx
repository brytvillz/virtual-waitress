'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRestaurant } from '@/components/DashboardShell';

const MAX_TABLES_PER_WAITER = 3;

type Table = { id: string; table_number: number; label: string; restaurant_id: string };
type Waiter = { id: string; name: string };
type Assignment = { table_id: string; waiter_id: string; waiter_name: string };

function todayDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function TablesPage() {
  const restaurant = useRestaurant();
  const [tables, setTables] = useState<Table[]>([]);
  const [waiters, setWaiters] = useState<Waiter[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [tableNumber, setTableNumber] = useState('');
  const [tableLabel, setTableLabel] = useState('');
  const [addError, setAddError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (restaurantId: string) => {
    const supabase = createClient();
    const today = todayDate();

    const [{ data: tbls }, { data: asgn }, { data: wtr }] = await Promise.all([
      supabase.from('tables').select('*').eq('restaurant_id', restaurantId).order('table_number'),
      supabase.from('shift_assignments')
        .select('table_id, waiter_id, staff(name)')
        .eq('restaurant_id', restaurantId)
        .eq('assigned_date', today),
      supabase.from('staff').select('id, name').eq('restaurant_id', restaurantId).eq('role', 'waiter').order('name'),
    ]);

    setTables((tbls ?? []) as Table[]);
    setWaiters((wtr ?? []) as Waiter[]);
    setAssignments(
      (asgn ?? []).map((a: { table_id: string; waiter_id: string; staff: { name: string }[] | null }) => ({
        table_id: a.table_id,
        waiter_id: a.waiter_id,
        waiter_name: Array.isArray(a.staff) ? (a.staff[0]?.name ?? 'Unknown') : 'Unknown',
      }))
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!restaurant) return;
    load(restaurant.id);
  }, [restaurant, load]);

  async function handleAssign(tableId: string, waiterId: string) {
    if (!restaurant) return;
    const supabase = createClient();
    const today = todayDate();

    if (!waiterId) {
      await supabase.from('shift_assignments')
        .delete()
        .eq('table_id', tableId)
        .eq('assigned_date', today)
        .eq('restaurant_id', restaurant.id);
      await load(restaurant.id);
      return;
    }

    // Soft cap check
    const waiterCount = assignments.filter(a => a.waiter_id === waiterId).length;
    if (waiterCount >= MAX_TABLES_PER_WAITER) {
      const proceed = confirm(
        `This waiter already has ${waiterCount} table${waiterCount !== 1 ? 's' : ''} (cap is ${MAX_TABLES_PER_WAITER}). Assign anyway?`
      );
      if (!proceed) return;
    }

    const { error } = await supabase.from('shift_assignments').upsert({
      restaurant_id: restaurant.id,
      waiter_id: waiterId,
      table_id: tableId,
      assigned_date: today,
    }, { onConflict: 'restaurant_id,table_id,assigned_date' });

    if (error) { alert('Could not save assignment.'); return; }
    await load(restaurant.id);
  }

  async function handleDelete(table: Table) {
    if (!confirm(`Delete Table ${table.table_number}? Assignments for this table will also be removed.`)) return;
    const supabase = createClient();
    const { error } = await supabase.from('tables').delete().eq('id', table.id);
    if (error) { alert('Could not delete table.'); return; }
    await load(restaurant!.id);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!restaurant) return;
    const num = parseInt(tableNumber);
    if (!num || num < 1) { setAddError('Enter a valid table number.'); return; }
    setSaving(true);
    setAddError('');
    const supabase = createClient();
    const { error } = await supabase.from('tables').insert({
      restaurant_id: restaurant.id,
      table_number: num,
      label: tableLabel.trim() || `Table ${num}`,
    });
    setSaving(false);
    if (error) { setAddError('Could not add table — that number may already exist.'); return; }
    setModalOpen(false);
    setTableNumber('');
    setTableLabel('');
    await load(restaurant.id);
  }

  if (!restaurant) return null;

  const assignmentMap = Object.fromEntries(assignments.map(a => [a.table_id, a]));

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-[#F0EDE8] text-2xl font-bold tracking-tight">Tables</h1>
          <p className="text-[#6B6570] text-sm mt-1">
            {tables.length} table{tables.length !== 1 ? 's' : ''} · assign waiters for today&apos;s shift
          </p>
        </div>
        <button
          onClick={() => { setModalOpen(true); setTableNumber(''); setTableLabel(''); setAddError(''); }}
          className="bg-[#C41E3A] hover:bg-[#a01830] text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors"
        >
          + Add table
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-[#6B6570] text-sm">
          <span className="w-4 h-4 border-2 border-[#6B6570] border-t-transparent rounded-full animate-spin" />
          Loading tables…
        </div>
      ) : tables.length === 0 ? (
        <div className="bg-[#161616] border border-white/[0.06] rounded-2xl p-12 text-center">
          <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-[#1f1f1f] flex items-center justify-center">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#4a4a4a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="9" x2="9" y2="21"/></svg>
          </div>
          <h2 className="text-[#F0EDE8] text-lg font-semibold mb-2">No tables yet</h2>
          <p className="text-[#6B6570] text-sm mb-6">Add your tables and assign waiters for each shift.</p>
          <button
            onClick={() => setModalOpen(true)}
            className="bg-[#C41E3A] hover:bg-[#a01830] text-white text-sm font-semibold px-5 py-3 rounded-xl transition-colors"
          >
            + Add your first table
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {tables.map(table => {
            const assignment = assignmentMap[table.id];
            const isAssigned = !!assignment;

            return (
              <div
                key={table.id}
                className={`bg-[#161616] border rounded-2xl p-4 flex flex-col gap-3 transition-colors ${
                  isAssigned ? 'border-[#C41E3A]/30' : 'border-white/[0.06]'
                }`}
              >
                {/* Number + waiter badge */}
                <div className="flex items-start justify-between">
                  <span className="text-[#F0EDE8] text-3xl font-bold tracking-tight">
                    {table.table_number}
                  </span>
                  {isAssigned && (
                    <span className="bg-[#C41E3A]/15 text-[#C41E3A] text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider">
                      {assignment.waiter_name.split(' ')[0]}
                    </span>
                  )}
                </div>

                {/* Label */}
                <p className="text-[#6B6570] text-xs">{table.label}</p>

                {/* Waiter assignment dropdown */}
                <select
                  value={assignment?.waiter_id ?? ''}
                  onChange={e => handleAssign(table.id, e.target.value)}
                  className="bg-[#111] border border-white/[0.08] rounded-lg px-3 py-2 text-[#9a9098] text-xs outline-none focus:border-[#C41E3A]/50 transition-colors w-full"
                >
                  <option value="">Unassigned</option>
                  {waiters.map(w => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>

                {/* Delete */}
                <button
                  onClick={() => handleDelete(table)}
                  className="text-[#4a4a4a] hover:text-[#ff6b6b] text-xs font-medium transition-colors text-left"
                >
                  Delete
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Table Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
          <div className="bg-[#1a1a1a] border border-white/[0.08] rounded-2xl w-full max-w-sm p-6">
            <h2 className="text-[#F0EDE8] text-lg font-semibold mb-5">Add Table</h2>

            <form onSubmit={handleAdd} className="flex flex-col gap-4">
              <label className="flex flex-col gap-1.5">
                <span className="text-[#9a9098] text-xs font-medium uppercase tracking-wider">Table Number *</span>
                <input
                  type="number"
                  required
                  min="1"
                  value={tableNumber}
                  onChange={e => setTableNumber(e.target.value)}
                  placeholder="1"
                  autoFocus
                  className="bg-[#111] border border-white/[0.08] rounded-xl px-4 py-3 text-[#F0EDE8] text-sm placeholder-[#4a4a4a] outline-none focus:border-[#C41E3A]/50 transition-colors"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-[#9a9098] text-xs font-medium uppercase tracking-wider">Label</span>
                <span className="text-[#4a4a4a] text-xs -mt-1">Optional — defaults to &quot;Table N&quot;</span>
                <input
                  type="text"
                  value={tableLabel}
                  onChange={e => setTableLabel(e.target.value)}
                  placeholder="e.g. Outdoor Table 1"
                  className="bg-[#111] border border-white/[0.08] rounded-xl px-4 py-3 text-[#F0EDE8] text-sm placeholder-[#4a4a4a] outline-none focus:border-[#C41E3A]/50 transition-colors"
                />
              </label>

              {addError && (
                <p className="text-[#ff6b6b] text-sm bg-[#ff6b6b]/10 border border-[#ff6b6b]/20 rounded-xl px-4 py-3">
                  {addError}
                </p>
              )}

              <div className="flex gap-3 mt-1">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="flex-1 py-3 rounded-xl border border-white/[0.08] text-[#9a9098] text-sm font-medium hover:bg-white/[0.04] transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 py-3 rounded-xl bg-[#C41E3A] hover:bg-[#a01830] disabled:opacity-50 text-white text-sm font-semibold transition-colors"
                >
                  {saving ? 'Adding…' : 'Add Table'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
