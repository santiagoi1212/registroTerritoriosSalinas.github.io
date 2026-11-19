// Google Apps Script del registro de territorios (WEBHOOK_URL en app-config.js,
// lo usa mapa.html). Pegar ENTERO en Código.gs del proyecto de Apps Script y
// desplegar como Nueva versión (Implementar > Administrar implementaciones >
// editar > Nueva versión) para que no cambie la URL.
//
// Planilla "Registro": A Capitán, B ID (manzana), C Fecha, D Momento del día,
// E Finalizado, F Observación.
// Planilla "Personales" (se crea sola la primera vez que se asigna uno):
// A Territorio, B Persona, C Desde, D Asignado por. El mapa pinta de violeta
// las manzanas de un territorio personal.

/************* CONFIG *************/
const SHEET_ID       = '1Ol0BrnbMsrA4GR26XO-53y11zhe0ios7fvjGVN9rI5Y';
const SHEET_REGISTRO = 'Registro';
const SHEET_PERSONALES = 'Personales';
const TZ             = 'America/Montevideo';
// mapa.html mira este número para saber si puede usar las operaciones nuevas
// (registrar_varios, personal_asignar, personal_quitar).
const VERSION_API    = 2;
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
  try { CacheService.getScriptCache().removeAll([CACHE_KEY_STATS, CACHE_KEY_REGISTROS]); } catch (e) {}
}

/* ======================= Territorios personales ======================= */
// [{ territorio, persona, desde: 'yyyy-MM-dd', asignadoPor }]
const CACHE_KEY_PERSONALES = 'personales';

function getPersonalesConCache_() {
  const cache = CacheService.getScriptCache();
  const guardado = cache.get(CACHE_KEY_PERSONALES);
  if (guardado) return JSON.parse(guardado);
  const lista = getPersonales_();
  try { cache.put(CACHE_KEY_PERSONALES, JSON.stringify(lista), CACHE_SEGUNDOS_STATS); } catch (e) {}
  return lista;
}

function hojaPersonales_(crear) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName(SHEET_PERSONALES);
  if (!sh && crear) {
    sh = ss.insertSheet(SHEET_PERSONALES);
    sh.appendRow(['Territorio', 'Persona', 'Desde', 'Asignado por']);
  }
  return sh;
}

function getPersonales_() {
  const sh = hojaPersonales_(false);
  if (!sh || sh.getLastRow() < 2) return [];
  const rango   = sh.getRange(2, 1, sh.getLastRow() - 1, 4);
  const display = rango.getDisplayValues();
  const valores = rango.getValues();
  const out = [];
  for (let i = 0; i < display.length; i++) {
    const territorio = String(display[i][0] || '').trim();
    if (!territorio) continue;
    const raw = valores[i][2];
    const f = (raw instanceof Date && !isNaN(raw.getTime())) ? raw : parsearFecha_(raw);
    out.push({
      territorio,
      persona: String(display[i][1] || '').trim(),
      desde: f ? Utilities.formatDate(f, TZ, 'yyyy-MM-dd') : '',
      asignadoPor: String(display[i][3] || '').trim()
    });
  }
  return out;
}

// Asigna (o reasigna) un territorio como personal; con persona vacía lo quita.
function setPersonal_(territorio, persona, user) {
  const t = String(territorio || '').trim();
  if (!t) throw new Error('Falta territorio');
  const sh = hojaPersonales_(true);
  const last = sh.getLastRow();
  if (last >= 2) {
    const col = sh.getRange(2, 1, last - 1, 1).getDisplayValues();
    // De abajo hacia arriba para que borrar no corra los índices
    for (let i = col.length - 1; i >= 0; i--) {
      if (String(col[i][0] || '').trim() === t) sh.deleteRow(2 + i);
    }
  }
  if (persona) sh.appendRow([t, persona, new Date(), String(user || '')]);
  SpreadsheetApp.flush();
  try { CacheService.getScriptCache().remove(CACHE_KEY_PERSONALES); } catch (e) {}
  return getPersonalesConCache_();
}

/* ======================= Historial para el S-13 ======================= */
// read=registros: TODOS los registros de la hoja (no solo el último de cada
// manzana), para armar las asignaciones del formulario S-13 en mapa.html.
// Cada fila: [capitán, id, fecha yyyy-MM-dd, finalizado].
const CACHE_KEY_REGISTROS = 'registros_s13';

function getRegistrosConCache_() {
  const cache = CacheService.getScriptCache();
  const guardado = cache.get(CACHE_KEY_REGISTROS);
  if (guardado) return JSON.parse(guardado);
  const filas = getRegistrosParaS13_();
  try { cache.put(CACHE_KEY_REGISTROS, JSON.stringify(filas), CACHE_SEGUNDOS_STATS); } catch (e) { /* >100KB: sin caché */ }
  return filas;
}

