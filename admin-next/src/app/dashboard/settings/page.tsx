'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useRestaurant } from '@/components/DashboardShell';

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  );
}

type RestaurantSettings = {
  name: string;
  tagline: string;
  whatsapp: string;
  accent_color: string;
  max_tables_per_waiter: number;
  menu_layout: string;
  menu_theme: string;
};

const THEMES = [
  { id: 'nightlife-dark',   name: 'Nightlife Dark',   desc: 'Default',           bg: '#0A0208', accent: '#C41E3A', text: '#F0EDE8' },
  { id: 'cafe-light',       name: 'Café Light',        desc: 'Warm & cozy',       bg: '#F5F0E8', accent: '#2D6A4F', text: '#2C1A0E' },
  { id: 'street-energy',    name: 'Street Energy',     desc: 'Urban & bold',      bg: '#070D1A', accent: '#FF6B1A', text: '#F0F4FF' },
  { id: 'heritage-gold',    name: 'Heritage Gold',     desc: 'Nigerian heritage',  bg: '#0B1508', accent: '#C9920A', text: '#F5E6C8' },
  { id: 'pure-luxury',      name: 'Pure Luxury',       desc: 'Fine dining',       bg: '#080808', accent: '#C9A84C', text: '#F0E8D8' },
  { id: 'tropical-bright',  name: 'Tropical Bright',   desc: 'Fresh & joyful',    bg: '#F0FDF4', accent: '#16A34A', text: '#14532D' },
  { id: 'custom',           name: 'Custom',            desc: 'Your brand colour',  bg: '#0A0208', accent: 'custom',  text: '#F0EDE8' },
] as const;

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

function StatusMsg({ status, errorText }: { status: SaveStatus; errorText: string }) {
  if (status === 'idle') return null;
  if (status === 'saving') return <span className="text-[#6B6570] text-sm">Saving…</span>;
  if (status === 'error') return <span className="text-[#ff6b6b] text-sm">{errorText}</span>;
  return <span className="text-emerald-400 text-sm">Saved!</span>;
}

