// ── API SERVERLESS: Cargar gasto por VOZ (Google Home + IFTTT) ───────────────
// POST /api/voz
// Body: { token, texto }
//
// Ejemplo de texto: "supermercado 5000 de MP Sergio"
// El endpoint interpreta: descripción, monto, caja y categoría automáticamente.

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const API_TOKEN = process.env.API_TOKEN;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Listas de referencia (deben coincidir con las de la app) ─────────────────
// Valores por defecto (fallback si aún no existe 'fin_listas' en Supabase)
const DEFAULT_CUENTAS = ['Nación Vane', 'Galicia Vane', 'Galicia Sergio', 'ICBC Sergio', 'Efectivo Sergio', 'MP Sergio', 'Efectivo Vane', 'MP Vane'];
const DEFAULT_AHORROS = ['Ahorro (Bitcoins)', 'Ahorros (DAI)', 'Ahorros USD (Vane G)', 'Ahorros USD (Sergio)', 'Ahorros USD I', 'Ahorros $ I', 'Ahorros $ G', 'Ahorros Sergio IOL', 'Ahorros Pipi IOL'];
// TODAS_CUENTAS ya no es fija: se arma dinámicamente en cada request desde Supabase (ver handler)

// Palabras clave → categoría (ampliable)
const KEYWORD_CATEGORIA = {
  supermercado: 'Supermercado', super: 'Supermercado',
  nafta: 'Nafta', combustible: 'Nafta', gasolina: 'Nafta',
  farmacia: 'Farmacia', remedios: 'Farmacia',
  gimnasio: 'Gimnasio', gym: 'Gimnasio',
  peluqueria: 'Peluquería', peluquería: 'Peluquería',
  veterinaria: 'Veterinaria', vete: 'Veterinaria',
  cine: 'Cine', shopping: 'Shopping', regalo: 'Regalos', regalos: 'Regalos',
  colegio: 'Colegio', jardinero: 'Jardinero',
  seguro: 'Seguro Casa', patente: 'Patente', vtv: 'VTV',
  psico: 'Psico', psicologo: 'Psico', psicóloga: 'Psico',
  sube: 'SUBE', subte: 'SUBE', colectivo: 'SUBE',
  donacion: 'Donaciones', donación: 'Donaciones',
  osde: 'OSDE', prepaga: 'OSDE',
  alquiler: 'Alquiler', luz: 'Edenor Atardeceres', gas: 'Gas Sanfer',
  internet: 'Fibertel', telefono: 'Movistar - Ambos', teléfono: 'Movistar - Ambos',
};

// Palabras que no aportan al parseo, se descartan de la descripción
const STOPWORDS = ['gaste', 'gasté', 'gasto', 'ingreso', 'cargar', 'cargá', 'carga', 'hoy', 'el', 'dia', 'día', 'de', 'en', 'para', 'con', 'la', 'los', 'las'];

function normalizar(s) {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function parseTexto(texto, todasCuentas) {
  const original = texto.trim();
  const norm = normalizar(original);

  // ── Tipo: gasto o ingreso ──────────────────────────────────────────────────
  const tipo = /\bingreso\b/.test(norm) ? 'income' : 'gasto';

  // ── Monto: primera secuencia numérica ──────────────────────────────────────
  const montoMatch = original.match(/\d[\d.,]*\d|\d/);
  let amt = null;
  if (montoMatch) {
    const raw = montoMatch[0].replace(/[.,]/g, '');
    amt = parseInt(raw, 10);
  }

  // ── Caja: buscar el nombre de cuenta más largo que aparezca en el texto ────
  let caja = null;
  let cajaMatchStr = '';
  (todasCuentas || []).forEach(c => {
    const cNorm = normalizar(c);
    if (norm.includes(cNorm) && cNorm.length > cajaMatchStr.length) {
      caja = c;
      cajaMatchStr = cNorm;
    }
  });

  // ── Categoría: buscar palabra clave conocida ───────────────────────────────
  let categoria = tipo === 'income' ? 'Otros ingresos' : 'Otros gastos';
  for (const [kw, cat] of Object.entries(KEYWORD_CATEGORIA)) {
    if (norm.includes(normalizar(kw))) {
      categoria = cat;
      break;
    }
  }

  // ── Descripción: lo que queda después de sacar monto, caja y stopwords ─────
  let descWords = norm
    .replace(montoMatch ? montoMatch[0] : '', ' ')
    .replace(cajaMatchStr, ' ')
    .split(/\s+/)
    .filter(w => w && !STOPWORDS.includes(w));

  let desc = descWords.join(' ').trim();
  if (!desc) desc = categoria;
  desc = desc.charAt(0).toUpperCase() + desc.slice(1);

  return { tipo, amt, caja, categoria, desc };
}

function addMonthStr(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const { token, texto } = req.body || {};

  if (token !== API_TOKEN) {
    return res.status(401).json({ error: 'Token inválido' });
  }
  if (!texto || typeof texto !== 'string') {
    return res.status(400).json({ error: 'Falta el campo "texto"' });
  }

  try {
    // Cargar listas de cuentas actuales desde Supabase (dinámicas, no fijas)
    const { data: listasRes } = await supabase.from('finanzas_data').select('value').eq('key', 'fin_listas').single();
    const listas = listasRes?.value || {};
    const cuentas = listas.cuentas || DEFAULT_CUENTAS;
    const ahorros = listas.ahorros || DEFAULT_AHORROS;
    const todasCuentas = [...cuentas, ...ahorros];

    const parsed = parseTexto(texto, todasCuentas);

    if (!parsed.amt || parsed.amt <= 0) {
      return res.status(400).json({ error: 'No pude interpretar un monto en: "' + texto + '"' });
    }

    const date = todayStr();
    const mk = date.slice(0, 7);

    const { data: dataRes } = await supabase.from('finanzas_data').select('value').eq('key', 'fin_data').single();
    const { data: dispRes } = await supabase.from('finanzas_data').select('value').eq('key', 'fin_disp').single();

    let data = dataRes?.value || {};
    let dispData = dispRes?.value || {};

    if (!data[mk]) data[mk] = [];

    const entry = {
      id: Date.now() + Math.random(),
      type: parsed.tipo,
      desc: parsed.desc,
      cat: parsed.categoria,
      amt: parsed.amt,
      date,
      caja: parsed.caja,
      cargadoPor: 'Google Home',
      timestamp: new Date().toISOString(),
    };
    data[mk].push(entry);

    if (parsed.caja) {
      if (!dispData[parsed.caja]) dispData[parsed.caja] = 0;
      const delta = parsed.tipo === 'income' ? parsed.amt : -parsed.amt;
      dispData[parsed.caja] = parseFloat((dispData[parsed.caja] + delta).toFixed(2));
    }

    await supabase.from('finanzas_data').upsert({ key: 'fin_data', value: data }, { onConflict: 'key' });
    if (parsed.caja) {
      await supabase.from('finanzas_data').upsert({ key: 'fin_disp', value: dispData }, { onConflict: 'key' });
    }

    return res.status(200).json({
      success: true,
      message: `${parsed.tipo === 'income' ? 'Ingreso' : 'Gasto'} cargado: ${parsed.desc} $${parsed.amt}${parsed.caja ? ' (' + parsed.caja + ')' : ''}`,
      interpretado: parsed,
    });
  } catch (error) {
    console.error('Error en /api/voz:', error);
    return res.status(500).json({ error: 'Error interno: ' + error.message });
  }
};
