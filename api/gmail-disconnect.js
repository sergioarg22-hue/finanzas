// ── GMAIL: Desconectar la cuenta de un usuario específico ────────────────────
// POST /api/gmail-disconnect
// Body: { user: "Sergio" } (o "Vane")

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { user } = req.body || {};
    const { data: existing } = await supabase.from('finanzas_data').select('value').eq('key', 'fin_gmail_tokens').single();
    const allTokens = existing?.value || {};

    if (user && allTokens[user]) {
      delete allTokens[user];
    }

    await supabase.from('finanzas_data').upsert({ key: 'fin_gmail_tokens', value: allTokens }, { onConflict: 'key' });
    return res.status(200).json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
