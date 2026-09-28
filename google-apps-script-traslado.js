// Google Apps Script de Traslado (TRASLADO_API_URL en app-config.js; lo usan
// traslado.html y transporte.html).
//
// Guarda cada cosa en su propia pestaña, con columnas legibles:
//   "Pedidos"        -> quienes NECESITAN lugar       (tipo 'transporte')
//   "Ofrecimientos"  -> quienes OFRECEN lugares       (tipo 'vehiculo')
//   "Asignaciones"   -> quién lleva a quién, por reunión (tipo 'asignacion')
// Las pestañas y sus encabezados se crean solos la primera vez.
//
// Hacia las páginas responde EXACTAMENTE igual que el script anterior (una
// lista de registros {id, nombre, tipo, asientos, grupo, timestamp}), así no
// hubo que reescribir su lógica.
//
// INSTALACIÓN
// 1. Crear una planilla nueva (ej. "Traslado Salinas") > Extensiones > Apps Script.
// 2. Pegar este archivo entero en Código.gs y guardar.
// 3. (Una sola vez) elegir "migrarDesdeScriptAnterior" en el desplegable y
//    Ejecutar: copia a las pestañas nuevas todo lo que ya estaba cargado.
// 4. Implementar > Nueva implementación > Aplicación web
//      Ejecutar como: Yo   ·   Quién tiene acceso: Cualquier persona
//    y copiar la URL /exec en TRASLADO_API_URL de app-config.js.

const HOJA_PEDIDOS       = 'Pedidos';
const HOJA_OFRECIMIENTOS = 'Ofrecimientos';
const HOJA_ASIGNACIONES  = 'Asignaciones';
const TZ = 'America/Montevideo';

// Script anterior (una sola hoja mezclada), solo para migrarDesdeScriptAnterior().
const URL_SCRIPT_ANTERIOR = 'https://script.google.com/macros/s/AKfycbxR_oIF9-XTlQMwUydFAAAhbho6jx0tmJBYhq47ARVRQSur6Rfa7s8LuFYRT0SL1bvX/exec';

const ENCABEZADOS = {
  [HOJA_PEDIDOS]:       ['ID', 'Nombre', 'Grupo', 'Asientos que necesita', 'Registrado'],
  [HOJA_OFRECIMIENTOS]: ['ID', 'Nombre', 'Grupo', 'Asientos que ofrece', 'Registrado'],
  [HOJA_ASIGNACIONES]:  ['ID', 'Reunión', 'Pasajero', 'Conductor', 'Asientos', 'ID pedido', 'ID vehículo', 'Registrado'],
};

// Las páginas consultan cada 6s mientras están abiertas: se cachea la lista
// armada y cualquier alta/baja la borra.
const CACHE_KEY = 'traslado_registros';
const CACHE_SEGUNDOS = 300;

/* ======================= Hojas ======================= */
function hoja_(nombre) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let h = ss.getSheetByName(nombre);
  if (!h) h = ss.insertSheet(nombre);
  if (h.getLastRow() === 0) {
    h.appendRow(ENCABEZADOS[nombre]);
    h.getRange(1, 1, 1, ENCABEZADOS[nombre].length).setFontWeight('bold');
    h.setFrozenRows(1);
  }
  return h;
}

function filas_(nombre) {
  const h = hoja_(nombre);
  const last = h.getLastRow();
  if (last < 2) return [];
  return h.getRange(2, 1, last - 1, ENCABEZADOS[nombre].length).getValues();
}

function fechaIso_(v) {
  if (v instanceof Date && !isNaN(v)) return v.toISOString();
  return v ? String(v) : '';
}

/* ======================= Lectura (formato de siempre) ======================= */
function listarRegistros_() {
  const out = [];

  filas_(HOJA_PEDIDOS).forEach(f => {
    if (!f[0]) return;
    out.push({ id: String(f[0]), nombre: String(f[1]), tipo: 'transporte', grupo: f[2], asientos: Number(f[3]) || 0, timestamp: fechaIso_(f[4]) });
  });

  filas_(HOJA_OFRECIMIENTOS).forEach(f => {
    if (!f[0]) return;
    out.push({ id: String(f[0]), nombre: String(f[1]), tipo: 'vehiculo', grupo: f[2], asientos: Number(f[3]) || 0, timestamp: fechaIso_(f[4]) });
  });

  // Las páginas esperan la asignación "empaquetada" como antes:
  // nombre = "idPedido|reunión|Pasajero → Conductor", grupo = idVehículo.
  filas_(HOJA_ASIGNACIONES).forEach(f => {
    if (!f[0]) return;
    const reunion = f[1] instanceof Date ? Utilities.formatDate(f[1], TZ, 'yyyy-MM-dd') : String(f[1]);
    out.push({
      id: String(f[0]),
      nombre: `${f[5]}|${reunion}|${f[2]} → ${f[3]}`,
      tipo: 'asignacion',
      asientos: Number(f[4]) || 0,
      grupo: String(f[6]),
      timestamp: fechaIso_(f[7]),
    });
  });

  return out;
}

function listarConCache_() {
  const cache = CacheService.getScriptCache();
  const guardado = cache.get(CACHE_KEY);
  if (guardado) return JSON.parse(guardado);
  const lista = listarRegistros_();
  try { cache.put(CACHE_KEY, JSON.stringify(lista), CACHE_SEGUNDOS); } catch (e) { /* >100KB: sin caché */ }
  return lista;
}

