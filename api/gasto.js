// ── API SERVERLESS: Cargar gastos remotamente ────────────────────────────────
// POST /api/gasto
// Headers: Authorization: Bearer TOKEN_SECRETO
// Body: { user, desc, amt, date, tipo, categoria, caja, recurrencia, ... }

const { createClient } = require('@supabase/supabase-js');

// ⚠️ CONFIGURAR: reemplazá con tus credenciales de Supabase
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const API_TOKEN = process.env.API_TOKEN; // Token secreto

// Validar que estén configuradas
if (!SUPABASE_URL || !SUPABASE_KEY || !API_TOKEN) {
  console.error('❌ Faltan variables de entorno: SUPABASE_URL, SUPABASE_KEY, API_TOKEN');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Helper: agregar meses a una fecha YYYY-MM
function addMonthStr(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

// Helper: calcular a qué resumen pertenece un consumo de tarjeta
function resumenKey(dateStr, card, tcConfig) {
  const cfg = tcConfig[card] || { cierre: 20, venc: 10 };
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDate();
  let resumenMonth = d.getMonth() + (day > cfg.cierre ? 1 : 0);
  let resumenYear = d.getFullYear();
  if (resumenMonth > 11) {
    resumenMonth -= 12;
    resumenYear += 1;
  }
  let vencMonth = resumenMonth + 1,
    vencYear = resumenYear;
  if (vencMonth > 11) {
    vencMonth -= 12;
    vencYear += 1;
  }
  const vencDate = `${vencYear}-${String(vencMonth + 1).padStart(2, '0')}-${String(cfg.venc).padStart(2, '0')}`;
  return vencDate.slice(0, 7);
}

module.exports = async (req, res) => {
  // Validar método
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Validar token
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  if (token !== API_TOKEN) {
    return res.status(401).json({ error: 'Token inválido' });
  }

  try {
    const { user, desc, amt, date, tipo, categoria, caja, recurrencia, cuotas, tarjeta, tcCategoria, resumenManual } =
      req.body;

    // Validaciones básicas
    if (!user || !desc || !amt || !date) {
      return res.status(400).json({ error: 'Faltan campos requeridos: user, desc, amt, date' });
    }

    if (amt <= 0) {
      return res.status(400).json({ error: 'El monto debe ser mayor a 0' });
    }

    // Cargar datos actuales
    const { data: dataRes } = await supabase.from('finanzas_data').select('value').eq('key', 'fin_data').single();
    const { data: tcRes } = await supabase.from('finanzas_data').select('value').eq('key', 'fin_tc').single();
    const { data: dispRes } = await supabase.from('finanzas_data').select('value').eq('key', 'fin_disp').single();
    const { data: tcCfgRes } = await supabase.from('finanzas_data').select('value').eq('key', 'fin_tc_config').single();

    let data = dataRes?.value || {};
    let tcData = tcRes?.value || {};
    let dispData = dispRes?.value || {};
    const tcConfig = tcCfgRes?.value || {};

    // ─── CARGAR TARJETA ──────────────────────────────────────────────────────
    if (tipo === 'tarjeta') {
      if (!tarjeta) {
        return res.status(400).json({ error: 'Falta tarjeta para consumo' });
      }

      if (!tcData[tarjeta]) tcData[tarjeta] = [];

      const firstResumen = resumenManual || resumenKey(date, tarjeta, tcConfig);
      const numCuotas = cuotas || 1;

      if (numCuotas === 1) {
        tcData[tarjeta].push({
          id: Date.now() + Math.random(),
          desc,
          amt,
          date,
          cat: tcCategoria || 'Otros',
          resumen: firstResumen,
          paid: false,
          cargadoPor: 'Charly IV',
          timestamp: new Date().toISOString()
        });
      } else {
        const cuotaAmt = Math.round((amt / numCuotas) * 100) / 100;
        const lastAmt = amt - cuotaAmt * (numCuotas - 1);
        for (let i = 0; i < numCuotas; i++) {
          const rk = addMonthStr(firstResumen, i);
          const cAmt = i === numCuotas - 1 ? lastAmt : cuotaAmt;
          tcData[tarjeta].push({
            id: Date.now() + Math.random() + i,
            desc: `${desc} (${i + 1}/${numCuotas})`,
            amt: cAmt,
            date,
            cat: tcCategoria || 'Otros',
            resumen: rk,
            paid: false,
            cuota: true,
            cargadoPor: 'Charly IV',
            timestamp: new Date().toISOString()
          });
        }
      }

      await supabase.from('finanzas_data').upsert({ key: 'fin_tc', value: tcData }, { onConflict: 'key' });

      return res.status(200).json({
        success: true,
        message: `Consumo cargado en ${tarjeta}${numCuotas > 1 ? ` (${numCuotas} cuotas)` : ''}`,
        datos: { desc, amt, tarjeta, cuotas: numCuotas },
      });
    }

    // ─── CARGAR INGRESO / GASTO ──────────────────────────────────────────────
    const mk = date.slice(0, 7);
    if (!data[mk]) data[mk] = [];

    const numRec = recurrencia || 1;

    if (numRec === 1) {
      const entry = {
        id: Date.now(),
        type: tipo,
        desc,
        cat: categoria || 'Otros',
        amt,
        date,
        caja: caja || null,
        cargadoPor: 'Charly IV',
        timestamp: new Date().toISOString()
      };
      data[mk].push(entry);

      // Actualizar saldo de caja
      if (caja) {
        if (!dispData[caja]) dispData[caja] = 0;
        const delta = tipo === 'income' ? amt : -amt;
        dispData[caja] = parseFloat((dispData[caja] + delta).toFixed(2));
      }
    } else {
      // Recurrencia: repetir N veces
      const amtDelta = tipo === 'income' ? amt : -amt;
      for (let i = 0; i < numRec; i++) {
        const entryDate = addMonthStr(mk, i) + date.slice(7); // Mantener día/mes
        const entryMk = entryDate.slice(0, 7);
        if (!data[entryMk]) data[entryMk] = [];

        const entry = {
          id: Date.now() + Math.random() + i,
          type: tipo,
          desc,
          cat: categoria || 'Otros',
          amt,
          date: entryDate,
          caja: caja || null,
          label: `Vez ${i + 1}/${numRec}`,
          cargadoPor: 'Charly IV',
          timestamp: new Date().toISOString()
        };
        data[entryMk].push(entry);

        // Actualizar saldo en cada repetición
        if (caja) {
          if (!dispData[caja]) dispData[caja] = 0;
          dispData[caja] = parseFloat((dispData[caja] + amtDelta).toFixed(2));
        }
      }
    }

    // Guardar en Supabase
    await supabase.from('finanzas_data').upsert({ key: 'fin_data', value: data }, { onConflict: 'key' });
    if (caja) {
      await supabase.from('finanzas_data').upsert({ key: 'fin_disp', value: dispData }, { onConflict: 'key' });
    }

    return res.status(200).json({
      success: true,
      message: `${tipo === 'income' ? 'Ingreso' : 'Gasto'} cargado correctamente`,
      datos: { desc, amt, tipo, categoria, caja, fecha: date, repeticiones: numRec },
    });
  } catch (error) {
    console.error('Error en API:', error);
    return res.status(500).json({ error: 'Error interno: ' + error.message });
  }
};
