// Google Apps Script del registro de territorios (WEBHOOK_URL en app-config.js,
// lo usa mapa.html). Pegar ENTERO en Código.gs del proyecto de Apps Script y
// desplegar como Nueva versión (Implementar > Administrar implementaciones >
// editar > Nueva versión) para que no cambie la URL.
//
// Planilla "Registro": A Capitán, B ID (manzana), C Fecha, D Momento del día,
// E Finalizado, F Observación.

/************* CONFIG *************/
const SHEET_ID       = '1Ol0BrnbMsrA4GR26XO-53y11zhe0ios7fvjGVN9rI5Y';
const SHEET_REGISTRO = 'Registro';
const TZ             = 'America/Montevideo';
/**********************************/

/* ======================= Caché de stats_rt ======================= */
// El mapa pide stats_rt cada vez que se abre; armarlo lee toda la hoja
// "Registro". Se guarda ya armado y cualquier escritura/borrado lo invalida,
// así que un registro nuevo se ve en la próxima carga igual que antes.
const CACHE_KEY_STATS = 'stats_rt';
const CACHE_SEGUNDOS_STATS = 3600;

function getStatsConCache_() {
  const cache = CacheService.getScriptCache();
  const guardado = cache.get(CACHE_KEY_STATS);
  if (guardado) return JSON.parse(guardado);
  const items = getStatsFromRegistroColB_();
  try { cache.put(CACHE_KEY_STATS, JSON.stringify(items), CACHE_SEGUNDOS_STATS); } catch (e) { /* >100KB: sin caché */ }
  return items;
}

function invalidarStats_() {
  try { CacheService.getScriptCache().remove(CACHE_KEY_STATS); } catch (e) {}
}

/* ======================= ID canónico ======================= */
/**
 * Canoniza IDs sin “romperlos”:
 * - Mantiene letras, |, -, etc.
 * - Normaliza espacios alrededor de | y -
 * - Colapsa múltiples espacios
 *
 * EJ:
 *  "1007 | 142" -> "1007|142"
 *  "304 - A"    -> "304-A"
 *  "151B|38"    -> "151B|38"
 */
function canonId_(x) {
  return String(x ?? '')
    .trim()
    .replace(/\s*\|\s*/g, '|')
    .replace(/\s*-\s*/g, '-')   // si querés mantener espacios "304 - A", comentá esta línea
    .replace(/\s+/g, ' ');
}

// mapa.html antes le agregaba " | Manzana: X" al comentario; la manzana ya
// está en la columna B, así que en Observación se guarda sin ese sufijo.
function limpiarComentario_(c) {
  return String(c || '').replace(/\s*\|\s*Manzana:.*$/i, '').trim();
}

// "2026-09-26" (lo que manda un <input type="date">) con new Date() se
// interpreta como medianoche UTC = el día ANTERIOR en Montevideo. Se arma
// la fecha local a mano; cualquier otro formato sigue usando new Date().
function parsearFecha_(s) {
  const str = String(s || '').trim();
  let m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  const tmp = new Date(str);
  return isNaN(tmp) ? null : tmp;
}

/* ======================= Parse payload ======================= */
function parsePayload_(e) {
  const p = (e && e.parameter) || {};
  const raw = (p.payload) || (e && e.postData && e.postData.contents) || '';
  if (!raw) throw new Error('Sin payload');

  const o = JSON.parse(raw);

  o.id      = canonId_(o.id);
  o.capitan = String(o.capitan || '').trim();
  // mapa.html manda "finalizado" (Si/No); "estado" queda por compatibilidad.
  o.finalizado = String(o.finalizado || o.estado || '').trim();
  o.comentario = limpiarComentario_(o.comentario);
  o.turno   = String(o.turno || '').trim();
  o.fecha   = String(o.fecha || '').trim();
  o.origen  = String(o.origen || '').trim();

  // ts_server siempre
  const now = new Date();
  o.ts_server = o.ts_server ? new Date(o.ts_server) : now;

  return o;
}

/* ======================= Escritura Registro ======================= */
function ensureRegistroHeader_(reg) {
  if (reg.getLastRow() === 0) {
    // Header mínimo (no rompe tu planilla si ya existía)
    reg.appendRow(['Hermano Capitán/Precursor','ID','Fecha','Momento del dia','Finalizado','Observación']);
  }
}

