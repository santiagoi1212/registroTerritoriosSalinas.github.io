// Google Apps Script de las VOTACIONES (una sola planilla, una pestaña por votación).
// Lo usan dos páginas públicas:
//   votacion-atalaya/index.html        -> VOTACION_ATALAYA_API_URL       (pestaña "Votos")
//   votacion-conmemoracion/index.html  -> VOTACION_CONMEMORACION_API_URL (pestaña "Conmemoración 2027")
// Las dos variables de app-config.js apuntan a la MISMA URL /exec; la página
// de la Conmemoración agrega ?v=conmemoracion (y "votacion" en el POST). Sin
// parámetro, responde la Votación Atalaya (así sigue andando como antes).
//
// - Atalaya: cada uno ordena a los 4 hermanos del 1º al 4º. Puntos (Borda):
//   1º = 4 · 2º = 3 · 3º = 2 · 4º = 1. Empate: más votos en 1º, después en 2º…
// - Conmemoración: cada uno elige UN solo hermano. Gana el que tiene más votos.
// En las dos: un voto por nombre (sin importar mayúsculas ni tildes).
//
// INSTALACIÓN / ACTUALIZACIÓN
// 1. En la planilla "Votación Atalaya" > Extensiones > Apps Script.
// 2. Reemplazar todo Código.gs por este archivo y guardar.
// 3. Implementar > Gestionar implementaciones > ✏️ > Versión: Nueva versión > Implementar
//    (Ejecutar como: Yo · Quién tiene acceso: Cualquier persona). La URL no cambia.
// La pestaña "Conmemoración 2027" se crea sola con el primer voto o consulta.
//
// Para cerrar una votación: poner abierta: false en VOTACIONES y desplegar
// "Nueva versión" (los resultados y la lista se siguen viendo).

const VOTACIONES = {
  atalaya: {
    tipo: 'orden',
    hoja: 'Votos',
    abierta: true,
    candidatos: ['Gastón Gerschuni', 'Lucas Avilés', 'Juan Carlos Haristoy', 'Camilo Urdiozola'],
    encabezados: ['Registrado', 'Nombre', '1º', '2º', '3º', '4º'],
  },
  conmemoracion: {
    tipo: 'unico',
    hoja: 'Conmemoración 2027',
    abierta: true,
    candidatos: [
      'Gonzalo Valle', 'Lucas Avilés', 'Carlos Carminati', 'Javier Martínez',
      'Gastón Gerschuni', 'Camilo Urdiozola', 'Julio Fernández', 'Julio Galarza',
      'Juan Carlos Haristoy', 'Luis López', 'Xavier Xaubet'
    ],
    encabezados: ['Registrado', 'Nombre', 'Voto'],
  },
};

// Caché corta: las páginas consultan cada 30 s. Además se borra sola al editar
// la planilla a mano (onEdit) y se puede borrar con limpiarCache().
const CACHE_SEGUNDOS = 15;
const cacheKey_ = id => 'votacion_' + id;

function limpiarCache() {
  CacheService.getScriptCache().removeAll(Object.keys(VOTACIONES).map(cacheKey_));
}

// Se ejecuta sola cuando alguien edita la planilla (ej. borrar un voto de prueba).
function onEdit() {
  limpiarCache();
}

function votacion_(id) {
  const key = VOTACIONES[id] ? id : 'atalaya';
  return Object.assign({ id: key }, VOTACIONES[key]);
}

function hoja_(v) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let h = ss.getSheetByName(v.hoja);
  if (!h) h = ss.insertSheet(v.hoja);
  if (h.getLastRow() === 0) {
    h.appendRow(v.encabezados);
    h.getRange(1, 1, 1, v.encabezados.length).setFontWeight('bold');
    h.setFrozenRows(1);
  }
  return h;
}

function filas_(v) {
  const h = hoja_(v);
  const last = h.getLastRow();
  if (last < 2) return [];
  return h.getRange(2, 1, last - 1, v.encabezados.length).getValues().filter(f => f[1]);
}

