import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';

export const metadata = {
  title: 'Virtual Waitress — Digital Menu & Ordering for Nigerian Restaurants',
  description: 'Customers scan a QR code at their table, browse your menu, and order. No app download. No paper menus. No long waits. Start your 14-day free trial.',
};

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect('/dashboard');

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-[#F0EDE8]">

      {/* ── Nav ─────────────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-50 bg-[#0a0a0a]/90 backdrop-blur border-b border-white/[0.06]">
        <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-[8px] bg-[#C41E3A] flex items-center justify-center shrink-0">
              <span className="text-white text-[9px] font-black tracking-wide">VW</span>
            </div>
            <span className="text-[#F0EDE8] font-bold text-sm tracking-tight">Virtual Waitress</span>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/login" className="text-[#6B6570] hover:text-[#F0EDE8] text-sm font-medium transition-colors px-3 py-2">
              Log in
            </Link>
            <Link href="/signup" className="bg-[#C41E3A] hover:bg-[#a01830] text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors">
              Start free trial
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        {/* Glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-[#C41E3A]/10 blur-[100px] pointer-events-none" />

        <div className="max-w-6xl mx-auto px-5 pt-24 pb-20 text-center relative">
          <div className="inline-flex items-center gap-2 bg-[#C41E3A]/10 border border-[#C41E3A]/20 text-[#e87a8a] text-xs font-medium px-4 py-1.5 rounded-full mb-8">
            <span className="w-1.5 h-1.5 bg-[#C41E3A] rounded-full" />
            14-day free trial — no credit card required
          </div>

          <h1 className="text-4xl sm:text-5xl md:text-6xl font-black tracking-tight leading-[1.05] mb-6 max-w-4xl mx-auto">
            Give every table its own<br />
            <span className="text-[#C41E3A]">digital waiter.</span>
          </h1>

          <p className="text-[#9a9098] text-lg sm:text-xl max-w-2xl mx-auto mb-10 leading-relaxed">
            Customers scan a QR code, browse your menu, and place their order — directly from their phone. No app download. No paper menu. No waiting.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
            <Link
              href="/signup"
              className="bg-[#C41E3A] hover:bg-[#a01830] text-white font-bold px-8 py-4 rounded-xl text-base transition-colors w-full sm:w-auto text-center"
            >
              Start your free trial →
            </Link>
            <Link
              href="/login"
              className="border border-white/[0.10] text-[#9a9098] hover:text-[#F0EDE8] hover:bg-white/[0.04] font-medium px-8 py-4 rounded-xl text-base transition-colors w-full sm:w-auto text-center"
            >
              I already have an account
            </Link>
          </div>

          <p className="text-[#4a4a4a] text-sm mt-4">14 days free · Then ₦3,900/month · Cancel anytime</p>
        </div>
      </section>

      {/* ── Problem ──────────────────────────────────────────────────── */}
      <section className="bg-[#0f0f0f] py-20 border-y border-white/[0.04]">
        <div className="max-w-5xl mx-auto px-5">
          <p className="text-center text-[#6B6570] text-sm uppercase tracking-widest font-semibold mb-4">Sound familiar?</p>
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-12 max-w-2xl mx-auto">
            Running a restaurant is hard enough — your ordering system shouldn&apos;t make it harder.
          </h2>
          <div className="grid sm:grid-cols-3 gap-6">
            {[
              {
                icon: (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#C41E3A" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                  </svg>
                ),
                title: 'Customers wait too long to order',
                desc: 'They\'re waving, looking around — your waiter is busy with another table. First impressions are ruined before the food even arrives.',
              },
              {
                icon: (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#C41E3A" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
                    <rect x="9" y="3" width="6" height="4" rx="1"/>
                    <path d="M9 12h6M9 16h4"/>
                  </svg>
                ),
                title: 'Orders get mixed up',
                desc: 'A verbal order taken mid-rush leads to the wrong dish, a complaint, a refund, and a customer who never comes back.',
              },
              {
                icon: (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#C41E3A" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                    <circle cx="9" cy="7" r="4"/>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                  </svg>
                ),
                title: 'Staff are stretched thin',
                desc: 'One person takes orders, one delivers, one handles the till. Everyone\'s running but nothing is efficient.',
              },
            ].map((item, i) => (
              <div key={i} className="bg-[#161616] border border-white/[0.06] rounded-2xl p-6">
                <div className="w-10 h-10 rounded-xl bg-[#C41E3A]/10 flex items-center justify-center mb-4">
                  {item.icon}
                </div>
                <h3 className="text-[#F0EDE8] font-semibold mb-2">{item.title}</h3>
                <p className="text-[#6B6570] text-sm leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────── */}
      <section className="py-24">
        <div className="max-w-5xl mx-auto px-5">
          <p className="text-center text-[#6B6570] text-sm uppercase tracking-widest font-semibold mb-4">How it works</p>
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-16">
            Set up in minutes. Run smarter, forever.
          </h2>

          <div className="grid sm:grid-cols-3 gap-8">
            {[
              {
                step: '01',
                title: 'Build your menu',
                desc: 'Add categories, items, prices, and photos. Use AI to generate descriptions and Ada\'s welcome messages instantly.',
              },
              {
                step: '02',
                title: 'Print your QR codes',
                desc: 'Every table gets its own QR code. Print them yourself or order our professionally designed physical cards.',
              },
              {
                step: '03',
                title: 'Customers scan & order',
                desc: 'They scan the code, see your full menu, and place their order. You get it live on your dashboard — no paper, no shouting.',
              },
            ].map((item, i) => (
              <div key={i} className="relative">
                <span className="text-[#C41E3A]/20 text-7xl font-black leading-none absolute -top-4 -left-2 select-none">
                  {item.step}
                </span>
                <div className="relative pt-8">
                  <h3 className="text-[#F0EDE8] font-bold text-lg mb-3">{item.title}</h3>
                  <p className="text-[#6B6570] text-sm leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────────── */}
      <section className="bg-[#0f0f0f] py-24 border-y border-white/[0.04]">
        <div className="max-w-5xl mx-auto px-5">
          <p className="text-center text-[#6B6570] text-sm uppercase tracking-widest font-semibold mb-4">Features</p>
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-16">
            Everything you need to run a smarter restaurant.
          </h2>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              {
                title: 'Digital menu with photos',
                desc: 'Beautiful menu with categories, item images, descriptions, and live availability toggles.',
                icon: 'M3 2h18M3 12h18M3 22h18',
              },
              {
                title: 'AI-generated descriptions',
                desc: 'Type an item name — our AI writes a mouth-watering description and Ada\'s personalised message.',
                icon: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
              },
              {
                title: 'Live order dashboard',
                desc: 'Every order comes in the moment it\'s placed. No paper, no shouting. Just clean, real-time updates.',
                icon: 'M18 20V10M12 20V4M6 20v-6M2 20h20',
              },
              {
                title: 'Table & waiter management',
                desc: 'Set up all your tables and assign waiters to shifts. Each table gets its own QR code and URL.',
                icon: 'M3 3h18v18H3zM3 9h18M3 15h18M9 9v12',
              },
              {
                title: 'Ada — your character greeter',
                desc: 'A friendly AI character greets each table with a personalised welcome message when they scan in.',
                icon: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
              },
              {
                title: 'QR codes & physical cards',
                desc: 'Generate QR codes instantly. Order professionally printed card stands for your tables.',
                icon: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3z',
              },
            ].map((f, i) => (
              <div key={i} className="bg-[#161616] border border-white/[0.06] rounded-2xl p-5">
                <div className="w-9 h-9 rounded-xl bg-[#1f1f1f] flex items-center justify-center mb-4">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#C41E3A" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d={f.icon}/>
                  </svg>
                </div>
                <h3 className="text-[#F0EDE8] font-semibold text-sm mb-2">{f.title}</h3>
                <p className="text-[#6B6570] text-xs leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ──────────────────────────────────────────────────── */}
      <section className="py-24">
        <div className="max-w-lg mx-auto px-5 text-center">
          <p className="text-[#6B6570] text-sm uppercase tracking-widest font-semibold mb-4">Pricing</p>
          <h2 className="text-2xl sm:text-3xl font-bold mb-12">Simple pricing. No surprises.</h2>

          <div className="bg-[#161616] border border-[#C41E3A]/30 rounded-2xl overflow-hidden">
            {/* Trial badge */}
            <div className="bg-[#C41E3A] py-2">
              <p className="text-white text-sm font-bold tracking-wide">14 DAYS FREE — NO CREDIT CARD</p>
            </div>

            <div className="p-8">
              <p className="text-[#6B6570] text-sm mb-4">Pro plan</p>
              <div className="flex items-baseline justify-center gap-1 mb-2">
                <span className="text-[#F0EDE8] text-5xl font-black">₦3,900</span>
                <span className="text-[#6B6570] text-base">/month</span>
              </div>
              <p className="text-[#6B6570] text-sm mb-8">Billed monthly · Cancel anytime</p>

              <ul className="text-left space-y-3 mb-8">
                {[
                  'Unlimited menu items & categories',
                  'Unlimited tables',
                  'Live order dashboard',
                  'AI description generator',
                  'QR code generation',
                  'Staff & waiter management',
                  'Custom restaurant branding',
                  'Priority support',
                ].map((f, i) => (
                  <li key={i} className="flex items-center gap-3 text-sm text-[#9a9098]">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#C41E3A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    {f}
                  </li>
                ))}
              </ul>

              <Link
                href="/signup"
                className="block w-full bg-[#C41E3A] hover:bg-[#a01830] text-white font-bold py-4 rounded-xl text-base transition-colors text-center"
              >
                Start your free trial →
              </Link>
              <p className="text-[#4a4a4a] text-xs mt-3">Free for 14 days. We&apos;ll remind you before it ends.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Final CTA ────────────────────────────────────────────────── */}
      <section className="bg-[#C41E3A] py-20">
        <div className="max-w-3xl mx-auto px-5 text-center">
          <h2 className="text-3xl sm:text-4xl font-black text-white mb-4 leading-tight">
            Your restaurant deserves a smarter way to take orders.
          </h2>
          <p className="text-white/80 text-lg mb-8 max-w-xl mx-auto">
            Join restaurants across Nigeria that are reducing wait times and cutting order mistakes with Virtual Waitress.
          </p>
          <Link
            href="/signup"
            className="inline-block bg-white text-[#C41E3A] font-bold px-10 py-4 rounded-xl text-base hover:bg-[#F0EDE8] transition-colors"
          >
            Get started free — 14 days on us
          </Link>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <footer className="bg-[#0a0a0a] border-t border-white/[0.06] py-10">
        <div className="max-w-6xl mx-auto px-5 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-[7px] bg-[#C41E3A] flex items-center justify-center shrink-0">
              <span className="text-white text-[8px] font-black tracking-wide">VW</span>
            </div>
            <span className="text-[#6B6570] text-sm">Virtual Waitress</span>
          </div>

          <div className="flex items-center gap-6 text-sm text-[#4a4a4a]">
            <Link href="/login" className="hover:text-[#6B6570] transition-colors">Log in</Link>
            <Link href="/signup" className="hover:text-[#6B6570] transition-colors">Sign up</Link>
            <a href="mailto:support@virtualwaitress.com" className="hover:text-[#6B6570] transition-colors">Support</a>
          </div>

          <p className="text-[#4a4a4a] text-sm">© {new Date().getFullYear()} Virtual Waitress</p>
        </div>
      </footer>

    </div>
  );
}