// Escribe en fila 2 y SIEMPRE pone el ID en columna B
function writeToRegistroColB_(d) {
  const ss  = SpreadsheetApp.openById(SHEET_ID);
  const reg = ss.getSheetByName(SHEET_REGISTRO) || ss.insertSheet(SHEET_REGISTRO);

  ensureRegistroHeader_(reg);

  // Fecha
  let f = d.fecha ? parsearFecha_(d.fecha) : null;
  if (!f && d.ts_server instanceof Date && !isNaN(d.ts_server)) f = d.ts_server;
  if (!f) f = new Date();

  const turno = d.turno || 'Tarde';

  // Insertar fila 2
  reg.insertRowsAfter(1, 1);

  // A: capitan, B: ID (SIEMPRE), C: fecha, D: turno, E: finalizado, F: observación
  // (una sola escritura en vez de una por celda)
  reg.getRange(2, 1, 1, 6).setValues([[
    d.capitan || '',
    d.id || '',          // 🔴 ID EN COLUMNA B
    f,
    turno,
    d.finalizado || '',
    d.comentario || ''
  ]]);

  SpreadsheetApp.flush();
  invalidarStats_();
}

/* ======================= Conteo / stats por columna B ======================= */
function countIdInRegistroColB_(needle) {
  const id = canonId_(needle);
  if (!id) return 0;

  const ss  = SpreadsheetApp.openById(SHEET_ID);
  const reg = ss.getSheetByName(SHEET_REGISTRO);
  if (!reg) return 0;

  const lastRow = reg.getLastRow();
  if (lastRow < 2) return 0;

  // Columna B desde fila 2
  const vals = reg.getRange(2, 2, lastRow - 1, 1).getDisplayValues();

  let count = 0;
  for (let i = 0; i < vals.length; i++) {
    if (canonId_(vals[i][0]) === id) count++;
  }
  return count;
}

/**
 * Devuelve, por cada ID de la columna B, la cantidad total de registros y,
 * del ÚLTIMO registro: fecha (C), finalizado (E) y observación (F).
 * mapa.html pinta de azul las manzanas cuyo último registro quedó con
 * Finalizado = "No" y muestra la observación al pasar el mouse.
 *
 * Como writeToRegistroColB_ siempre inserta en la fila 2 (arriba de todo),
 * la PRIMERA vez que aparece un ID recorriendo la planilla de arriba hacia
 * abajo corresponde, justamente, a su registro más reciente.
 */
function getStatsFromRegistroColB_() {
  const ss  = SpreadsheetApp.openById(SHEET_ID);
  const reg = ss.getSheetByName(SHEET_REGISTRO);
  if (!reg) return [];

  const lastRow = reg.getLastRow();
  if (lastRow < 2) return [];

  // A..F en una sola lectura: display (para ID/textos) y valores (para la fecha real)
  const rango      = reg.getRange(2, 1, lastRow - 1, 6);
  const display    = rango.getDisplayValues();
  const valores    = rango.getValues();

  const counts = Object.create(null);
  const ultimo = Object.create(null); // id -> { ultimaFecha, finalizado, comentario }

  for (let i = 0; i < display.length; i++) {
    const id = canonId_(display[i][1]);
    if (!id) continue;

    counts[id] = (counts[id] || 0) + 1;

    // Sólo la PRIMERA vez que vemos este id (= el registro más reciente)
    if (!(id in ultimo)) {
      const raw = valores[i][2];
      let fechaISO = '';
      if (raw instanceof Date && !isNaN(raw.getTime())) {
        fechaISO = Utilities.formatDate(raw, TZ, 'yyyy-MM-dd');
      } else if (raw) {
        const tmp = parsearFecha_(raw);
        if (tmp) fechaISO = Utilities.formatDate(tmp, TZ, 'yyyy-MM-dd');
      }

      ultimo[id] = {
        ultimaFecha: fechaISO,
        finalizado:  String(display[i][4] || '').trim(),
        comentario:  String(display[i][5] || '').trim()
      };
    }
  }

  return Object.keys(counts).map(id => ({
    id,
    cantidad: counts[id],
    ultimaFecha: ultimo[id].ultimaFecha || '',
    finalizado: ultimo[id].finalizado,
    comentario: ultimo[id].comentario
  }));
}

/* ======================= Admin helpers ======================= */
/**
 * ⚠️ Seguridad:
 * - No confíes solo en `role` que viene del cliente (se puede falsificar).
 * - Acá validamos por username en lista + fallback por role.
 * - Ideal: validar contra tu sistema real de auth (si querés luego lo integramos).
 */
function isAdmin_(user, role) {
  const u = String(user || '').trim().toLowerCase();
  const r = String(role || '').trim().toLowerCase();

  // ✅ Poné acá los usernames reales de Admin
  const ADMINS = [
    'sinchausti',
    'santiagoi1212',
    'santiago'
  ];

  if (ADMINS.includes(u)) return true;
  return r === 'admin'; // fallback (menos seguro)
}

/**
 * Devuelve la fila del "registro más reciente" para ese ID.
 * Como insertás siempre en fila 2, la primera coincidencia de arriba es la más reciente.
 */