/* ======================= Escritura ======================= */
function agregar_(r) {
  const id = String(r.id || '').trim();
  if (!id) throw new Error('Falta id');
  const ahora = r.timestamp ? new Date(r.timestamp) : new Date();
  const tipo = String(r.tipo || '');

  if (tipo === 'transporte' || tipo === 'vehiculo') {
    const nombre = String(r.nombre || '').trim();
    const asientos = Number(r.asientos) || 0;
    if (!nombre) throw new Error('Falta el nombre');
    if (asientos < 1) throw new Error('Cantidad de asientos inválida');
    hoja_(tipo === 'transporte' ? HOJA_PEDIDOS : HOJA_OFRECIMIENTOS)
      .appendRow([id, nombre, r.grupo || '', asientos, ahora]);
    return;
  }

  if (tipo === 'asignacion') {
    // nombre llega como "idPedido|reunión|Pasajero → Conductor"
    const partes = String(r.nombre || '').split('|');
    const pedidoId = partes[0] || '';
    const reunion = partes[1] || '';
    const texto = partes.slice(2).join('|');
    const [pasajero, conductor] = texto.split('→').map(s => (s || '').trim());
    hoja_(HOJA_ASIGNACIONES).appendRow([
      id, reunion, pasajero || '', conductor || '', Number(r.asientos) || 0, pedidoId, String(r.grupo || ''), ahora,
    ]);
    return;
  }

  throw new Error('Tipo desconocido: ' + tipo);
}

// Cambia nombre / grupo / asientos de un pedido u ofrecimiento existente
// (por ID) sin borrarlo — así no se pierden sus asignaciones (borrar un
// pedido o vehículo borra también sus asignaciones, ver eliminar_).
function actualizar_(r) {
  var id = String(r.id || '').trim();
  if (!id) throw new Error('Falta id');
  var hojas = [HOJA_PEDIDOS, HOJA_OFRECIMIENTOS];
  for (var k = 0; k < hojas.length; k++) {
    var h = hoja_(hojas[k]);
    var filas = filas_(hojas[k]);
    for (var i = 0; i < filas.length; i++) {
      if (String(filas[i][0]) !== id) continue;
      if (r.nombre != null && String(r.nombre).trim()) h.getRange(i + 2, 2).setValue(String(r.nombre).trim());
      if (r.grupo != null && String(r.grupo).trim()) h.getRange(i + 2, 3).setValue(r.grupo);
      if (r.asientos != null) {
        var n = Number(r.asientos);
        if (!(n >= 1)) throw new Error('Cantidad de asientos inválida');
        h.getRange(i + 2, 4).setValue(n);
      }
      return true;
    }
  }
  throw new Error('No se encontró el registro ' + id);
}

// Borra por ID en cualquiera de las tres pestañas. Si se borra un pedido o
// un vehículo, también se borran sus asignaciones (si no, quedarían
// asignaciones apuntando a algo que ya no existe).
function eliminar_(id) {
  id = String(id || '').trim();
  if (!id) throw new Error('Falta id');
  let borradas = 0;

  [HOJA_PEDIDOS, HOJA_OFRECIMIENTOS, HOJA_ASIGNACIONES].forEach(nombre => {
    const h = hoja_(nombre);
    const filas = filas_(nombre);
    for (let i = filas.length - 1; i >= 0; i--) {
      const f = filas[i];
      const coincide = String(f[0]) === id ||
        (nombre === HOJA_ASIGNACIONES && (String(f[5]) === id || String(f[6]) === id));
      if (coincide) { h.deleteRow(i + 2); borradas++; }
    }
  });
  return borradas;
}

/* ======================= Endpoints ======================= */
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  try {
    return json_(listarConCache_());
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000); // dos altas/bajas a la vez no se pisan
    const data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    let resultado;
    if (data.action === 'add') {
      agregar_(data);
      resultado = { ok: true };
    } else if (data.action === 'update') {
      actualizar_(data);
      resultado = { ok: true };
    } else if (data.action === 'delete') {
      resultado = { ok: true, borradas: eliminar_(data.id) };
    } else {
      resultado = { ok: false, error: 'Acción desconocida' };
    }
    CacheService.getScriptCache().remove(CACHE_KEY);
    return json_(resultado);
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

/* ======================= Migración (una sola vez, a mano) ======================= */
// Trae todo lo que devuelve el script anterior y lo reparte en las pestañas
// nuevas. Saltea los IDs que ya estén copiados, así que correrlo dos veces
// no duplica nada. Mirá el "Registro de ejecución" para ver el resumen.
function migrarDesdeScriptAnterior() {
  const res = UrlFetchApp.fetch(URL_SCRIPT_ANTERIOR + '?t=' + Date.now(), { muteHttpExceptions: true, followRedirects: true });
  if (res.getResponseCode() !== 200) throw new Error('El script anterior respondió ' + res.getResponseCode() + '. Probá de nuevo en un rato.');
  const registros = JSON.parse(res.getContentText());
  if (!Array.isArray(registros)) throw new Error('Respuesta inesperada del script anterior');

  const existentes = new Set(listarRegistros_().map(r => r.id));
  const cuenta = { transporte: 0, vehiculo: 0, asignacion: 0, salteados: 0, errores: 0 };

  registros.forEach(r => {
    if (existentes.has(String(r.id))) { cuenta.salteados++; return; }
    try {
      agregar_(r);
      cuenta[r.tipo] = (cuenta[r.tipo] || 0) + 1;
    } catch (err) {
      cuenta.errores++;
      Logger.log('No se pudo migrar ' + JSON.stringify(r) + ': ' + err);
    }
  });

  CacheService.getScriptCache().remove(CACHE_KEY);
  Logger.log('Migración: ' + cuenta.transporte + ' pedidos, ' + cuenta.vehiculo + ' ofrecimientos, ' +
    cuenta.asignacion + ' asignaciones · ' + cuenta.salteados + ' ya estaban · ' + cuenta.errores + ' con error');
}