function normalizar_(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

function armarEstado_(v) {
  const filas = filas_(v);
  const cands = v.candidatos;
  let ranking;

  if (v.tipo === 'orden') {
    const puntos = {}, posiciones = {};
    cands.forEach(c => { puntos[c] = 0; posiciones[c] = cands.map(() => 0); });
    filas.forEach(f => {
      for (let i = 0; i < cands.length; i++) {
        const c = String(f[2 + i]);
        if (puntos[c] === undefined) continue;
        puntos[c] += cands.length - i;
        posiciones[c][i]++;
      }
    });
    ranking = cands.map(c => ({ nombre: c, puntos: puntos[c], posiciones: posiciones[c] }))
      .sort((a, b) => {
        if (b.puntos !== a.puntos) return b.puntos - a.puntos;
        for (let i = 0; i < cands.length; i++) if (b.posiciones[i] !== a.posiciones[i]) return b.posiciones[i] - a.posiciones[i];
        return a.nombre.localeCompare(b.nombre, 'es');
      });
  } else {
    const votos = {};
    cands.forEach(c => { votos[c] = 0; });
    filas.forEach(f => { const c = String(f[2]); if (votos[c] !== undefined) votos[c]++; });
    ranking = cands.map(c => ({ nombre: c, votos: votos[c] }))
      .sort((a, b) => (b.votos - a.votos) || a.nombre.localeCompare(b.nombre, 'es'));
  }

  const votantes = filas.map(f => ({
    nombre: String(f[1]),
    fecha: f[0] instanceof Date ? f[0].toISOString() : String(f[0] || ''),
  })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  return { ok: true, votacion: v.id, abierta: v.abierta, candidatos: cands, totalVotos: filas.length, ranking: ranking, votantes: votantes };
}

function estado_(v) {
  const cache = CacheService.getScriptCache();
  const guardado = cache.get(cacheKey_(v.id));
  if (guardado) return JSON.parse(guardado);
  const est = armarEstado_(v);
  try { cache.put(cacheKey_(v.id), JSON.stringify(est), CACHE_SEGUNDOS); } catch (e) {}
  return est;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  return json_(estado_(votacion_(e && e.parameter && e.parameter.v)));
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const v = votacion_(data.votacion || (e && e.parameter && e.parameter.v));
    if (!v.abierta) return json_({ ok: false, error: 'La votación está cerrada.' });

    const nombre = String(data.nombre || '').replace(/\s+/g, ' ').trim();
    if (nombre.length < 3 || nombre.indexOf(' ') < 0) return json_({ ok: false, error: 'Poné tu nombre y apellido.' });
    if (nombre.length > 80) return json_({ ok: false, error: 'El nombre es demasiado largo.' });

    let fila;
    if (v.tipo === 'orden') {
      const orden = Array.isArray(data.orden) ? data.orden.map(String) : [];
      const valido = orden.length === v.candidatos.length && v.candidatos.every(c => orden.indexOf(c) >= 0);
      if (!valido) return json_({ ok: false, error: 'Ordená a los ' + v.candidatos.length + ' hermanos del 1º al ' + v.candidatos.length + 'º.' });
      fila = orden;
    } else {
      const voto = String(data.voto || '');
      if (v.candidatos.indexOf(voto) < 0) return json_({ ok: false, error: 'Elegí a un hermano.' });
      fila = [voto];
    }

    const clave = normalizar_(nombre);
    if (filas_(v).some(f => normalizar_(f[1]) === clave)) {
      return json_({ ok: false, error: 'Ya hay un voto registrado con ese nombre.' });
    }

    hoja_(v).appendRow([new Date(), nombre].concat(fila));
    CacheService.getScriptCache().remove(cacheKey_(v.id));
    return json_(Object.assign(armarEstado_(v), { votoRegistrado: true }));
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}