function findLastRegistroRowById_(needleId) {
  const id = canonId_(needleId);
  if (!id) return { exists: false };

  const ss  = SpreadsheetApp.openById(SHEET_ID);
  const reg = ss.getSheetByName(SHEET_REGISTRO);
  if (!reg) return { exists: false };

  const lastRow = reg.getLastRow();
  if (lastRow < 2) return { exists: false };

  // Columna B desde fila 2
  const vals = reg.getRange(2, 2, lastRow - 1, 1).getDisplayValues();

  for (let i = 0; i < vals.length; i++) {
    if (canonId_(vals[i][0]) === id) {
      const row = 2 + i;
      return { exists: true, row: row };
    }
  }
  return { exists: false };
}

function getRegistroRecord_(row) {
  const ss  = SpreadsheetApp.openById(SHEET_ID);
  const reg = ss.getSheetByName(SHEET_REGISTRO);
  if (!reg) return null;

  // A capitan, B id, C fecha, D turno, E finalizado, F observación
  const a = reg.getRange(row, 1, 1, 6).getDisplayValues()[0];
  return {
    capitan: a[0],
    id: a[1],
    fecha: a[2],
    turno: a[3],
    estado: a[4],      // mismo valor que "finalizado" (nombre viejo, por compatibilidad)
    finalizado: a[4],
    comentario: a[5],
    row: row
  };
}

/* ======================= Output helpers (JSON/JSONP) ======================= */
function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonpOut_(callback, obj) {
  const payload = JSON.stringify(obj);
  return ContentService
    .createTextOutput(String(callback) + '(' + payload + ')')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

/* ======================= WebApp endpoints ======================= */
function doPost(e) {
  try {
    const p = (e && e.parameter) || {};
    const raw = (p.payload) || (e && e.postData && e.postData.contents) || '';
    if (!raw) throw new Error('Sin payload');

    const obj = JSON.parse(raw);
    const op = String(obj.op || '').trim();

    // ✅ ADMIN: delete_last
    if (op === 'delete_last') {
      const id   = canonId_(obj.id);
      const user = obj.user;
      const role = obj.role;

      if (!id) throw new Error('Falta id');
      if (!isAdmin_(user, role)) throw new Error('No autorizado');

      const hit = findLastRegistroRowById_(id);
      if (!hit.exists) {
        return jsonOut_({ ok: true, deleted: false, reason: 'no_exists', id });
      }

      const before = getRegistroRecord_(hit.row);

      const ss  = SpreadsheetApp.openById(SHEET_ID);
      const reg = ss.getSheetByName(SHEET_REGISTRO);
      reg.deleteRow(hit.row);
      invalidarStats_();

      return jsonOut_({ ok: true, deleted: true, id, record: before });
    }

    // ✅ Default: guardar como antes
    const d = parsePayload_({ parameter: { payload: raw }, postData: (e && e.postData) });

    // 1) guardar
    writeToRegistroColB_(d);

    // 2) devolver conteo ya con el +1 aplicado
    const cantidad = countIdInRegistroColB_(d.id);

    return jsonOut_({ ok: true, id: d.id, cantidad });

  } catch (err) {
    return jsonOut_({ ok: false, error: String(err && err.message || err) });
  }
}

function doGet(e) {
  try {
    const p = (e && e.parameter) || {};

    // ✅ ADMIN: op=last&id=...
    if (String(p.op || '') === 'last') {
      const id = canonId_(p.id);
      if (!id) {
        const out = { ok: false, error: 'Falta id' };
        return p.callback ? jsonpOut_(p.callback, out) : jsonOut_(out);
      }

      const hit = findLastRegistroRowById_(id);
      if (!hit.exists) {
        const out = { ok: true, exists: false, id };
        return p.callback ? jsonpOut_(p.callback, out) : jsonOut_(out);
      }

      const record = getRegistroRecord_(hit.row);
      const out = { ok: true, exists: true, id, record };
      return p.callback ? jsonpOut_(p.callback, out) : jsonOut_(out);
    }

    // ✅ Registrar también por GET si viene payload (igual que antes)
    if (p.payload) {
      const d = parsePayload_(e);
      writeToRegistroColB_(d);
      const cantidad = countIdInRegistroColB_(d.id);

      return jsonOut_({ ok: true, id: d.id, cantidad });
    }

    // ✅ stats_rt
    if (p.read === 'stats_rt' || p.callback) {
      const items = getStatsConCache_();
      const out = { ok: true, items };
      return p.callback ? jsonpOut_(p.callback, out) : jsonOut_(out);
    }

    // 👇 CAMBIO: sin parámetros conocidos → devolver stats igualmente
    const items = getStatsConCache_();
    return jsonOut_({ ok: true, items });

  } catch (err) {
    return jsonOut_({ ok: false, error: String(err && err.message || err) });
  }
}
