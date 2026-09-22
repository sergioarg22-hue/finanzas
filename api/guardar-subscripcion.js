// ── API: Guardar suscripción push del navegador ──────────────────────────────
// POST /api/guardar-subscripcion
// Body: { usuario, subscription }
// Se llama desde el navegador cuando el usuario activa las notificaciones.

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  try {
    const { usuario, subscription } = req.body || {};
    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ error: 'Falta la suscripción' });
    }

    const { data: subsRes } = await supabase.from('finanzas_data').select('value').eq('key', 'fin_push_subs').single();
    let subs = subsRes?.value || {};

    // Guardamos por endpoint para evitar duplicados (un dispositivo = un endpoint único)
    subs[subscription.endpoint] = {
      usuario: usuario || 'Desconocido',
      subscription,
      creado: new Date().toISOString(),
    };

    await supabase.from('finanzas_data').upsert({ key: 'fin_push_subs', value: subs }, { onConflict: 'key' });

    return res.status(200).json({ success: true, message: 'Suscripción guardada' });
  } catch (error) {
    console.error('Error guardando suscripción:', error);
    return res.status(500).json({ error: 'Error interno: ' + error.message });
  }
};
