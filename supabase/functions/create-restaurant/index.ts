import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PILOT_MSG = 'Virtual Waitress is currently in a limited pilot. To request access, message us on WhatsApp: https://wa.me/2347018814381';

function pilotReject(reason: string, admin: ReturnType<typeof createClient>, ip: string) {
  console.log(reason);
  admin.from('signup_attempts').insert({ ip, rejection_reason: reason });
  return new Response(JSON.stringify({ error: PILOT_MSG }), {
    status: 403,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim()
            || req.headers.get('x-real-ip')
            || 'unknown';

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // ── Rate limit: max 5 signup attempts per IP per hour ────────────────────
    const windowStart = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await admin
      .from('signup_attempts')
      .select('*', { count: 'exact', head: true })
      .eq('ip', ip)
      .gte('created_at', windowStart);

    if ((count ?? 0) >= 5) {
      return new Response(JSON.stringify({ error: 'Too many signup attempts. Please try again in an hour.' }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { restaurant_name, email, password, promo_code, timezone } = await req.json();

    if (!restaurant_name?.trim() || !email?.trim() || !password) {
      await admin.from('signup_attempts').insert({ ip });
      return new Response(JSON.stringify({ error: 'Restaurant name, email, and password are required.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Access code is required ───────────────────────────────────────────────
    if (!promo_code?.trim()) {
      await admin.from('signup_attempts').insert({ ip });
      return new Response(JSON.stringify({ error: PILOT_MSG }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (password.length < 8) {
      await admin.from('signup_attempts').insert({ ip });
      return new Response(JSON.stringify({ error: 'Password must be at least 8 characters.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      await admin.from('signup_attempts').insert({ ip });
      return new Response(JSON.stringify({ error: 'Please enter a valid email address.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Validate access code — each failure reason logged separately ─────────
    type PromoRow = { id: string; plan: string; duration_days: number | null };
    let promoRow: PromoRow | null = null;

    {
      const code = promo_code.trim().toUpperCase();
      const { data: promo } = await admin
        .from('promo_codes')
        .select('id, plan, duration_days, max_uses, uses_count, expires_at')
        .eq('code', code)
        .maybeSingle();

      if (!promo) {
        return pilotReject('code_not_found', admin, ip);
      }
      if (promo.expires_at && new Date(promo.expires_at) < new Date()) {
        return pilotReject('code_expired', admin, ip);
      }
      if (promo.max_uses !== null && promo.uses_count >= promo.max_uses) {
        return pilotReject('code_exhausted', admin, ip);
      }

      promoRow = { id: promo.id, plan: promo.plan, duration_days: promo.duration_days };
    }

    // ── Generate unique slug ──────────────────────────────────────────────────
    const baseSlug = toSlug(restaurant_name.trim());
    if (!baseSlug) {
      await admin.from('signup_attempts').insert({ ip });
      return new Response(JSON.stringify({ error: 'Restaurant name must contain letters or numbers.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let slug = baseSlug;
    let counter = 2;
    while (true) {
      const { data: existing } = await admin
        .from('restaurants')
        .select('id')
        .eq('slug', slug)
        .maybeSingle();
      if (!existing) break;
      slug = `${baseSlug}-${counter}`;
      counter++;
    }

    // ── Create auth user ──────────────────────────────────────────────────────
    const { data: authData, error: authError } = await admin.auth.admin.createUser({
      email: email.trim(),
      password,
      email_confirm: false,
    });

    if (authError) {
      await admin.from('signup_attempts').insert({ ip });
      const msg = authError.message.includes('already registered')
        ? 'An account with this email already exists. Please log in instead.'
        : authError.message;
      return new Response(JSON.stringify({ error: msg }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userId = authData.user.id;

    // ── Build restaurant row ──────────────────────────────────────────────────
    const planExpiresAt = promoRow?.duration_days
      ? new Date(Date.now() + promoRow.duration_days * 86400000).toISOString()
      : null;

    const trialEndsAt = new Date(Date.now() + 14 * 86400000).toISOString();

    const restaurantRow: Record<string, unknown> = {
      name: restaurant_name.trim(),
      slug,
      accent_color: '#C41E3A',
      owner_id: userId,
      trial_ends_at: trialEndsAt,
    };

    if (timezone && typeof timezone === 'string' && timezone.trim()) {
      restaurantRow.timezone = timezone.trim();
    }

    restaurantRow.plan = promoRow.plan;
    restaurantRow.plan_status = 'active';
    restaurantRow.signup_promo_id = promoRow.id;
    if (planExpiresAt) restaurantRow.plan_expires_at = planExpiresAt;

    // ── Create restaurant record ──────────────────────────────────────────────
    const { data: restaurant, error: restaurantError } = await admin
      .from('restaurants')
      .insert(restaurantRow)
      .select('id')
      .single();

    if (restaurantError) {
      await admin.auth.admin.deleteUser(userId);
      await admin.from('signup_attempts').insert({ ip });
      return new Response(JSON.stringify({ error: 'Failed to create restaurant. Please try again.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Create staff record (manager role) ────────────────────────────────────
    const { error: staffError } = await admin
      .from('staff')
      .insert({ id: userId, restaurant_id: restaurant.id, name: restaurant_name.trim(), role: 'manager' });

    if (staffError) {
      await admin.auth.admin.deleteUser(userId);
      await admin.from('restaurants').delete().eq('id', restaurant.id);
      await admin.from('signup_attempts').insert({ ip });
      return new Response(JSON.stringify({ error: 'Failed to set up your account. Please try again.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Atomically claim access code ──────────────────────────────────────────
    await admin.rpc('claim_promo_uses', { p_promo_id: promoRow.id });

    // Record successful attempt (no rejection_reason)
    await admin.from('signup_attempts').insert({ ip });

    return new Response(JSON.stringify({
      success: true,
      slug,
      restaurant_id: restaurant.id,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (_err) {
    return new Response(JSON.stringify({ error: 'Server error. Please try again.' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
