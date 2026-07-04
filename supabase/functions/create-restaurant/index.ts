import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
    const { restaurant_name, email, password, promo_code } = await req.json();

    if (!restaurant_name?.trim() || !email?.trim() || !password) {
      return new Response(JSON.stringify({ error: 'Restaurant name, email, and password are required.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (password.length < 8) {
      return new Response(JSON.stringify({ error: 'Password must be at least 8 characters.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return new Response(JSON.stringify({ error: 'Please enter a valid email address.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // ── Validate promo code (if provided) ────────────────────────────────────
    type PromoRow = { id: string; plan: string; duration_days: number | null; uses_count: number };
    let promoRow: PromoRow | null = null;

    if (promo_code?.trim()) {
      const code = promo_code.trim().toUpperCase();
      const { data: promo } = await admin
        .from('promo_codes')
        .select('id, plan, duration_days, max_uses, uses_count, expires_at')
        .eq('code', code)
        .maybeSingle();

      if (!promo) {
        return new Response(JSON.stringify({ error: 'Invalid promo code. Please check and try again.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (promo.expires_at && new Date(promo.expires_at) < new Date()) {
        return new Response(JSON.stringify({ error: 'This promo code has expired.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (promo.max_uses !== null && promo.uses_count >= promo.max_uses) {
        return new Response(JSON.stringify({ error: 'This promo code has already been fully redeemed.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      promoRow = { id: promo.id, plan: promo.plan, duration_days: promo.duration_days, uses_count: promo.uses_count };
    }

    // ── Generate unique slug ──────────────────────────────────────────────────
    const baseSlug = toSlug(restaurant_name.trim());
    if (!baseSlug) {
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

    const restaurantRow: Record<string, unknown> = {
      name: restaurant_name.trim(),
      slug,
      accent_color: '#C41E3A',
      owner_id: userId,
    };

    if (promoRow) {
      restaurantRow.plan = promoRow.plan;
      restaurantRow.plan_status = 'active';
      if (planExpiresAt) restaurantRow.plan_expires_at = planExpiresAt;
    }

    // ── Create restaurant record ──────────────────────────────────────────────
    const { data: restaurant, error: restaurantError } = await admin
      .from('restaurants')
      .insert(restaurantRow)
      .select('id')
      .single();

    if (restaurantError) {
      await admin.auth.admin.deleteUser(userId);
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
      return new Response(JSON.stringify({ error: 'Failed to set up your account. Please try again.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Increment promo uses_count ────────────────────────────────────────────
    if (promoRow) {
      await admin
        .from('promo_codes')
        .update({ uses_count: promoRow.uses_count + 1 })
        .eq('id', promoRow.id);
    }

    // ── Send welcome email (fire-and-forget) ──────────────────────────────────
    fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-welcome`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      },
      body: JSON.stringify({ email: email.trim(), restaurant_name: restaurant_name.trim(), slug }),
    }).catch(() => {});

    return new Response(JSON.stringify({
      success: true,
      slug,
      restaurant_id: restaurant.id,
      promo_applied: !!promoRow,
      promo_plan: promoRow?.plan ?? null,
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
