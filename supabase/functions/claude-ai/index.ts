import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GEMINI_MODEL       = 'gemini-2.0-flash';
const GEMINI_VISION_MODEL = 'gemini-2.0-flash';
const GEMINI_BASE        = 'https://generativelanguage.googleapis.com/v1beta/models';

async function gemini(model: string, parts: unknown[], apiKey: string): Promise<string> {
  const res = await fetch(`${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts }] }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || 'Gemini request failed');
  return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    const API_KEY = Deno.env.get('GOOGLE_AI_KEY');
    if (!API_KEY) return json({ error: 'AI not configured' }, 500);

    const body = await req.json();
    const { action } = body;

    // ── Ada: generate a category / item greeting ───────────────────────────────
    if (action === 'ada-message') {
      const { category_name, items = [], restaurant_name = 'our restaurant' } = body;
      const itemList = (items as { name: string }[]).slice(0, 8).map(i => i.name).join(', ');

      const prompt =
        `You are Ada, a friendly virtual waitress for ${restaurant_name}, a Nigerian restaurant. ` +
        `Write a short welcoming message (1–2 sentences) Ada says when a customer taps the "${category_name}" section of the menu. ` +
        (itemList ? `This section includes: ${itemList}. ` : '') +
        `Be warm, conversational, and appetising. No emojis. No quotation marks. Write only the message.`;

      const message = await gemini(GEMINI_MODEL, [{ text: prompt }], API_KEY);
      return json({ message });
    }

    // ── Menu scanner: extract items from photo ─────────────────────────────────
    if (action === 'scan-menu') {
      const { image_base64, media_type = 'image/jpeg' } = body;
      if (!image_base64) return json({ error: 'No image provided' }, 400);

      const prompt =
        'This is a photo of a restaurant menu. Extract all menu items you can read. ' +
        'Return ONLY a valid JSON array — no explanation, no markdown fences. ' +
        'Each object must have: "name" (string), "price" (number in Naira, 0 if unreadable), ' +
        '"description" (string, empty if none), "category" (string, your best guess). ' +
        'Example: [{"name":"Egusi Soup","price":2500,"description":"","category":"Soups"}]';

      const raw = await gemini(GEMINI_VISION_MODEL, [
        { inline_data: { mime_type: media_type, data: image_base64 } },
        { text: prompt },
      ], API_KEY);

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
