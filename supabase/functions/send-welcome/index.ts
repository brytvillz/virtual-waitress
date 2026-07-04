import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function buildWelcomeEmail(restaurantName: string, slug: string): string {
  const dashboardUrl = 'https://app.virtualwaitress.com/admin.html';
  const menuUrl = `https://app.virtualwaitress.com/menu.html?r=${slug}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Welcome to Virtual Waitress</title>
</head>
<body style="margin:0;padding:0;background:#0D0D0D;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;-webkit-font-smoothing:antialiased;">

  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0D0D0D;">
    <tr>
      <td align="center" style="padding:48px 20px 40px;">

        <table width="100%" style="max-width:480px;" cellpadding="0" cellspacing="0" border="0">

          <!-- Logo -->
          <tr>
            <td align="center" style="padding-bottom:36px;">
              <table cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="background:#C41E3A;border-radius:10px;width:36px;height:36px;text-align:center;vertical-align:middle;line-height:36px;">
                    <span style="color:#ffffff;font-size:10px;font-weight:800;letter-spacing:0.05em;font-family:Arial,sans-serif;">VW</span>
                  </td>
                  <td style="padding-left:10px;vertical-align:middle;">
                    <span style="color:#F0EDE8;font-size:16px;font-weight:700;letter-spacing:-0.01em;">Virtual Waitress</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#161616;border-radius:18px;border:1px solid rgba(255,255,255,0.08);padding:40px 36px 36px;">

              <!-- Icon -->
              <p style="text-align:center;font-size:48px;margin:0 0 24px;line-height:1;">&#127881;</p>

              <!-- Heading -->
              <h1 style="color:#F0EDE8;font-family:Georgia,'Times New Roman',serif;font-size:26px;font-weight:700;text-align:center;margin:0 0 12px;line-height:1.25;letter-spacing:-0.01em;">
                Your account is ready!
              </h1>

              <!-- Subtext -->
              <p style="color:#6B6570;font-size:14px;line-height:1.6;text-align:center;margin:0 0 28px;">
                Welcome to Virtual Waitress. Your restaurant <strong style="color:#F0EDE8;">${restaurantName}</strong> has been set up and your digital menu is live.
              </p>

              <!-- Notice box -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px;">
                <tr>
                  <td style="background:#1a1218;border-radius:12px;border:1px solid rgba(196,30,58,0.2);padding:20px 24px;">
                    <p style="color:#C41E3A;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;margin:0 0 8px;">Next Step</p>
                    <p style="color:#9a9098;font-size:13px;margin:0;line-height:1.6;">
                      Check your inbox for a <strong style="color:#F0EDE8;">confirmation email</strong> from us. Click the link inside to verify your email and activate your account.
                    </p>
                  </td>
                </tr>
              </table>

              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px;">
                <tr>
                  <td align="center">
                    <a href="${dashboardUrl}" style="display:inline-block;background:#C41E3A;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:99px;letter-spacing:0.01em;">
                      Go to Admin Dashboard &rarr;
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Menu link -->
              <p style="text-align:center;margin:0 0 28px;">
                <a href="${menuUrl}" style="color:#6B6570;font-size:13px;text-decoration:none;">
                  View your customer menu &rarr;
                </a>
              </p>

              <!-- Divider -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px;">
                <tr>
                  <td style="border-top:1px solid rgba(255,255,255,0.07);font-size:0;line-height:0;">&nbsp;</td>
                </tr>
              </table>

              <!-- Footer note -->
              <p style="color:#4a4a4a;font-size:12px;text-align:center;margin:0;line-height:1.6;">
                Questions? Reply to this email or reach us on
                <a href="https://wa.me/2349023049395" style="color:#4a4a4a;text-decoration:underline;">WhatsApp</a>.
              </p>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:28px;">
              <p style="color:#333333;font-size:12px;margin:0 0 6px;line-height:1.5;">
                &copy; 2026 Virtual Waitress &mdash; Built for African restaurants
              </p>
              <p style="margin:0;">
                <a href="https://app.virtualwaitress.com" style="color:#4a4a4a;font-size:12px;text-decoration:none;">virtualwaitress.com</a>
                &nbsp;&middot;&nbsp;
                <a href="https://app.virtualwaitress.com/privacy.html" style="color:#4a4a4a;font-size:12px;text-decoration:none;">Privacy Policy</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    const RESEND_KEY = Deno.env.get('RESEND_API_KEY');
    if (!RESEND_KEY) return json({ error: 'Email not configured' }, 500);

    const { email, restaurant_name, slug } = await req.json();
    if (!email || !restaurant_name || !slug) return json({ error: 'Missing required fields' }, 400);

    const html = buildWelcomeEmail(restaurant_name, slug);

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Virtual Waitress <hello@virtualwaitress.com>',
        to: [email],
        subject: `Welcome to Virtual Waitress — ${restaurant_name} is ready!`,
        html,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return json({ error: 'Failed to send email', details: err }, 500);
    }

    return json({ sent: true });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
