// ── GMAIL: Consultar estado de conexión por usuario ───────────────────────────
// GET /api/gmail-status
// Devuelve: { users: { Sergio: {connected, connected_at}, Vane: {...} } }

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const { data } = await supabase.from('finanzas_data').select('value').eq('key', 'fin_gmail_tokens').single();
    const allTokens = data?.value || {};

    const users = {};
    Object.keys(allTokens).forEach(user => {
      users[user] = {
        connected: !!allTokens[user]?.refresh_token,
        connected_at: allTokens[user]?.connected_at || null,
      };
    });

    return res.status(200).json({ users });
  } catch (e) {
    return res.status(200).json({ users: {} });
  }
};