export default function SettingsPage() {
  const restaurant = useRestaurant();
  const router = useRouter();

  // Restaurant settings state
  const [settings, setSettings] = useState<RestaurantSettings>({
    name: '', tagline: '', whatsapp: '',
    accent_color: '#C41E3A', max_tables_per_waiter: 3, menu_layout: 'magazine', menu_theme: 'nightlife-dark',
  });
  const [restStatus, setRestStatus] = useState<SaveStatus>('idle');
  const [restError, setRestError] = useState('');

  // Account state
  const [userEmail, setUserEmail] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPass, setShowCurrentPass] = useState(false);
  const [showNewPass, setShowNewPass] = useState(false);
  const [showConfirmPass, setShowConfirmPass] = useState(false);
  const [accountStatus, setAccountStatus] = useState<SaveStatus>('idle');
  const [accountMsg, setAccountMsg] = useState('');
  const [accountIsError, setAccountIsError] = useState(false);

  // Delete account
  const [deleteOpen, setDeleteOpen]       = useState(false);
  const [deleteInput, setDeleteInput]     = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError]     = useState('');

  const load = useCallback(async (restaurantId: string) => {
    const supabase = createClient();
    const [{ data }, { data: { user } }] = await Promise.all([
      supabase
        .from('restaurants')
        .select('name, tagline, whatsapp, accent_color, max_tables_per_waiter, menu_layout, menu_theme')
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
        menu_theme: data.menu_theme ?? 'nightlife-dark',
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
      menu_theme: settings.menu_theme,
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
    if (newPassword && !currentPassword) {
      setAccountMsg('Enter your current password to set a new one.');
      setAccountIsError(true);
      return;
    }

    setAccountStatus('saving');
    const supabase = createClient();

    // Verify current password before allowing a password change
    if (newPassword) {
      const { error: verifyErr } = await supabase.auth.signInWithPassword({
        email: userEmail.replace(' (pending confirmation)', ''),
        password: currentPassword,
      });
      if (verifyErr) {
        setAccountMsg('Current password is incorrect.');
        setAccountIsError(true);
        setAccountStatus('idle');
        return;
      }
    }

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
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => setAccountMsg(''), 5000);
    }
  }

  async function handleDeleteAccount() {
    if (deleteInput !== 'DELETE') return;
    setDeleteLoading(true);
    setDeleteError('');

    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setDeleteError('Session expired — refresh and try again.'); setDeleteLoading(false); return; }

    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/delete-account`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${session.access_token}` },
        }
      );
      const data = await res.json();
      if (!res.ok || data.error) {
        setDeleteError(data.error || 'Failed to delete account. Try again or contact support.');
        setDeleteLoading(false);
        return;
      }

      await supabase.auth.signOut();
      router.push('/signup');
    } catch {
      setDeleteError('Network error — check your connection and try again.');
      setDeleteLoading(false);
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

          <div className="flex flex-col gap-2">
            <span className="text-[#9a9098] text-xs font-medium uppercase tracking-wider">Menu Theme</span>
            <span className="text-[#4a4a4a] text-xs -mt-0.5">Controls colours and style on your customer-facing menu</span>
            <div className="grid grid-cols-3 gap-3 mt-1">
              {THEMES.map(theme => {
                const active = settings.menu_theme === theme.id;
                const accentDisplay = theme.accent === 'custom' ? settings.accent_color : theme.accent;
                return (
                  <button
                    key={theme.id}
                    type="button"
                    onClick={() => setSettings(s => ({ ...s, menu_theme: theme.id }))}
                    className={`relative flex flex-col rounded-xl overflow-hidden border-2 transition-all text-left ${
                      active
                        ? 'border-[#C41E3A] ring-2 ring-[#C41E3A]/25 scale-[1.03]'
                        : 'border-white/[0.06] hover:border-white/20'
                    }`}
                  >
                    {/* colour preview */}
                    <div style={{ background: theme.bg }} className="h-14 w-full relative flex items-center justify-center">
                      <div
                        style={{ background: accentDisplay }}
                        className="absolute bottom-0 left-0 right-0 h-[6px]"
                      />
                      <span style={{ color: theme.text }} className="text-sm font-black opacity-70 select-none">Aa</span>
                      {theme.id === 'custom' && (
                        <div
                          style={{ background: accentDisplay }}
                          className="absolute top-2 left-2 w-4 h-4 rounded-full border border-white/20"
                        />
                      )}
                    </div>
                    {/* label */}
                    <div className="bg-[#111] px-2.5 py-2">
                      <div className="text-[#F0EDE8] text-[11px] font-semibold leading-tight">{theme.name}</div>
                      <div className="text-[#4a4a4a] text-[10px] mt-0.5">
                        {theme.id === 'custom' ? 'Uses your accent colour' : theme.desc}
                      </div>
                    </div>
                    {/* check badge */}
                    {active && (
                      <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-[#C41E3A] flex items-center justify-center shadow-lg">
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                          <path d="M2 5l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

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

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[#9a9098] text-xs font-medium uppercase tracking-wider">Current Password</span>
              <a href="/reset-password" className="text-[#6B6570] hover:text-[#C41E3A] text-xs transition-colors">Forgot password?</a>
            </div>
            <span className="text-[#4a4a4a] text-xs -mt-0.5">Required to set a new password</span>
            <div className="relative">
              <input
                type={showCurrentPass ? 'text' : 'password'}
                value={currentPassword}
                onChange={e => setCurrentPassword(e.target.value)}
                placeholder="Your current password"
                autoComplete="current-password"
                className={`${inputCls} pr-11`}
              />
              <button type="button" onClick={() => setShowCurrentPass(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#4a4a4a] hover:text-[#9a9098] transition-colors p-1">
                <EyeIcon open={showCurrentPass} />
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[#9a9098] text-xs font-medium uppercase tracking-wider">New Password</span>
            <span className="text-[#4a4a4a] text-xs -mt-0.5">Minimum 8 characters — leave blank to keep current</span>
            <div className="relative">
              <input
                type={showNewPass ? 'text' : 'password'}
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
                className={`${inputCls} pr-11`}
              />
              <button type="button" onClick={() => setShowNewPass(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#4a4a4a] hover:text-[#9a9098] transition-colors p-1">
                <EyeIcon open={showNewPass} />
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[#9a9098] text-xs font-medium uppercase tracking-wider">Confirm New Password</span>
            <div className="relative">
              <input
                type={showConfirmPass ? 'text' : 'password'}
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
                className={`${inputCls} pr-11`}
              />
              <button type="button" onClick={() => setShowConfirmPass(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#4a4a4a] hover:text-[#9a9098] transition-colors p-1">
                <EyeIcon open={showConfirmPass} />
              </button>
            </div>
          </div>

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

      {/* ── Danger Zone ── */}
      <section className="bg-[#161616] border border-[#ff6b6b]/20 rounded-2xl p-6 mt-6">
        <h2 className="text-[#ff6b6b] text-sm font-semibold mb-1">Danger Zone</h2>
        <p className="text-[#6B6570] text-xs mb-5">
          Permanently delete your account and all restaurant data. This cannot be undone.
        </p>
        <button
          type="button"
          onClick={() => { setDeleteOpen(true); setDeleteInput(''); setDeleteError(''); }}
          className="border border-[#ff6b6b]/40 text-[#ff6b6b] text-sm font-medium px-5 py-2.5 rounded-xl hover:bg-[#ff6b6b]/10 transition-colors"
        >
          Delete my account
        </button>
      </section>

      {/* ── Delete confirmation modal ── */}
      {deleteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
          <div className="bg-[#1a1a1a] border border-white/[0.08] rounded-2xl w-full max-w-sm p-6">
            <h2 className="text-[#F0EDE8] text-lg font-semibold mb-2">Delete account?</h2>
            <p className="text-[#6B6570] text-sm mb-1 leading-relaxed">
              This will permanently delete:
            </p>
            <ul className="text-[#6B6570] text-sm mb-5 list-disc list-inside space-y-0.5 leading-relaxed">
              <li>Your restaurant profile and settings</li>
              <li>All menu items and categories</li>
              <li>All tables, staff, and orders</li>
              <li>Your login account</li>
            </ul>
            <p className="text-[#9a9098] text-sm mb-3">
              Type <span className="text-[#ff6b6b] font-mono font-bold">DELETE</span> to confirm:
            </p>
            <input
              type="text"
              value={deleteInput}
              onChange={e => setDeleteInput(e.target.value)}
              placeholder="DELETE"
              autoFocus
              className="bg-[#111] border border-white/[0.08] rounded-xl px-4 py-3 text-[#F0EDE8] text-sm placeholder-[#4a4a4a] outline-none focus:border-[#ff6b6b]/40 transition-colors w-full mb-4 font-mono"
            />
            {deleteError && (
              <p className="text-[#ff6b6b] text-sm mb-4 bg-[#ff6b6b]/10 border border-[#ff6b6b]/20 rounded-xl px-4 py-3">
                {deleteError}
              </p>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setDeleteOpen(false)}
                disabled={deleteLoading}
                className="flex-1 py-3 rounded-xl border border-white/[0.08] text-[#9a9098] text-sm font-medium hover:bg-white/[0.04] disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteAccount}
                disabled={deleteInput !== 'DELETE' || deleteLoading}
                className="flex-1 py-3 rounded-xl bg-[#ff6b6b] hover:bg-[#e05555] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
              >
                {deleteLoading ? 'Deleting…' : 'Delete everything'}
              </button>
            </div>
          </div>
        </div>
      )}
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
