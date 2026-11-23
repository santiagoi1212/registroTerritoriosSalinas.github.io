// Google Apps Script de la Votación Atalaya (VOTACION_ATALAYA_API_URL en
// app-config.js; lo usa votacion-atalaya/index.html, página pública).
//
// Cada persona pone su nombre y apellido y ordena los 4 candidatos del 1º al
// 4º. El resultado se calcula por puntos (conteo Borda):
//   1º lugar = 4 puntos · 2º = 3 · 3º = 2 · 4º = 1
// Gana el que suma más puntos; si empatan, desempata quien tiene más votos en
// 1º lugar, después más en 2º, y así.
//
// Un voto por nombre: si el mismo nombre (sin importar mayúsculas ni tildes)
// vuelve a votar, se rechaza.
//
// INSTALACIÓN
// 1. Crear una planilla nueva (ej. "Votación Atalaya") > Extensiones > Apps Script.
// 2. Pegar este archivo entero en Código.gs y guardar.
// 3. Implementar > Nueva implementación > Aplicación web
//      Ejecutar como: Yo   ·   Quién tiene acceso: Cualquier persona
//    y copiar la URL /exec en VOTACION_ATALAYA_API_URL de app-config.js.
//
// Para cerrar la votación: poner VOTACION_ABIERTA = false y desplegar
// "Nueva versión" (los resultados y la lista se siguen viendo).

const CANDIDATOS = ['Gastón Gerschuni', 'Lucas Avilés', 'Juan Carlos Haristoy', 'Camilo Urdiozola'];
const VOTACION_ABIERTA = true;
const HOJA_VOTOS = 'Votos';
const TZ = 'America/Montevideo';
const ENCABEZADOS = ['Registrado', 'Nombre', '1º', '2º', '3º', '4º'];

const CACHE_KEY = 'votacion_atalaya';
const CACHE_SEGUNDOS = 300;

function hoja_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let h = ss.getSheetByName(HOJA_VOTOS);
  if (!h) h = ss.insertSheet(HOJA_VOTOS);
  if (h.getLastRow() === 0) {
    h.appendRow(ENCABEZADOS);
    h.getRange(1, 1, 1, ENCABEZADOS.length).setFontWeight('bold');
    h.setFrozenRows(1);
  }
  return h;
}

function filas_() {
  const h = hoja_();
  const last = h.getLastRow();
  if (last < 2) return [];
  return h.getRange(2, 1, last - 1, ENCABEZADOS.length).getValues().filter(f => f[1]);
}

function normalizar_(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

function armarEstado_() {
  const filas = filas_();
  const puntos = {}, posiciones = {};
  CANDIDATOS.forEach(c => { puntos[c] = 0; posiciones[c] = [0, 0, 0, 0]; });

  const votantes = filas.map(f => {
    for (let i = 0; i < 4; i++) {
      const c = String(f[2 + i]);
      if (puntos[c] === undefined) continue;
      puntos[c] += 4 - i;
      posiciones[c][i]++;
    }
    const fecha = f[0] instanceof Date ? f[0].toISOString() : String(f[0] || '');
    return { nombre: String(f[1]), fecha: fecha };
  });

  const ranking = CANDIDATOS.map(c => ({ nombre: c, puntos: puntos[c], posiciones: posiciones[c] }))
    .sort((a, b) => {
      if (b.puntos !== a.puntos) return b.puntos - a.puntos;
      for (let i = 0; i < 4; i++) if (b.posiciones[i] !== a.posiciones[i]) return b.posiciones[i] - a.posiciones[i];
      return a.nombre.localeCompare(b.nombre, 'es');
    });

  votantes.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  return { ok: true, abierta: VOTACION_ABIERTA, candidatos: CANDIDATOS, totalVotos: filas.length, ranking: ranking, votantes: votantes };
}

function estado_() {
  const cache = CacheService.getScriptCache();
  const guardado = cache.get(CACHE_KEY);
  if (guardado) return JSON.parse(guardado);
  const est = armarEstado_();
  try { cache.put(CACHE_KEY, JSON.stringify(est), CACHE_SEGUNDOS); } catch (e) {}
  return est;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return json_(estado_());
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!VOTACION_ABIERTA) return json_({ ok: false, error: 'La votación está cerrada.' });

    const nombre = String(data.nombre || '').replace(/\s+/g, ' ').trim();
    if (nombre.length < 3 || nombre.indexOf(' ') < 0) return json_({ ok: false, error: 'Poné tu nombre y apellido.' });
    if (nombre.length > 80) return json_({ ok: false, error: 'El nombre es demasiado largo.' });

    const orden = Array.isArray(data.orden) ? data.orden.map(String) : [];
    const valido = orden.length === 4 && CANDIDATOS.every(c => orden.indexOf(c) >= 0);
    if (!valido) return json_({ ok: false, error: 'Ordená a los 4 hermanos del 1º al 4º.' });

    const clave = normalizar_(nombre);
    if (filas_().some(f => normalizar_(f[1]) === clave)) {
      return json_({ ok: false, error: 'Ya hay un voto registrado con ese nombre.' });
    }

    hoja_().appendRow([new Date(), nombre].concat(orden));
    CacheService.getScriptCache().remove(CACHE_KEY);
    return json_(Object.assign(armarEstado_(), { votoRegistrado: true }));
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}