function getRegistrosParaS13_() {
  const reg = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_REGISTRO);
  if (!reg || reg.getLastRow() < 2) return [];
  const rango   = reg.getRange(2, 1, reg.getLastRow() - 1, 5);
  const display = rango.getDisplayValues();
  const valores = rango.getValues();
  const out = [];
  for (let i = 0; i < display.length; i++) {
    const id = canonId_(display[i][1]);
    if (!id) continue;
    const raw = valores[i][2];
    const f = (raw instanceof Date && !isNaN(raw.getTime())) ? raw : parsearFecha_(raw);
    if (!f) continue;
    out.push([
      String(display[i][0] || '').trim(),
      id,
      Utilities.formatDate(f, TZ, 'yyyy-MM-dd'),
      String(display[i][4] || '').trim()
    ]);
  }
  return out;
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

// Varias manzanas de una (botón "marcar todo el territorio como hecho"):
// mismas columnas que writeToRegistroColB_, en una sola inserción.
function writeVariosToRegistro_(d, ids) {
  const ss  = SpreadsheetApp.openById(SHEET_ID);
  const reg = ss.getSheetByName(SHEET_REGISTRO) || ss.insertSheet(SHEET_REGISTRO);
  ensureRegistroHeader_(reg);

  const f = (d.fecha && parsearFecha_(d.fecha)) || new Date();
  const turno = d.turno || 'Tarde';

  const filas = ids.map(id => [d.capitan || '', id, f, turno, d.finalizado || 'Si', d.comentario || '']);
  reg.insertRowsAfter(1, filas.length);
  reg.getRange(2, 1, filas.length, 6).setValues(filas);

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
        comentario:  String(display[i][5] || '').trim(),
        capitan:     String(display[i][0] || '').trim()
      };
    }
  }

  return Object.keys(counts).map(id => ({
    id,
    cantidad: counts[id],
    ultimaFecha: ultimo[id].ultimaFecha || '',
    finalizado: ultimo[id].finalizado,
    comentario: ultimo[id].comentario,
    capitan: ultimo[id].capitan
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

    // ✅ Varias manzanas juntas (todo el territorio hecho)
    if (op === 'registrar_varios') {
      const ids = (Array.isArray(obj.ids) ? obj.ids : []).map(canonId_).filter(Boolean);
      if (!ids.length) throw new Error('Faltan manzanas');
      if (ids.length > 300) throw new Error('Demasiadas manzanas');
      const d = parsePayload_({ parameter: { payload: JSON.stringify(Object.assign({}, obj, { id: ids[0] })) } });
      writeVariosToRegistro_(d, ids);
      return jsonOut_({ ok: true, registrados: ids.length });
    }

    // ✅ ADMIN: territorio personal
    if (op === 'personal_asignar' || op === 'personal_quitar') {
      if (!isAdmin_(obj.user, obj.role)) throw new Error('No autorizado');
      const persona = op === 'personal_asignar' ? String(obj.persona || '').trim() : '';
      if (op === 'personal_asignar' && !persona) throw new Error('Falta la persona');
      const personales = setPersonal_(obj.territorio, persona, obj.user);
      return jsonOut_({ ok: true, personales });
    }

    // Una op que no se conoce NO se guarda como registro (antes quedaba una fila sin ID)
    if (op) throw new Error('Operación desconocida: ' + op);

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
      // Las operaciones (op) van solo por POST; por GET solo se registra una manzana.
      let opGet = '';
      try { opGet = String(JSON.parse(p.payload).op || ''); } catch (x) {}
      if (opGet) throw new Error('Usá POST para la operación ' + opGet);
      const d = parsePayload_(e);
      writeToRegistroColB_(d);
      const cantidad = countIdInRegistroColB_(d.id);

      return jsonOut_({ ok: true, id: d.id, cantidad });
    }

    // ✅ registros (historial completo, para el formulario S-13)
    if (p.read === 'registros') {
      const out = { ok: true, registros: getRegistrosConCache_() };
      return p.callback ? jsonpOut_(p.callback, out) : jsonOut_(out);
    }

    // ✅ stats_rt
    if (p.read === 'stats_rt' || p.callback) {
      const items = getStatsConCache_();
      const out = { ok: true, version: VERSION_API, items, personales: getPersonalesConCache_() };
      return p.callback ? jsonpOut_(p.callback, out) : jsonOut_(out);
    }

    // 👇 CAMBIO: sin parámetros conocidos → devolver stats igualmente
    const items = getStatsConCache_();
    return jsonOut_({ ok: true, version: VERSION_API, items, personales: getPersonalesConCache_() });

  } catch (err) {
    return jsonOut_({ ok: false, error: String(err && err.message || err) });
  }
}
