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
    const { restaurant_name, email, password } = await req.json();

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

    // Generate unique slug
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

    // Create auth user (auto-confirm so they can log in immediately)
    const { data: authData, error: authError } = await admin.auth.admin.createUser({
      email: email.trim(),
      password,
      email_confirm: true,
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

    // Create restaurant record
    const { data: restaurant, error: restaurantError } = await admin
      .from('restaurants')
      .insert({ name: restaurant_name.trim(), slug, accent_color: '#C41E3A', owner_id: userId })
      .select('id')
      .single();

    if (restaurantError) {
      await admin.auth.admin.deleteUser(userId);
      return new Response(JSON.stringify({ error: 'Failed to create restaurant. Please try again.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Create staff record (manager role)
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

    return new Response(JSON.stringify({ success: true, slug, restaurant_id: restaurant.id }), {
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
