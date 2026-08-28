import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GEMINI_MODEL = 'gemini-1.5-flash';
const GEMINI_BASE  = 'https://generativelanguage.googleapis.com/v1beta/models';

const SYSTEM_PROMPT = `You are a menu digitizer. The user has photographed a physical restaurant menu.
Extract all menu categories and items visible in the image.

Rules:
- Group items under their category headers (e.g. "Starters", "Main Course", "Drinks")
- For prices: extract the numeric value only (no currency symbols or commas). If price is unclear or missing, use 0.
- Keep item names as they appear on the menu (do not translate or paraphrase).
- If no categories are visible, put all items under a single category named "Menu".
- Return ONLY a valid JSON object with no markdown, no backticks, no explanation.

Response format:
{"categories":[{"name":"Category Name","items":[{"name":"Item Name","price":1500,"description":""}]}]}`;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  try {
    const API_KEY = Deno.env.get('GOOGLE_AI_KEY');
    if (!API_KEY) return json({ error: 'AI not configured — add GOOGLE_AI_KEY to Supabase secrets.' }, 500);

    const body = await req.json();
    const { image, mimeType } = body;

    if (!image || !mimeType) return json({ error: 'image and mimeType are required.' }, 400);

    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic'];
    if (!allowedTypes.includes(mimeType.toLowerCase())) {
      return json({ error: 'Unsupported image type. Use JPEG, PNG, or WEBP.' }, 400);
    }

    const res = await fetch(`${GEMINI_BASE}/${GEMINI_MODEL}:generateContent?key=${API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inlineData: { mimeType, data: image } },
            { text: SYSTEM_PROMPT },
          ],
        }],
        generationConfig: {
          maxOutputTokens: 4096,
          temperature: 0.1,
        },
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      const msg = data?.error?.message || `Gemini returned ${res.status}`;
      return json({ error: `AI error: ${msg}` }, 500);
    }

    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
    if (!raw) return json({ error: 'AI returned an empty response. Please try a clearer photo.' }, 500);

    // Strip markdown code fences if present
    const cleaned = raw.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();

    let result: { categories: unknown[] };
    try {
      result = JSON.parse(cleaned);
    } catch {
      return json({ error: 'Could not parse AI response. Please try a clearer photo.' }, 500);
    }

    if (!Array.isArray(result.categories)) {
      return json({ error: 'Unexpected response structure from AI.' }, 500);
    }

    return json(result);
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
