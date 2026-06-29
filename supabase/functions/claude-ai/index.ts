import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY');
    if (!ANTHROPIC_KEY) return new Response(JSON.stringify({ error: 'AI not configured' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const body = await req.json();
    const { action } = body;

    // ── Ada: generate a category greeting ──────────────────────────────────────
    if (action === 'ada-message') {
      const { category_name, items = [], restaurant_name = 'our restaurant' } = body;

      const itemList = items.slice(0, 8).map((i: { name: string }) => i.name).join(', ');

      const prompt =
        `You are Ada, a friendly and warm virtual waitress for ${restaurant_name}, a Nigerian restaurant. ` +
        `Write a short, welcoming message (1–2 sentences max) that Ada says when a customer taps the "${category_name}" section of the menu. ` +
        (itemList ? `This section includes: ${itemList}. ` : '') +
        `Be warm, conversational, and appetising. No emojis. No quotation marks. Write only the message itself.`;

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 120,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      const data = await res.json();
      const message = data?.content?.[0]?.text?.trim() ?? '';
      return new Response(JSON.stringify({ message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── Menu scanner: extract items from image ─────────────────────────────────
    if (action === 'scan-menu') {
      const { image_base64, media_type = 'image/jpeg' } = body;
      if (!image_base64) return new Response(JSON.stringify({ error: 'No image provided' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

      const prompt =
        'This is a photo of a restaurant menu. Extract all menu items you can read. ' +
        'Return ONLY a valid JSON array — no explanation, no markdown. Each object must have: ' +
        '"name" (string), "price" (number in Naira, 0 if unreadable), "description" (string, empty if none), "category" (string, your best guess). ' +
        'Example: [{"name":"Egusi Soup","price":2500,"description":"","category":"Soups"}]';

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 2048,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type, data: image_base64 } },
              { type: 'text', text: prompt },
            ],
          }],
        }),
      });

      const data = await res.json();
      const raw = data?.content?.[0]?.text?.trim() ?? '[]';

      let items = [];
      try {
        // Strip markdown code fences if Claude added them
        const clean = raw.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/,'');
        items = JSON.parse(clean);
      } catch {
        return new Response(JSON.stringify({ error: 'Could not parse menu', raw }), { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      return new Response(JSON.stringify({ items }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
