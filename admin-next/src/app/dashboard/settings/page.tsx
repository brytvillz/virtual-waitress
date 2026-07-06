'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRestaurant } from '@/components/DashboardShell';

type RestaurantSettings = {
  name: string;
  tagline: string;
  whatsapp: string;
  accent_color: string;
  max_tables_per_waiter: number;
  menu_layout: string;
};

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

function StatusMsg({ status, errorText }: { status: SaveStatus; errorText: string }) {
  if (status === 'idle') return null;
  if (status === 'saving') return <span className="text-[#6B6570] text-sm">Saving…</span>;
  if (status === 'error') return <span className="text-[#ff6b6b] text-sm">{errorText}</span>;
  return <span className="text-emerald-400 text-sm">Saved!</span>;
}

export default function SettingsPage() {
  const restaurant = useRestaurant();

  // Restaurant settings state
  const [settings, setSettings] = useState<RestaurantSettings>({
    name: '', tagline: '', whatsapp: '',
    accent_color: '#C41E3A', max_tables_per_waiter: 3, menu_layout: 'magazine',
  });
  const [restStatus, setRestStatus] = useState<SaveStatus>('idle');
  const [restError, setRestError] = useState('');

  // Account state
  const [userEmail, setUserEmail] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [accountStatus, setAccountStatus] = useState<SaveStatus>('idle');
  const [accountMsg, setAccountMsg] = useState('');
  const [accountIsError, setAccountIsError] = useState(false);

  const load = useCallback(async (restaurantId: string) => {
    const supabase = createClient();
    const [{ data }, { data: { user } }] = await Promise.all([
      supabase
        .from('restaurants')
        .select('name, tagline, whatsapp, accent_color, max_tables_per_waiter, menu_layout')
        .eq('id', restaurantId)
        .single(),
      supabase.auth.getUser(),
    ]);

    if (data) {
      setSettings({
        name: data.name ?? '',
        tagline: data.tagline ?? '',
        whatsapp: data.whatsapp ?? '',
        accent_color: data.accent_color ?? '#C41E3A',
        max_tables_per_waiter: data.max_tables_per_waiter ?? 3,
        menu_layout: data.menu_layout ?? 'magazine',
      });
    }
    if (user) setUserEmail(user.email ?? '');
  }, []);

  useEffect(() => {
    if (!restaurant) return;
    load(restaurant.id);
  }, [restaurant, load]);

  async function handleSaveRestaurant(e: React.FormEvent) {
    e.preventDefault();
    if (!restaurant) return;
    setRestStatus('saving');
    setRestError('');

    const supabase = createClient();
    const { error } = await supabase.from('restaurants').update({
      name: settings.name,
      tagline: settings.tagline,
      whatsapp: settings.whatsapp,
      accent_color: settings.accent_color,
      max_tables_per_waiter: settings.max_tables_per_waiter,
      menu_layout: settings.menu_layout,
    }).eq('id', restaurant.id);

    if (error) {
      setRestError('Failed to save — please try again.');
      setRestStatus('error');
    } else {
      setRestStatus('saved');
      setTimeout(() => setRestStatus('idle'), 3000);
    }
  }

  async function handleSaveAccount(e: React.FormEvent) {
    e.preventDefault();
    setAccountMsg('');
    setAccountIsError(false);

    if (!newEmail && !newPassword) {
      setAccountMsg('Enter a new email or password to update.');
      setAccountIsError(true);
      return;
    }
    if (newPassword && newPassword.length < 8) {
      setAccountMsg('Password must be at least 8 characters.');
      setAccountIsError(true);
      return;
    }
    if (newPassword && newPassword !== confirmPassword) {
      setAccountMsg('Passwords do not match.');
      setAccountIsError(true);
      return;
    }

    setAccountStatus('saving');
    const supabase = createClient();
    const updates: { email?: string; password?: string } = {};
    if (newEmail) updates.email = newEmail;
    if (newPassword) updates.password = newPassword;

    const { error } = await supabase.auth.updateUser(updates);
    if (error) {
      setAccountMsg(error.message);
      setAccountIsError(true);
      setAccountStatus('idle');
    } else {
      const msg = newEmail
        ? 'Done! Check your new email address to confirm the change.'
        : 'Password updated successfully.';
      setAccountMsg(msg);
      setAccountIsError(false);
      setAccountStatus('idle');
      if (newEmail) setUserEmail(newEmail + ' (pending confirmation)');
      setNewEmail('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => setAccountMsg(''), 5000);
    }
  }

  if (!restaurant) return null;

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-[#F0EDE8] text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-[#6B6570] text-sm mt-1">Restaurant profile and account</p>
      </div>

      {/* ── Restaurant settings ── */}
      <section className="bg-[#161616] border border-white/[0.06] rounded-2xl p-6 mb-6">
        <h2 className="text-[#F0EDE8] text-sm font-semibold mb-5">Restaurant</h2>

        <form onSubmit={handleSaveRestaurant} className="flex flex-col gap-5">

          <Field label="Restaurant Name">
            <input
              type="text"
              value={settings.name}
              onChange={e => setSettings(s => ({ ...s, name: e.target.value }))}
              placeholder="Nnewi Buka"
              className={inputCls}
            />
          </Field>

          <Field label="Tagline" hint="Shown on your customer menu">
            <input
              type="text"
              value={settings.tagline}
              onChange={e => setSettings(s => ({ ...s, tagline: e.target.value }))}
              placeholder="Authentic Nigerian flavours"
              className={inputCls}
            />
          </Field>

          <Field label="WhatsApp Number" hint="For order notifications (include country code)">
            <input
              type="text"
              value={settings.whatsapp}
              onChange={e => setSettings(s => ({ ...s, whatsapp: e.target.value }))}
              placeholder="+2349023049395"
              className={inputCls}
            />
          </Field>

          <Field label="Accent Colour" hint="Used on your customer-facing menu">
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={settings.accent_color}
                onChange={e => setSettings(s => ({ ...s, accent_color: e.target.value }))}
                className="w-10 h-10 rounded-lg border border-white/[0.08] bg-transparent cursor-pointer"
              />
              <span className="text-[#9a9098] text-sm font-mono">{settings.accent_color}</span>
            </div>
          </Field>

          <Field label="Max Tables Per Waiter" hint="Soft cap — you'll be asked to confirm if exceeded">
            <input
              type="number"
              min={1}
              max={20}
              value={settings.max_tables_per_waiter}
              onChange={e => setSettings(s => ({ ...s, max_tables_per_waiter: Number(e.target.value) }))}
              className={`${inputCls} w-24`}
            />
          </Field>

          <Field label="Menu Layout">
            <div className="flex gap-3">
              {(['magazine', 'classic'] as const).map(layout => (
                <button
                  key={layout}
                  type="button"
                  onClick={() => setSettings(s => ({ ...s, menu_layout: layout }))}
                  className={`px-4 py-2 rounded-xl text-sm font-medium border transition-colors capitalize ${
                    settings.menu_layout === layout
                      ? 'bg-[#C41E3A]/15 border-[#C41E3A]/40 text-[#F0EDE8]'
                      : 'border-white/[0.08] text-[#6B6570] hover:bg-white/[0.04]'
                  }`}
                >
                  {layout}
                </button>
              ))}
            </div>
          </Field>

          <div className="flex items-center gap-4 pt-1">
            <button
              type="submit"
              disabled={restStatus === 'saving'}
              className="bg-[#C41E3A] hover:bg-[#a01830] disabled:opacity-50 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors"
            >
              {restStatus === 'saving' ? 'Saving…' : 'Save changes'}
            </button>
            <StatusMsg status={restStatus} errorText={restError} />
          </div>
        </form>
      </section>

      {/* ── My Account ── */}
      <section className="bg-[#161616] border border-white/[0.06] rounded-2xl p-6">
        <h2 className="text-[#F0EDE8] text-sm font-semibold mb-1">My Account</h2>
        {userEmail && (
          <p className="text-[#6B6570] text-xs mb-5">Signed in as: {userEmail}</p>
        )}

        <form onSubmit={handleSaveAccount} className="flex flex-col gap-4">

          <Field label="New Email" hint="Leave blank to keep current email">
            <input
              type="email"
              value={newEmail}
              onChange={e => setNewEmail(e.target.value)}
              placeholder="new@example.com"
              autoComplete="email"
              className={inputCls}
            />
          </Field>

          <Field label="New Password" hint="Minimum 8 characters — leave blank to keep current">
            <input
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
              className={inputCls}
            />
          </Field>

          <Field label="Confirm Password">
            <input
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
              className={inputCls}
            />
          </Field>

          {accountMsg && (
            <p className={`text-sm px-4 py-3 rounded-xl border ${
              accountIsError
                ? 'text-[#ff6b6b] bg-[#ff6b6b]/10 border-[#ff6b6b]/20'
                : 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
            }`}>
              {accountMsg}
            </p>
          )}

          <div className="pt-1">
            <button
              type="submit"
              disabled={accountStatus === 'saving'}
              className="bg-[#C41E3A] hover:bg-[#a01830] disabled:opacity-50 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors"
            >
              {accountStatus === 'saving' ? 'Updating…' : 'Update account'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

const inputCls = 'bg-[#111] border border-white/[0.08] rounded-xl px-4 py-3 text-[#F0EDE8] text-sm placeholder-[#4a4a4a] outline-none focus:border-[#C41E3A]/50 transition-colors w-full';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[#9a9098] text-xs font-medium uppercase tracking-wider">{label}</span>
      {hint && <span className="text-[#4a4a4a] text-xs -mt-0.5">{hint}</span>}
      {children}
    </label>
  );
}
