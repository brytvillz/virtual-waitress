import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Try models in order. Fall through only on overload / rate-limit.
const GEMINI_MODELS = [
  'gemini-3.6-flash',  // primary — previous gen, less contended
  'gemini-3.8-flash',  // fallback
  'gemini-2.5-flash',  // last resort
];
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

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

function isOverload(status: number, body: { error?: { message?: string } }): boolean {
  if (status === 429 || status === 503) return true;
  const msg = (body?.error?.message ?? '').toLowerCase();
  return msg.includes('high demand') || msg.includes('overloaded');
}

async function geminiScan(parts: unknown[], apiKey: string): Promise<string> {
  const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
  for (const model of GEMINI_MODELS) {
    for (let attempt = 0; attempt <= 1; attempt++) {
      if (attempt === 1) await sleep(2000);
      const res = await fetch(`${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              ...(parts as unknown[]),
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
        if (isOverload(res.status, data)) {
          if (attempt === 1) break; // retry exhausted → try next model
          continue;                 // wait 2 s then retry same model
        }
        // Genuine error (bad key, bad request, etc.) — surface immediately.
        throw new Error(data?.error?.message || `Gemini returned ${res.status}`);
      }
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
      if (!text) throw new Error('AI returned an empty response. Please try a clearer photo.');
      console.log(`[scan-menu] answered by ${model}`);
      return text;
    }
  }
  throw new Error('AI is currently overloaded — please try again in a moment.');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

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
    const { image, mimeType } = body;

    if (!image || !mimeType) return json({ error: 'image and mimeType are required.' }, 400);

    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic'];
    if (!allowedTypes.includes(mimeType.toLowerCase())) {
      return json({ error: 'Unsupported image type. Use JPEG, PNG, or WEBP.' }, 400);
    }

    const raw = await geminiScan(
      [
        { inlineData: { mimeType, data: image } },
        { text: SYSTEM_PROMPT },
      ],
      API_KEY,
    );

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
