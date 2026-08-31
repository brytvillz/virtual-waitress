import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GEMINI_MODEL = 'gemini-3.6-flash';
const GEMINI_BASE  = 'https://generativelanguage.googleapis.com/v1beta/models';

async function gemini(model: string, parts: unknown[], apiKey: string, maxTokens = 256): Promise<string> {
  const res = await fetch(`${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { maxOutputTokens: maxTokens },
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data?.error?.message || `Gemini returned ${res.status}`;
    throw new Error(`AI error: ${msg}`);
  }
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) throw new Error('AI returned an empty response. Please try again.');
  return text;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    // Require a valid authenticated session. This function calls a paid Gemini
    // API on the platform key — an unauthenticated endpoint is a billing attack
    // surface for anyone who discovers the URL.
    const token = req.headers.get('Authorization')?.replace('Bearer ', '').trim();
    if (!token) return json({ error: 'Unauthorized' }, 401);

    const supabase = createClient(
      Deno.env.get('SB_URL')!,
      Deno.env.get('SB_SERVICE_ROLE_KEY')!,
    );
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401);

    const API_KEY = Deno.env.get('GOOGLE_AI_KEY');
    if (!API_KEY) return json({ error: 'AI not configured — add GOOGLE_AI_KEY to Supabase secrets.' }, 500);

    const body = await req.json();
    const { action } = body;

    // ── Item copy: description + Ada message in one call ──────────────────────
    if (action === 'item-copy') {
      const { item_name, category_name = '', restaurant_name = 'our restaurant' } = body;
      if (!item_name) return json({ error: 'item_name is required' }, 400);

      const catHint = category_name ? ` in the "${category_name}" category` : '';
      const prompt =
        `You are a menu copywriter for ${restaurant_name}, a restaurant.` +
        ` The menu item is "${item_name}"${catHint}.` +
        `\n\nGenerate two things:` +
        `\n1. "description": A mouth-watering 1-sentence menu description (max 15 words). Specific and appetising.` +
        `\n2. "ada_message": A warm, friendly 1-sentence message that a virtual waitress named Ada would say to a customer who taps this dish. Include one emoji at the end.` +
        `\n\nReturn ONLY a single-line JSON object with no formatting or newlines: {"description":"...","ada_message":"..."}`;

      const raw = await gemini(GEMINI_MODEL, [{ text: prompt }], API_KEY, 2048);
      let result: { description: string; ada_message: string };
      try {
        const clean = raw.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim();
        result = JSON.parse(clean);
      } catch {
        return json({ error: 'Could not parse AI response', raw }, 422);
      }
      return json(result);
    }

    // ── Ada category message ───────────────────────────────────────────────────
    if (action === 'ada-message') {
      const { category_name, items = [], restaurant_name = 'our restaurant' } = body;
      const itemList = (items as { name: string }[]).slice(0, 8).map((i) => i.name).join(', ');

      const prompt =
        `You are Ada, a friendly virtual waitress for ${restaurant_name}.` +
        ` Write a short welcoming message (1–2 sentences) Ada says when a customer taps the "${category_name}" section of the menu.` +
        (itemList ? ` This section includes: ${itemList}.` : '') +
        ` Be warm, conversational, and appetising. No emojis. No quotation marks. Write only the message.`;

      const message = await gemini(GEMINI_MODEL, [{ text: prompt }], API_KEY, 128);
      return json({ message });
    }

    // ── Menu scanner: extract items from photo ─────────────────────────────────
    if (action === 'scan-menu') {
      const { image_base64, media_type = 'image/jpeg' } = body;
      if (!image_base64) return json({ error: 'No image provided' }, 400);

      const prompt =
        'This is a photo of a restaurant menu. Extract all menu items you can read.' +
        ' Return ONLY a valid JSON array — no explanation, no markdown fences.' +
        ' Each object must have: "name" (string), "price" (number in Naira, 0 if unreadable),' +
        ' "description" (string, empty if none), "category" (string, your best guess).' +
        ' Example: [{"name":"Egusi Soup","price":2500,"description":"","category":"Soups"}]';

      const raw = await gemini(GEMINI_MODEL, [
        { inline_data: { mime_type: media_type, data: image_base64 } },
        { text: prompt },
      ], API_KEY, 1024);

      let items = [];
      try {
        const clean = raw.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '');
        items = JSON.parse(clean);
      } catch {
        return json({ error: 'Could not parse menu', raw }, 422);
      }
      return json({ items });
    }

    return json({ error: 'Unknown action' }, 400);

  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
