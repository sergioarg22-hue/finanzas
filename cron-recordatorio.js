// ── CRON DIARIO: Débitos automáticos + movimientos de HOY + vencimientos + Gmail
// Se ejecuta automáticamente todos los días ~8am (hora Argentina) vía Vercel Cron.
// 1) Genera los débitos automáticos que correspondan al día de hoy (banco o tarjeta)
// 2) Envía una notificación push con: movimientos cargados hoy, vencimientos de
//    tarjeta de hoy, y correos recientes relevantes (si Gmail está conectado).

const { createClient } = require('@supabase/supabase-js');
const webpush = require('web-push');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const GMAIL_CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const GMAIL_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

webpush.setVapidDetails('mailto:admin@agaete.vercel.app', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

function fmt(n) {
  return '$' + Math.round(Math.abs(n)).toLocaleString('es-AR');
}

function todayStr() {
  // Hora Argentina (UTC-3, sin horario de verano)
  const now = new Date();
  const arg = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  return arg.toISOString().slice(0, 10);
}

function addMonthStr(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

// Misma lógica que usa la app para calcular a qué resumen de tarjeta va un consumo
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
  let vencMonth = resumenMonth + 1, vencYear = resumenYear;
  if (vencMonth > 11) {
    vencMonth -= 12;
    vencYear += 1;
  }
  const vencDate = `${vencYear}-${String(vencMonth + 1).padStart(2, '0')}-${String(cfg.venc).padStart(2, '0')}`;
  return vencDate.slice(0, 7);
}

// ── Generar los débitos automáticos que correspondan a HOY ───────────────────
async function generarDebitosAutomaticos(today) {
  const { data: debRes } = await supabase.from('finanzas_data').select('value').eq('key', 'fin_debitos_automaticos').single();
  const debitos = debRes?.value || [];
  if (!debitos.length) return { generados: [], huboDebitos: false };

  const { data: dataRes } = await supabase.from('finanzas_data').select('value').eq('key', 'fin_data').single();
  const { data: tcRes } = await supabase.from('finanzas_data').select('value').eq('key', 'fin_tc').single();
  const { data: dispRes } = await supabase.from('finanzas_data').select('value').eq('key', 'fin_disp').single();
  const { data: tcCfgRes } = await supabase.from('finanzas_data').select('value').eq('key', 'fin_tc_config').single();

  const data = dataRes?.value || {};
  const tcData = tcRes?.value || {};
  const dispData = dispRes?.value || {};
  const tcConfig = tcCfgRes?.value || {};

  const [y, m, d] = today.split('-').map(Number);
  const mesActual = today.slice(0, 7);
  const diasEnEsteMes = new Date(y, m, 0).getDate(); // último día real del mes actual
  const generados = [];
  let cambiosData = false;
  let cambiosTc = false;
  let cambiosDisp = false;

  debitos.forEach(deb => {
    if (!deb.activo) return;
    if (deb.ultimoMesGenerado === mesActual) return; // ya se generó este mes

    // Día efectivo de este mes (si el débito dice "31" y el mes tiene 30, cae el último día)
    const diaEfectivo = Math.min(deb.dia, diasEnEsteMes);

    // Recién corresponde generar si hoy ya llegó (o pasó) el día del débito.
    // Esto cubre el caso normal (hoy = día exacto) Y el caso de "puesta al día"
    // cuando el débito se creó después de que ese día ya había pasado este mes.
    if (d < diaEfectivo) return; // todavía no llega el día este mes

    const fechaDebito = `${mesActual}-${String(diaEfectivo).padStart(2, '0')}`;

    if (deb.tipo === 'tarjeta') {
      if (!tcData[deb.tarjeta]) tcData[deb.tarjeta] = [];
      const resumen = resumenKey(fechaDebito, deb.tarjeta, tcConfig);
      tcData[deb.tarjeta].push({
        id: Date.now() + Math.random(),
        desc: deb.desc,
        amt: deb.monto,
        moneda: deb.moneda || 'ARS',
        date: fechaDebito,
        cat: deb.categoria || 'Otros',
        resumen,
        paid: false,
        cargadoPor: 'Débito automático',
        timestamp: new Date().toISOString(),
        debitoAutomaticoId: deb.id,
      });
      cambiosTc = true;
    } else {
      // tipo === 'banco'
      if (!data[mesActual]) data[mesActual] = [];
      data[mesActual].push({
        id: Date.now() + Math.random(),
        type: 'expense',
        desc: deb.desc,
        cat: deb.categoria || 'Otros gastos',
        amt: deb.monto,
        moneda: deb.moneda || 'ARS',
        date: fechaDebito,
        caja: deb.caja || null,
        cargadoPor: 'Débito automático',
        timestamp: new Date().toISOString(),
        auto: true,
        debitoAutomaticoId: deb.id,
      });
      cambiosData = true;

      if (deb.caja) {
        if (!dispData[deb.caja]) dispData[deb.caja] = 0;
        dispData[deb.caja] = parseFloat((dispData[deb.caja] - deb.monto).toFixed(2));
        cambiosDisp = true;
      }
    }

    deb.ultimoMesGenerado = mesActual;
    generados.push(deb);
  });

  if (generados.length) {
    await supabase.from('finanzas_data').upsert({ key: 'fin_debitos_automaticos', value: debitos }, { onConflict: 'key' });
    if (cambiosData) await supabase.from('finanzas_data').upsert({ key: 'fin_data', value: data }, { onConflict: 'key' });
    if (cambiosTc) await supabase.from('finanzas_data').upsert({ key: 'fin_tc', value: tcData }, { onConflict: 'key' });
    if (cambiosDisp) await supabase.from('finanzas_data').upsert({ key: 'fin_disp', value: dispData }, { onConflict: 'key' });
  }

  return { generados, huboDebitos: true };
}

const DEFAULT_GMAIL_KEYWORDS = ['factura', 'vencimiento', 'resumen de cuenta', 'resumen de tarjeta', 'pagar antes del'];
const DEFAULT_GMAIL_SENDERS = ['edenor', 'movistarar', 'personal', 'telecom', 'fibertel', 'osde', 'galicia', 'hsbc', 'icbc', 'macro', 'mercadopago', 'cencosud'];

function buildGmailQuery(keywords, senders) {
  const senderPart = senders.map(s => `from:${s}`).join(' OR ');
  const subjectPart = keywords.map(k => (k.includes(' ') ? `subject:"${k}"` : `subject:${k}`)).join(' OR ');
  return `(${senderPart} OR ${subjectPart}) newer_than:3d`;
}

async function refrescarAccessToken(refreshToken) {
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GMAIL_CLIENT_ID,
      client_secret: GMAIL_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const json = await resp.json();
  if (!resp.ok) throw new Error('No se pudo refrescar el token de Gmail: ' + JSON.stringify(json));
  return json.access_token;
}

// Escanea el Gmail de UN usuario puntual (ya con su refresh_token)
async function escanearGmailDeUsuario(usuario, refreshToken, keywords, senders, seenAll) {
  const accessToken = await refrescarAccessToken(refreshToken);
  const query = buildGmailQuery(keywords, senders);
  const seen = seenAll[usuario] || {};

  const listResp = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=15`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const listJson = await listResp.json();
  const mensajes = listJson.messages || [];

  const nuevos = [];
  for (const m of mensajes) {
    if (seen[m.id]) continue;

    const msgResp = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const msgJson = await msgResp.json();
    const headers = msgJson.payload?.headers || [];
    const asunto = headers.find(h => h.name === 'Subject')?.value || '(sin asunto)';
    const de = headers.find(h => h.name === 'From')?.value || '';
    const deCorto = de.split('<')[0].trim() || de;

    nuevos.push({ usuario, de: deCorto, asunto, snippet: msgJson.snippet || '' });
    seen[m.id] = new Date().toISOString();
  }

  const LIMITE_DIAS = 60;
  const ahora = Date.now();
  Object.keys(seen).forEach(id => {
    const t = new Date(seen[id]).getTime();
    if (isNaN(t) || ahora - t > LIMITE_DIAS * 24 * 60 * 60 * 1000) delete seen[id];
  });
  seenAll[usuario] = seen;

  return nuevos;
}

// Escanea el Gmail de TODOS los usuarios que tengan una cuenta conectada
async function revisarGmail() {
  const { data: tokRes } = await supabase.from('finanzas_data').select('value').eq('key', 'fin_gmail_tokens').single();
  const allTokens = tokRes?.value || {};
  const usuariosConectados = Object.keys(allTokens).filter(u => allTokens[u]?.refresh_token);

  if (!usuariosConectados.length) {
    return { conectados: [], nuevos: [] };
  }

  const { data: cfgRes } = await supabase.from('finanzas_data').select('value').eq('key', 'fin_gmail_config').single();
  const cfg = cfgRes?.value || {};
  const keywords = cfg.keywords || DEFAULT_GMAIL_KEYWORDS;
  const senders = cfg.senders || DEFAULT_GMAIL_SENDERS;

  const { data: seenRes } = await supabase.from('finanzas_data').select('value').eq('key', 'fin_gmail_seen').single();
  const seenAll = seenRes?.value || {};

  let nuevos = [];
  for (const usuario of usuariosConectados) {
    try {
      const nuevosDeEsteUsuario = await escanearGmailDeUsuario(
        usuario,
        allTokens[usuario].refresh_token,
        keywords,
        senders,
        seenAll
      );
      nuevos = nuevos.concat(nuevosDeEsteUsuario);
    } catch (e) {
      console.error(`Error escaneando Gmail de ${usuario}:`, e.message);
    }
  }

  await supabase.from('finanzas_data').upsert({ key: 'fin_gmail_seen', value: seenAll }, { onConflict: 'key' });

  return { conectados: usuariosConectados, nuevos };
}

// Calcula los impuestos activos de una tarjeta sobre una base de consumos (igual que en la app)
function calcularImpuestosResumen(tcImpuestos, tipoCambio, card, subtotalARS, subtotalUSD) {
  const impuestos = (tcImpuestos[card] || []).filter(i => i.activo);
  const subtotalUSDenARS = subtotalUSD * tipoCambio;
  const subtotalTotalARS = subtotalARS + subtotalUSDenARS;
  const calculados = {};
  const detalle = [];

  impuestos.forEach(imp => {
    let montoARS = 0;
    if (imp.tipo === 'fijo') montoARS = imp.valor;
    else if (imp.tipo === 'pct_ars') montoARS = subtotalARS * (imp.valor / 100);
    else if (imp.tipo === 'pct_usd') montoARS = subtotalUSDenARS * (imp.valor / 100);
    else if (imp.tipo === 'pct_total') montoARS = subtotalTotalARS * (imp.valor / 100);
    else if (imp.tipo === 'pct_impuesto') montoARS = (calculados[imp.refImpuestoId] || 0) * (imp.valor / 100);
    else if (imp.tipo === 'pct_fijo') montoARS = (imp.baseFija || 0) * (imp.valor / 100);
    calculados[imp.id] = montoARS;
    detalle.push({ nombre: imp.nombre, monto: montoARS });
  });

  const totalImpuestos = detalle.reduce((s, d) => s + d.monto, 0);
  return { detalle, totalImpuestos, subtotalTotalARS, totalFinal: subtotalTotalARS + totalImpuestos };
}

module.exports = async (req, res) => {
  const authHeader = req.headers.authorization || '';
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  try {
    const today = todayStr();

    // ── 0. Generar débitos automáticos que correspondan a hoy ─────────────────
    let debitosResultado = { generados: [] };
    try {
      debitosResultado = await generarDebitosAutomaticos(today);
    } catch (e) {
      console.error('Error generando débitos automáticos:', e.message);
    }

    const { data: dataRes } = await supabase.from('finanzas_data').select('value').eq('key', 'fin_data').single();
    const { data: tcRes } = await supabase.from('finanzas_data').select('value').eq('key', 'fin_tc').single();
    const { data: tcCfgRes } = await supabase.from('finanzas_data').select('value').eq('key', 'fin_tc_config').single();
    const { data: subsRes } = await supabase.from('finanzas_data').select('value').eq('key', 'fin_push_subs').single();
    const { data: listasRes } = await supabase.from('finanzas_data').select('value').eq('key', 'fin_listas').single();
    const { data: tcRateRes } = await supabase.from('finanzas_data').select('value').eq('key', 'fin_tipo_cambio').single();
    const { data: tcImpRes } = await supabase.from('finanzas_data').select('value').eq('key', 'fin_tc_impuestos').single();

    const data = dataRes?.value || {};
    const tcData = tcRes?.value || {};
    const tcConfig = tcCfgRes?.value || {};
    const subs = subsRes?.value || {};
    const listas = listasRes?.value || {};
    const TARJETAS = listas.tarjetas || [];
    const tipoCambio = (tcRateRes?.value && tcRateRes.value.valor) || 1000;
    const tcImpuestos = tcImpRes?.value || {};

    // ── 1. Detalle de movimientos cargados HOY (ya incluye los débitos recién generados) ──
    const mkHoy = today.slice(0, 7);
    const txsHoy = (data[mkHoy] || []).filter(t => t.date === today);

    const MAX_ITEMS = 10;
    let seccionMovimientos = '';
    if (txsHoy.length > 0) {
      const items = txsHoy.slice(0, MAX_ITEMS).map(t => {
        const signo = t.type === 'income' ? '+' : '-';
        const tag = t.cargadoPor === 'Débito automático' ? '🔁 ' : '';
        const simbolo = (t.moneda || 'ARS') === 'USD' ? 'US$' : '$';
        return `${signo}${simbolo}${Math.round(t.amt).toLocaleString('es-AR')} ${tag}${t.desc}`;
      });
      if (txsHoy.length > MAX_ITEMS) {
        items.push(`… y ${txsHoy.length - MAX_ITEMS} más`);
      }
      seccionMovimientos = `📋 Hoy (${txsHoy.length}):\n${items.join('\n')}`;
    } else {
      seccionMovimientos = '📋 Hoy no se cargó ningún movimiento.';
    }

    // ── 1b. Débitos automáticos de tarjeta generados hoy (no aparecen en "Hoy" porque son consumos, no gastos reales) ──
    const debitosTarjetaHoy = debitosResultado.generados.filter(d => d.tipo === 'tarjeta');
    let seccionDebitosTarjeta = '';
    if (debitosTarjetaHoy.length > 0) {
      const items = debitosTarjetaHoy.map(d => {
        const simbolo = (d.moneda || 'ARS') === 'USD' ? 'US$' : '$';
        return `🔁 ${simbolo}${Math.round(d.monto).toLocaleString('es-AR')} ${d.desc} (${d.tarjeta})`;
      }).join('\n');
      seccionDebitosTarjeta = `\n\n💳 Débito automático en tarjeta:\n${items}`;
    }

    // ── 2. Vencimientos de tarjeta que caen HOY (con moneda e impuestos incluidos) ──
    const vencimientosHoy = [];
    TARJETAS.forEach(card => {
      const cfg = tcConfig[card] || { cierre: 20, venc: 10 };
      const [y, m, d] = today.split('-').map(Number);
      if (d !== cfg.venc) return;

      const mk = today.slice(0, 7);
      const pendientes = (tcData[card] || []).filter(t => !t.paid && (t.resumen || '').slice(0, 7) === mk);
      if (!pendientes.length) return;

      const subtotalARS = pendientes.filter(t => (t.moneda || 'ARS') === 'ARS').reduce((s, t) => s + t.amt, 0);
      const subtotalUSD = pendientes.filter(t => (t.moneda || 'ARS') === 'USD').reduce((s, t) => s + t.amt, 0);
      const calc = calcularImpuestosResumen(tcImpuestos, tipoCambio, card, subtotalARS, subtotalUSD);
      vencimientosHoy.push({ card, total: calc.totalFinal });
    });

    let seccionVencimientos = '';
    if (vencimientosHoy.length > 0) {
      const totalGeneral = vencimientosHoy.reduce((s, v) => s + v.total, 0);
      const detalle = vencimientosHoy.map(v => `${v.card}: ${fmt(v.total)}`).join(', ');
      seccionVencimientos = `\n\n💳 Venció hoy: ${detalle} (Total: ${fmt(totalGeneral)})`;
    }

    // ── 3. Revisar Gmail de todos los usuarios conectados ─────────────────────
    let gmailResultado = { conectados: [], nuevos: [] };
    let seccionGmail = '';
    try {
      gmailResultado = await revisarGmail();
      if (gmailResultado.nuevos.length > 0) {
        const porUsuario = {};
        gmailResultado.nuevos.forEach(n => {
          if (!porUsuario[n.usuario]) porUsuario[n.usuario] = [];
          porUsuario[n.usuario].push(n);
        });

        const bloques = Object.keys(porUsuario).map(usuario => {
          const items = porUsuario[usuario]
            .slice(0, 8)
            .map(n => `• ${n.de}: "${n.asunto}"`)
            .join('\n');
          return `📧 Gmail ${usuario} (${porUsuario[usuario].length}):\n${items}`;
        });

        seccionGmail = '\n\n' + bloques.join('\n\n');
      }
    } catch (e) {
      console.error('Error revisando Gmail:', e.message);
    }

    // Si no hay nada de nada, no molestamos con una notificación vacía
    if (txsHoy.length === 0 && vencimientosHoy.length === 0 && gmailResultado.nuevos.length === 0 && debitosTarjetaHoy.length === 0) {
      return res.status(200).json({ success: true, enviados: 0, mensaje: 'Sin novedades, no se envió notificación.' });
    }

    const titulo = vencimientosHoy.length > 0
      ? '📋 Resumen de hoy — 💳 Venció hoy'
      : '📋 Resumen de hoy';
    const cuerpo = seccionMovimientos + seccionDebitosTarjeta + seccionVencimientos + seccionGmail;

    // ── Enviar push a todos los dispositivos suscriptos ──────────────────────
    const endpoints = Object.keys(subs);
    let enviados = 0;
    let fallidos = 0;

    for (const endpoint of endpoints) {
      const { subscription } = subs[endpoint];
      try {
        await webpush.sendNotification(
          subscription,
          JSON.stringify({
            title: titulo,
            body: cuerpo,
            url: '/mobile.html',
          })
        );
        enviados++;
      } catch (err) {
        fallidos++;
        if (err.statusCode === 410 || err.statusCode === 404) {
          delete subs[endpoint];
        }
      }
    }

    if (fallidos > 0) {
      await supabase.from('finanzas_data').upsert({ key: 'fin_push_subs', value: subs }, { onConflict: 'key' });
    }

    return res.status(200).json({
      success: true,
      enviados,
      fallidos,
      txsHoy: txsHoy.length,
      debitosGenerados: debitosResultado.generados,
      vencimientosHoy,
      gmail: gmailResultado,
    });
  } catch (error) {
    console.error('Error en cron diario:', error);
    return res.status(500).json({ error: 'Error interno: ' + error.message });
  }
};
