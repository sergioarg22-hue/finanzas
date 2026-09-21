// ── GMAIL OAUTH: Paso 2 - recibir el código y guardar el token por usuario ───
// GET /api/gmail-callback?code=...&state=Sergio
// Google redirige acá después de que el usuario autoriza el acceso.
// "state" trae el nombre (Sergio/Vane) que mandamos en gmail-auth.js.

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

module.exports = async (req, res) => {
  const { code, error, state } = req.query || {};
  const user = state || 'Desconocido';

  if (error) {
    res.writeHead(302, { Location: '/index.html?gmail=error' });
    return res.end();
  }
  if (!code) {
    return res.status(400).send('Falta el código de autorización de Google.');
  }

  try {
    const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
    const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
    const REDIRECT_URI = 'https://agaete.vercel.app/api/gmail-callback';

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });
    const tokenData = await tokenRes.json();

    if (!tokenRes.ok) {
      console.error('Error obteniendo token de Google:', tokenData);
      res.writeHead(302, { Location: '/index.html?gmail=error' });
      return res.end();
    }

    // Guardamos el token en un objeto por usuario: { Sergio: {...}, Vane: {...} }
    const { data: existing } = await supabase.from('finanzas_data').select('value').eq('key', 'fin_gmail_tokens').single();
    const allTokens = existing?.value || {};
    const prevUserTokens = allTokens[user] || {};

    allTokens[user] = {
      refresh_token: tokenData.refresh_token || prevUserTokens.refresh_token || null,
      connected_at: new Date().toISOString(),
    };

    await supabase.from('finanzas_data').upsert(
      { key: 'fin_gmail_tokens', value: allTokens },
      { onConflict: 'key' }
    );

    res.writeHead(302, { Location: '/index.html?gmail=ok' });
    res.end();
  } catch (e) {
    console.error('Error en gmail-callback:', e);
    res.writeHead(302, { Location: '/index.html?gmail=error' });
    res.end();
  }
};
