/**
 * Proxy de solo lectura + caché calculada para las planillas de
 * "Publicadores por Grupo".
 *
 * Qué hace:
 *   Expone un único endpoint web (doGet) con tres modos:
 *
 *   1) ?action=cache
 *      Devuelve de un solo saque el padrón (fresco) + la hoja "Cache" ya
 *      calculada (histórico de situación/horas/participación por persona
 *      y mes) + metadata de la última corrida (fecha, errores por
 *      planilla, nombres sin coincidencia). index.html usa este modo para
 *      la pantalla normal — así NO hay que releer ni rematchear las 5
 *      planillas de formulario en cada carga de pantalla.
 *
 *   2) ?action=recompute&token=...
 *      Relee el padrón + las 5 planillas de formulario, matchea nombres y
 *      reescribe la hoja "Cache" (pestaña nueva dentro de la planilla
 *      padrón) con el resultado ya calculado. Requiere que el token
 *      coincida con la propiedad de script RECOMPUTE_TOKEN (ver más abajo)
 *      — así cualquiera con la URL pública no puede disparar recálculos.
 *      index.html llama esto solo cuando se aprieta "Recalcular ahora".
 *      También se puede llamar sin pasar por HTTP con un trigger diario
 *      (ver createDailyTrigger() al final del archivo).
 *
 *   3) ?id=...&gid=...  (comportamiento original, se deja por compatibilidad)
 *      Devuelve el contenido crudo de una hoja puntual como JSON.
 *
 *   Las planillas NO necesitan estar compartidas públicamente: este script
 *   corre con los permisos de la cuenta de Google que lo despliega (vos),
 *   así que basta con que esa cuenta tenga acceso de LECTURA Y ESCRITURA al
 *   padrón (necesita escritura para poder crear/actualizar la pestaña
 *   "Cache") y de lectura a las 5 planillas de formulario.
 *
 *   Solo responde para los IDs de la lista blanca ALLOWED_SHEETS de abajo
 *   (modo 3) — así el endpoint no puede usarse para leer otras planillas
 *   tuyas aunque alguien descubra la URL.
 *
 * Cómo desplegarlo (una sola vez):
 *   1) Andá a https://script.google.com/ → "Proyecto nuevo".
 *   2) Borrá el contenido de Code.gs y pegá este archivo completo.
 *   3) "Configuración del proyecto" (ícono de tuerca) → "Propiedades del
 *      script" → agregá una propiedad RECOMPUTE_TOKEN con un valor secreto
 *      inventado por vos (una cadena larga cualquiera). Ese mismo valor va
 *      en index.html como PUBLICADORES_RECOMPUTE_TOKEN.
 *   4) Arriba a la derecha: "Implementar" → "Nueva implementación".
 *   5) Tipo: "Aplicación web".
 *      - Ejecutar como: "Yo (tu cuenta)"
 *      - Quién tiene acceso: "Cualquier usuario" (así index.html puede
 *        llamarlo sin que el visitante inicie sesión en Google). Si tu cuenta
 *        es de Google Workspace y preferís restringirlo, podés elegir
 *        "Cualquier usuario de [tu organización]" — pero entonces el
 *        navegador que abra index.html debe estar logueado con una cuenta de
 *        esa organización, o la carga fallará.
 *   6) "Implementar" → copiá la URL que termina en /exec.
 *   7) Pegá esa URL como API_URL en index.html (buscá "REEMPLAZA_CON_TU_URL").
 *   8) En el editor de Apps Script, seleccioná la función
 *      "createDailyTrigger" en el desplegable de funciones (arriba) y
 *      apretá "Ejecutar" una vez — instala el trigger diario que mantiene
 *      la caché al día sin que nadie tenga que apretar nada.
 *   9) (Opcional, una sola vez) Si tenés un histórico previo a este sistema
 *      en otra planilla de "resumen mensual" (columnas Persona / Mes Año /
 *      Situación / Participó / Horas), seleccioná la función
 *      "importHistoricalSummary" en el desplegable y apretá "Ejecutar" —
 *      lo matchea contra el padrón y lo guarda en la pestaña "Historico"
 *      (permanente; recomputeCache() la fusiona con las 5 planillas en
 *      vivo, sin pisarla). Revisá el log de la ejecución por si hay
 *      nombres sin coincidencia.
 *  10) Desde index.html (o directo pegando la URL /exec con
 *      ?action=recompute&token=TU_TOKEN en el navegador) corré un primer
 *      recálculo manual para que la pestaña "Cache" se cree y llene.
 *  11) Cada vez que modifiques este script, tenés que crear una "Nueva
 *      implementación" (o editar la implementación existente) para que los
 *      cambios se publiquen — guardar el archivo solo no alcanza.
 */

// IDs de las planillas autorizadas para el modo crudo (?id=&gid=): las 5 de
// formulario + la planilla padrón (Grupo/Nombre). No agregues otras sin
// revisar qué datos vas a exponer.
var ALLOWED_SHEETS = {
  '1-ebPFUI2Ko4z_hRTcYX_RtXFyOpCMnu-LZTIvfSTULY': true,
  '1DuBmCR4otIfwdkz6u69KxajK8MBldnkaKVQBDwqOMQk': true,
  '1rnH1jBASvggOBdlbSrMENJCEI5XD1eq2Uvn7soJMUL4': true,
  '1Tz-YTMSZvOsqhq3RRNAaRd0OvoRoWfzGLdEXqcYw5io': true,
  '1I5EV4UDiMUU9qb9tvG0K0PgoyqQecHC1IN3nstk20-o': true,
  '10iAtM2jSdqSOZ6ot0u-OILEm58BrO9dbnK_Lp4ks3qk': true // padrón (Grupo/Nombre)
};

// Planilla padrón (fuente de verdad de a qué grupo pertenece cada persona)
// y las 5 planillas de formulario. recomputeCache() las lee directo con
// SpreadsheetApp (sin pasar por HTTP) para armar la caché.
var ROSTER_SHEET = { id: '10iAtM2jSdqSOZ6ot0u-OILEm58BrO9dbnK_Lp4ks3qk', gid: '1214544104' };
var FORM_SHEETS = [
  { id: '1-ebPFUI2Ko4z_hRTcYX_RtXFyOpCMnu-LZTIvfSTULY', gid: '898644007' },
  { id: '1DuBmCR4otIfwdkz6u69KxajK8MBldnkaKVQBDwqOMQk', gid: '898644007' },
  { id: '1rnH1jBASvggOBdlbSrMENJCEI5XD1eq2Uvn7soJMUL4', gid: '100017995' },
  { id: '1Tz-YTMSZvOsqhq3RRNAaRd0OvoRoWfzGLdEXqcYw5io', gid: '1118844379' },
  { id: '1I5EV4UDiMUU9qb9tvG0K0PgoyqQecHC1IN3nstk20-o', gid: '1363353925' },
  // Sexta planilla (sumada el 28/09/2026): nunca se había importado — de acá
  // salen, por ejemplo, los informes de Romina De Gunaris ("Romina Damele").
  { id: '1K4bh0QpaZsbuwt-DPGNOnu9U17tV-M5vV2UiEoBL0fY', gid: '957928368' },
  // Séptima y octava (sumadas el 28/09/2026) para completar el historial de
  // quienes no tenían ningún mes (ej. Annalida Rojas Lopez, Nazer Rojas).
  { id: '1L98lSg62MCnALYd7DoxRzC8GQNLofYiLQrjvyuVSaeY', gid: '2036134324' },
  { id: '1c8v8XHHlQ3hyTPBtLoVULoxbWBLlEzPdT47Oghh3bc0', gid: '1748840930' }
];

// Nombre de la pestaña de caché, siempre dentro de la planilla padrón.
var CACHE_SHEET_NAME = 'Cache';

// Pestaña (dentro de la planilla padrón) donde guarda cada informe mensual
// el formulario del portal (informes/index.html, vía el Apps Script de
// Publicadores): A Fecha de envío, B Grupo, C Nombre, D Mes, E Año,
// F Participó, G Situación, H Cursos, I Horas, J Comentarios.
// Desde el 28/09/2026 es la ÚNICA fuente en vivo de recomputeCache(): las 5
// planillas de formulario (FORM_SHEETS) ya no se leen — lo que tenían quedó
// guardado una sola vez en "Historico" con congelarFormulariosEnHistorico().
var RESPUESTAS_SHEET_NAME = 'Respuestas';

// Nombre de la pestaña donde queda guardado, para siempre, el histórico
// importado UNA SOLA VEZ desde las planillas de "resumen mensual" (ver
// HISTORICAL_SUMMARY_SHEETS e importHistoricalSummary() más abajo). A
// diferencia de "Cache", funciona como registro permanente: recomputeCache()
// la lee como base y le vuelve a guardar el resultado con lo nuevo de
// "Respuestas" (que tiene prioridad), sin borrar nunca un mes que ya esté.
var HISTORICAL_SHEET_NAME = 'Historico';

// Planillas/pestañas externas con formato Persona / Mes Año / Situación /
// Participó / Horas (columnas A-E — cualquier columna extra a la derecha,
// como el bloque sin encabezado de la pestaña "Respaldo", se ignora sola:
// el parser solo lee lo que matchea esos 5 encabezados) que se usaron UNA
// VEZ para poblar el histórico previo a este sistema de caché
// (importHistoricalSummary()). El número de grupo no importa ahí — se
// resuelve igual que todo lo demás, contra el padrón actual. Si la misma
// persona+mes aparece en más de una de estas pestañas, gana la última de
// la lista (en la práctica son la misma info duplicada).
var HISTORICAL_SUMMARY_SHEETS = [
  { id: '1LQ6lbeg6J7U3MeCSZadto4ix0-4tZuxNjS5dd3V44zc', gid: '1225162582' }, // "resumen mensual"
  { id: '1LQ6lbeg6J7U3MeCSZadto4ix0-4tZuxNjS5dd3V44zc', gid: '541916359' }  // "Respaldo" (solo columnas A-E)
];

var MONTHS_ = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function doGet(e) {
  var params = (e && e.parameter) || {};

  if (params.action === 'cache') return handleCacheRequest_();
  if (params.action === 'recompute') return handleRecomputeRequest_(params);

  // ---- Modo crudo original (?id=&gid=), se deja por compatibilidad ----
  var id = params.id;
  var gid = params.gid;

  if (!id || !ALLOWED_SHEETS[id]) {
    return jsonOutput({ error: 'Planilla no autorizada (revisá ALLOWED_SHEETS en Code.gs)' });
  }

  // Cache de 3 minutos por hoja: si index.html vuelve a pedir el mismo grupo
  // poco después (recarga, reintento), se responde al toque sin releer la
  // planilla. No evita fallas de conexión, pero acorta el tiempo de
  // respuesta y baja la carga sobre las 5 planillas.
  var cacheKey = 'sheet_' + id + '_' + (gid || 'default');
  var cache = CacheService.getScriptCache();
  var cached = cache.get(cacheKey);
  if (cached) return jsonOutput(JSON.parse(cached));

  try {
    var ss = SpreadsheetApp.openById(id);
    var sheet = getSheetByGid_(ss, gid);
    var result = matrixToJson_(matrixFromSheet_(sheet));
    try {
      // CacheService rechaza valores de más de 100KB por clave; si la
      // planilla creciera mucho, simplemente no cacheamos esa respuesta.
      cache.put(cacheKey, JSON.stringify(result), 180);
    } catch (cacheErr) { /* seguimos sin cache, no es crítico */ }
    return jsonOutput(result);
  } catch (err) {
    return jsonOutput({ error: 'Error leyendo la planilla: ' + err });
  }
}

// ---------------------------------------------------------------------
// MODO ?action=cache — servir la caché ya calculada + padrón fresco
// ---------------------------------------------------------------------
// La respuesta de ?action=cache (la usan Publicadores/Estadísticas en cada
// carga) se guarda ya armada 10 minutos: armarla lee la pestaña "Cache" y el
// padrón completos y tardaba 3-4s. recomputeCache() e importHistoricalSummary()
// la invalidan al terminar; un cambio en el padrón se ve en <= 10 minutos.
var CACHE_KEY_RESPUESTA = 'respuesta_action_cache';
var CACHE_SEGUNDOS_RESPUESTA = 600;

function invalidarRespuestaCache_() {
  try { CacheService.getScriptCache().remove(CACHE_KEY_RESPUESTA); } catch (e) {}
}

// "Firma" de la pestaña "Respuestas": cantidad de filas + fecha de la
// última. Si cambió desde el último recomputeCache(), llegaron informes
// nuevos (el formulario del portal agrega filas al final con appendRow).
function firmaRespuestas_(ss) {
  var h = ss.getSheetByName(RESPUESTAS_SHEET_NAME);
  if (!h) return '';
  var last = h.getLastRow();
  var ts = last >= 2 ? h.getRange(last, 1).getValue() : '';
  return last + '|' + (Object.prototype.toString.call(ts) === '[object Date]' ? ts.getTime() : String(ts));
}

// Antes, lo que llegaba a "Respuestas" recién se veía al día siguiente
// (el recálculo corre de madrugada). Ahora, al pedir ?action=cache se
// revisa —como mucho una vez por minuto— si hay informes nuevos, y si los
// hay se recalcula en el momento. Un candado evita que dos pedidos
// simultáneos recalculen a la vez.
function recalcularSiHayInformesNuevos_() {
  var cache = CacheService.getScriptCache();
  if (cache.get('chequeo_respuestas')) return;
  cache.put('chequeo_respuestas', '1', 60);
  try {
    var ss = SpreadsheetApp.openById(ROSTER_SHEET.id);
    var firma = firmaRespuestas_(ss);
    if (firma === PropertiesService.getScriptProperties().getProperty('RESPUESTAS_FIRMA')) return;
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(1000)) return; // ya lo está recalculando otro pedido
    try { recomputeCache(); } finally { lock.releaseLock(); }
  } catch (e) {
    // si falla, se sirve lo que ya había (y el recálculo diario lo arregla)
  }
}

function handleCacheRequest_() {
  recalcularSiHayInformesNuevos_();
  var cache = CacheService.getScriptCache();
  var guardado = cache.get(CACHE_KEY_RESPUESTA);
  if (guardado) {
    return ContentService.createTextOutput(guardado).setMimeType(ContentService.MimeType.JSON);
  }
  var salida = armarRespuestaCache_();
  try {
    var texto = salida.getContent();
    if (!JSON.parse(texto).error) cache.put(CACHE_KEY_RESPUESTA, texto, CACHE_SEGUNDOS_RESPUESTA);
  } catch (e) { /* >100KB o error: se sirve igual, sin cachear */ }
  return salida;
}

function armarRespuestaCache_() {
  var result = {
    generatedAt: null,
    rosterStatus: { ok: false, error: null },
    sheetStatus: [],
    unmatched: [],
    roster: [],
    rows: []
  };

  try {
    var meta = JSON.parse(PropertiesService.getScriptProperties().getProperty('CACHE_META') || '{}');
    result.generatedAt = meta.generatedAt || null;
    result.sheetStatus = meta.sheetStatus || [];
    result.unmatched = meta.unmatched || [];
  } catch (e) { /* todavía no se corrió recomputeCache() ni una vez */ }

  var ss;
  try {
    ss = SpreadsheetApp.openById(ROSTER_SHEET.id);
  } catch (e) {
    return jsonOutput({ error: 'Error abriendo la planilla padrón: ' + e });
  }

  try {
    var cacheSheet = ss.getSheetByName(CACHE_SHEET_NAME);
    result.rows = cacheSheet ? readCacheSheet_(cacheSheet) : [];
  } catch (e) {
    return jsonOutput({ error: 'Error leyendo la pestaña de caché: ' + e });
  }

  try {
    var rosterSheet = getSheetByGid_(ss, ROSTER_SHEET.gid);
    var roster = parseRosterMatrix_(matrixFromSheet_(rosterSheet));
    result.roster = roster.map(function (r) { return { grupo: r.grupo, nombre: r.canonical, estado: r.estado }; });
    result.rosterStatus = { ok: true, error: null };
  } catch (e) {
    result.rosterStatus = { ok: false, error: String(e) };
  }

  return jsonOutput(result);
}

function readCacheSheet_(sheet) {
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  return values.slice(1)
    .filter(function (r) { return r[1]; }) // saltea filas vacías
    .map(function (r) {
      return {
        grupo: r[0],
        nombre: r[1],
        anio: r[2],
        mes: r[3],
        mesIndex: r[4],
        periodKey: r[5],
        situacion: r[6],
        horas: (r[7] === '' || r[7] == null) ? null : Number(r[7]),
        participo: r[8] === 'SI' ? true : (r[8] === 'NO' ? false : null),
        cursos: (r[9] === '' || r[9] == null || isNaN(Number(r[9]))) ? null : Number(r[9])
      };
    });
}

// ---------------------------------------------------------------------
// MODO ?action=recompute — releer todo y reescribir la caché
// ---------------------------------------------------------------------
function handleRecomputeRequest_(params) {
  var expected = PropertiesService.getScriptProperties().getProperty('RECOMPUTE_TOKEN');
  if (!expected) {
    return jsonOutput({ error: 'Falta configurar RECOMPUTE_TOKEN en Propiedades del script (ver encabezado de Code.gs)' });
  }
  if (params.token !== expected) {
    return jsonOutput({ error: 'Token inválido' });
  }
  try {
    var meta = recomputeCache();
    return jsonOutput({ ok: true, generatedAt: meta.generatedAt });
  } catch (e) {
    return jsonOutput({ error: 'Error recalculando: ' + e });
  }
}

/**
 * Relee el padrón + la pestaña "Respuestas" (única fuente en vivo desde el
 * 28/09/2026 — ver RESPUESTAS_SHEET_NAME), matchea cada informe contra el
 * padrón, se queda con el más reciente por (persona, período), lo fusiona
 * con el pasado fijo de la pestaña "Historico" (formularios viejos, ver
 * congelarFormulariosEnHistorico() e importHistoricalSummary()) y reescribe
 * la pestaña "Cache" dentro de la planilla padrón. Cuando "Respuestas" y
 * "Historico" tienen datos para la misma persona y mes, gana "Respuestas". Se puede llamar
 * manualmente (editor de Apps Script, o vía ?action=recompute) o desde el
 * trigger diario instalado por createDailyTrigger().
 */
function recomputeCache() {
  var ss = SpreadsheetApp.openById(ROSTER_SHEET.id);
  var firmaAlEmpezar = firmaRespuestas_(ss);
  var roster = parseRosterMatrix_(matrixFromSheet_(getSheetByGid_(ss, ROSTER_SHEET.gid)));

  // Base: el registro permanente de "Historico" (formularios viejos + todo
  // lo que ya pasó por "Respuestas" en corridas anteriores).
  var merged = {}; // "nombre|periodKey" -> fila en formato de salida (array)
  var historicoSheet = ss.getSheetByName(HISTORICAL_SHEET_NAME);
  if (historicoSheet) {
    readCacheSheet_(historicoSheet).forEach(function (r) {
      merged[r.nombre + '|' + r.periodKey] = rowObjectToArray_(r);
    });
  }

  // Única fuente en vivo: la pestaña "Respuestas" (ver RESPUESTAS_SHEET_NAME).
  var allFormRows = [];
  var sheetStatus = [];
  try {
    var respuestasSheet = ss.getSheetByName(RESPUESTAS_SHEET_NAME);
    if (!respuestasSheet) throw new Error('No existe la pestaña "' + RESPUESTAS_SHEET_NAME + '" en el padrón');
    allFormRows = parseRespuestasSheet_(respuestasSheet);
    sheetStatus.push({ ok: true, error: null });
  } catch (e) {
    sheetStatus.push({ ok: false, error: String(e) });
  }

  allFormRows = allFormRows.filter(function (row) { return !esDescartado_(row.rawName); });

  var unmatchedSet = {};
  allFormRows.forEach(function (row) {
    var m = matchRosterName_(row.normName, roster);
    row.grupo = m ? m.grupo : null;
    row.rosterCanonical = m ? m.canonical : null;
    if (!m) unmatchedSet[row.rawName] = true;
  });

  // Una fila por (persona, período): si hay más de una respuesta para el
  // mismo mes, gana la de "Marca temporal" más reciente.
  var latest = {};
  allFormRows.forEach(function (row) {
    if (!row.rosterCanonical || row.periodKey == null) return;
    var key = row.rosterCanonical + '|' + row.periodKey;
    var prev = latest[key];
    if (!prev || row.timestampMs >= prev.timestampMs) latest[key] = row;
  });

  // Lo recién leído de "Respuestas" pisa al histórico para el mismo
  // (persona, período) — el histórico rellena los huecos.
  Object.keys(latest).forEach(function (key) {
    var row = latest[key];
    var year = Math.floor(row.periodKey / 12);
    var monthIdx = row.periodKey % 12;
    merged[key] = [
      row.grupo,
      row.rosterCanonical,
      year,
      titleCase_(MONTHS_[monthIdx]),
      monthIdx,
      row.periodKey,
      row.situacionBucket || 'Otro',
      row.horas == null ? '' : row.horas,
      row.participated === true ? 'SI' : (row.participated === false ? 'NO' : ''),
      row.cursos == null ? '' : row.cursos
    ];
  });

  var cacheRows = Object.keys(merged).map(function (key) { return merged[key]; });
  cacheRows.sort(function (a, b) {
    if (a[1] !== b[1]) return a[1] < b[1] ? -1 : 1;
    return a[5] - b[5];
  });

  var header = ['Grupo', 'Nombre', 'Año', 'Mes', 'MesIndex', 'PeriodKey', 'Situacion', 'Horas', 'Participo', 'Cursos'];

  // "Historico" funciona como registro permanente: se le guarda lo mismo que
  // a "Cache" (Historico + Respuestas, con prioridad Respuestas). Así, si una
  // fila se borra de "Respuestas", ese mes queda igual en "Historico" y se
  // sigue viendo; si alguien corrige su informe, "Historico" se actualiza.
  // Para quitar un mes cargado por error hay que borrarlo de las DOS pestañas.
  // Se escribe ANTES que "Cache" y sin vaciar primero (ver escribirTabla_).
  if (!historicoSheet) historicoSheet = ss.insertSheet(HISTORICAL_SHEET_NAME);
  escribirTabla_(historicoSheet, header, cacheRows);

  var cacheSheet = ss.getSheetByName(CACHE_SHEET_NAME);
  if (!cacheSheet) cacheSheet = ss.insertSheet(CACHE_SHEET_NAME);
  escribirTabla_(cacheSheet, header, cacheRows);

  // El banner de "nombres sin coincidencia" muestra tanto lo que no
  // matcheó en esta corrida (planillas en vivo) como lo que no matcheó en
  // la importación histórica (que no se vuelve a correr sola).
  var historicalUnmatched = [];
  try {
    historicalUnmatched = JSON.parse(PropertiesService.getScriptProperties().getProperty('HISTORICAL_UNMATCHED') || '[]');
  } catch (e) { /* no se corrió importHistoricalSummary() todavía */ }
  // Los nombres viejos se vuelven a probar contra el padrón actual (con sus
  // "Otros nombres"): los que ya cruzan salen de la lista para siempre.
  historicalUnmatched = historicalUnmatched.filter(function (n) {
    return !esDescartado_(n) && !matchRosterName_(normalize_(n), roster);
  });
  PropertiesService.getScriptProperties().setProperty('HISTORICAL_UNMATCHED', JSON.stringify(historicalUnmatched));
  var allUnmatched = {};
  Object.keys(unmatchedSet).forEach(function (n) { allUnmatched[n] = true; });
  historicalUnmatched.forEach(function (n) { allUnmatched[n] = true; });

  var meta = {
    generatedAt: new Date().toISOString(),
    sheetStatus: sheetStatus,
    unmatched: Object.keys(allUnmatched).sort()
  };
  PropertiesService.getScriptProperties().setProperty('CACHE_META', JSON.stringify(meta));
  PropertiesService.getScriptProperties().setProperty('RESPUESTAS_FIRMA', firmaAlEmpezar);
  invalidarRespuestaCache_();
  return meta;
}

/**
 * Correr a mano desde el editor de Apps Script: suma a "Historico" lo que
 * haya en las pestañas viejas de "resumen mensual" (HISTORICAL_SUMMARY_SHEETS:
 * columnas Persona / Mes Año / Situación / Participó / Horas — el número de
 * grupo no importa, se resuelve contra el padrón actual con sus "Otros
 * nombres"; columnas extra a la derecha, como el bloque sin encabezado de
 * "Respaldo", se ignoran solas).
 *
 * Igual que congelarFormulariosEnHistorico(): solo RELLENA los meses que
 * "Historico" no tiene — nunca borra ni pisa lo que ya está (incluido lo que
 * vino de "Respuestas", que tiene prioridad) y se puede volver a correr sin
 * riesgo, por ejemplo después de agregar alias. Los nombres descartados se
 * ignoran. Después correr recomputeCache(). El log muestra el resumen.
 */
function importHistoricalSummary() {
  var ss = SpreadsheetApp.openById(ROSTER_SHEET.id);
  var roster = parseRosterMatrix_(matrixFromSheet_(getSheetByGid_(ss, ROSTER_SHEET.gid)));

  var merged = {};
  var histSheet = ss.getSheetByName(HISTORICAL_SHEET_NAME);
  if (histSheet) {
    readCacheSheet_(histSheet).forEach(function (r) {
      merged[r.nombre + '|' + r.periodKey] = rowObjectToArray_(r);
    });
  }
  var antes = Object.keys(merged).length;

  var rows = [];
  HISTORICAL_SUMMARY_SHEETS.forEach(function (cfg) {
    var histSs = SpreadsheetApp.openById(cfg.id);
    rows = rows.concat(parseHistoricalMatrix_(matrixFromSheet_(getSheetByGid_(histSs, cfg.gid))));
  });
  rows = rows.filter(function (row) { return !esDescartado_(row.rawName); });

  var unmatchedSet = {};
  var byKey = {};
  rows.forEach(function (row) {
    var m = matchRosterName_(row.normName, roster);
    if (!m) { unmatchedSet[row.rawName] = true; return; }
    if (row.periodKey == null) return; // "Mes Año" no se pudo interpretar
    // Si la misma persona+mes aparece en más de una pestaña de origen, gana
    // la última (en la práctica son la misma info duplicada).
    byKey[m.canonical + '|' + row.periodKey] = { grupo: m.grupo, canonical: m.canonical, row: row };
  });

  var agregadas = 0;
  Object.keys(byKey).forEach(function (key) {
    if (merged[key]) return; // solo rellena huecos
    var entry = byKey[key], row = entry.row;
    merged[key] = [
      entry.grupo, entry.canonical, Math.floor(row.periodKey / 12),
      titleCase_(MONTHS_[row.periodKey % 12]), row.periodKey % 12, row.periodKey,
      row.situacionBucket || 'Otro',
      row.horas == null ? '' : row.horas,
      row.participated === true ? 'SI' : (row.participated === false ? 'NO' : ''),
      row.cursos == null ? '' : row.cursos
    ];
    agregadas++;
  });

  var outRows = Object.keys(merged).map(function (k) { return merged[k]; });
  outRows.sort(function (a, b) {
    if (a[1] !== b[1]) return a[1] < b[1] ? -1 : 1;
    return a[5] - b[5];
  });
  if (!histSheet) histSheet = ss.insertSheet(HISTORICAL_SHEET_NAME);
  var header = ['Grupo', 'Nombre', 'Año', 'Mes', 'MesIndex', 'PeriodKey', 'Situacion', 'Horas', 'Participo', 'Cursos'];
  escribirTabla_(histSheet, header, outRows);

  // Se SUMAN a la lista de sin coincidencia (no la reemplazan).
  var previos = [];
  try { previos = JSON.parse(PropertiesService.getScriptProperties().getProperty('HISTORICAL_UNMATCHED') || '[]'); } catch (e) {}
  var todos = {};
  previos.concat(Object.keys(unmatchedSet)).forEach(function (n) { todos[n] = true; });
  PropertiesService.getScriptProperties().setProperty('HISTORICAL_UNMATCHED', JSON.stringify(Object.keys(todos).sort()));
  invalidarRespuestaCache_();

  var resumen = {
    filasEnHistoricoAntes: antes,
    mesesAgregados: agregadas,
    filasEnHistoricoAhora: outRows.length,
    filasLeidasDelResumen: rows.length,
    sinCoincidencia: Object.keys(unmatchedSet).sort()
  };
  Logger.log(JSON.stringify(resumen));
  return resumen;
}

// Filas de la pestaña "Respuestas" en el mismo formato que parseFormMatrix_
// (así el resto de recomputeCache no cambia). Columnas fijas por posición.
function parseRespuestasSheet_(sheet) {
  var last = sheet.getLastRow();
  if (last < 2) return [];
  var values = sheet.getRange(2, 1, last - 1, 10).getValues();
  var out = [];
  values.forEach(function (row) {
    var rawName = (row[2] == null ? '' : row[2]).toString().trim();
    if (!rawName) return;
    var mIdx = monthIndex_(row[3]);
    var yearNum = parseInt((row[4] == null ? '' : row[4]).toString().trim(), 10);
    var partNorm = normalize_(row[5]);
    var horasNum = parseFloat(row[8]);
    var cursosNum = parseFloat(row[7]);
    var ts = row[0];
    out.push({
      rawName: rawName,
      normName: normalize_(rawName),
      monthIdx: mIdx,
      year: isNaN(yearNum) ? null : yearNum,
      participated: partNorm === 'si' ? true : (partNorm === 'no' ? false : null),
      situacionBucket: classifySituacion_((row[6] == null ? '' : row[6]).toString().trim()),
      horas: isNaN(horasNum) ? null : horasNum,
      cursos: isNaN(cursosNum) ? null : cursosNum,
      timestampMs: (Object.prototype.toString.call(ts) === '[object Date]') ? ts.getTime() : 0,
      periodKey: (mIdx >= 0 && !isNaN(yearNum)) ? (yearNum * 12 + mIdx) : null,
      grupo: null,
      rosterCanonical: null
    });
  });
  return out;
}

/**
 * Correr UNA SOLA VEZ a mano (antes del primer recálculo con la versión que
 * solo lee "Respuestas"): lee las 5 planillas de formulario (FORM_SHEETS)
 * por última vez y agrega lo que tienen a la pestaña "Historico", para no
 * perder ese pasado cuando recomputeCache() deje de leerlas. Solo RELLENA
 * los meses que "Historico" no tiene (lo que ya está ahí, incluido lo que
 * vino de "Respuestas", no se pisa), así que se puede volver a correr sin
 * riesgo — por ejemplo después de cargar "Otros nombres" en el padrón, para
 * sumar los informes viejos de personas que antes no cruzaban. Después
 * correr recomputeCache(). Revisá el log por nombres sin coincidencia.
 */
function congelarFormulariosEnHistorico() {
  var ss = SpreadsheetApp.openById(ROSTER_SHEET.id);
  var roster = parseRosterMatrix_(matrixFromSheet_(getSheetByGid_(ss, ROSTER_SHEET.gid)));

  var merged = {};
  var histSheet = ss.getSheetByName(HISTORICAL_SHEET_NAME);
  if (histSheet) {
    readCacheSheet_(histSheet).forEach(function (r) {
      merged[r.nombre + '|' + r.periodKey] = rowObjectToArray_(r);
    });
  }
  var antes = Object.keys(merged).length;

  var rows = [], errores = [];
  FORM_SHEETS.forEach(function (cfg) {
    try {
      var formSs = SpreadsheetApp.openById(cfg.id);
      rows = rows.concat(parseFormMatrix_(matrixFromSheet_(getSheetByGid_(formSs, cfg.gid))));
    } catch (e) {
      errores.push(cfg.id + ': ' + e);
    }
  });
  if (errores.length) throw new Error('No se pudieron leer todas las planillas (no se tocó nada): ' + errores.join(' · '));
  rows = rows.filter(function (row) { return !esDescartado_(row.rawName); });

  var unmatchedSet = {};
  var latest = {};
  rows.forEach(function (row) {
    var m = matchRosterName_(row.normName, roster);
    if (!m) { unmatchedSet[row.rawName] = true; return; }
    if (row.periodKey == null) return;
    row.grupo = m.grupo;
    row.rosterCanonical = m.canonical;
    var key = m.canonical + '|' + row.periodKey;
    var prev = latest[key];
    if (!prev || row.timestampMs >= prev.timestampMs) latest[key] = row;
  });
  Object.keys(latest).forEach(function (key) {
    // Solo rellena huecos: si "Historico" ya tiene ese mes (que puede venir
    // de "Respuestas", con prioridad), no se pisa con lo de los formularios.
    if (merged[key]) return;
    var row = latest[key];
    merged[key] = [
      row.grupo, row.rosterCanonical, Math.floor(row.periodKey / 12),
      titleCase_(MONTHS_[row.periodKey % 12]), row.periodKey % 12, row.periodKey,
      row.situacionBucket || 'Otro',
      row.horas == null ? '' : row.horas,
      row.participated === true ? 'SI' : (row.participated === false ? 'NO' : ''),
      row.cursos == null ? '' : row.cursos
    ];
  });

  var outRows = Object.keys(merged).map(function (k) { return merged[k]; });
  outRows.sort(function (a, b) {
    if (a[1] !== b[1]) return a[1] < b[1] ? -1 : 1;
    return a[5] - b[5];
  });
  if (!histSheet) histSheet = ss.insertSheet(HISTORICAL_SHEET_NAME);
  var header = ['Grupo', 'Nombre', 'Año', 'Mes', 'MesIndex', 'PeriodKey', 'Situacion', 'Horas', 'Participo', 'Cursos'];
  escribirTabla_(histSheet, header, outRows); // sin vaciar antes (ver escribirTabla_)

  // Los nombres que no cruzaron quedan en el aviso de la página (igual que
  // con importHistoricalSummary).
  var previos = [];
  try { previos = JSON.parse(PropertiesService.getScriptProperties().getProperty('HISTORICAL_UNMATCHED') || '[]'); } catch (e) {}
  var todos = {};
  previos.concat(Object.keys(unmatchedSet)).forEach(function (n) { todos[n] = true; });
  PropertiesService.getScriptProperties().setProperty('HISTORICAL_UNMATCHED', JSON.stringify(Object.keys(todos).sort()));
  invalidarRespuestaCache_();

  var resumen = { filasEnHistoricoAntes: antes, filasEnHistoricoAhora: outRows.length, filasLeidasDeFormularios: rows.length, sinCoincidencia: Object.keys(unmatchedSet).length };
  Logger.log(JSON.stringify(resumen));
  return resumen;
}

// Reemplaza el contenido de una pestaña por header + rows SIN vaciarla
// antes: primero escribe lo nuevo encima y después limpia las filas que
// sobren. Si algo falla a mitad de camino, no queda la pestaña vacía (con
// "Historico" eso sería perder el registro permanente).
function escribirTabla_(sheet, header, rows) {
  sheet.getRange(1, 1, 1, header.length).setValues([header]);
  if (rows.length) sheet.getRange(2, 1, rows.length, header.length).setValues(rows);
  var sobrantes = sheet.getLastRow() - (rows.length + 1);
  if (sobrantes > 0) sheet.getRange(rows.length + 2, 1, sobrantes, sheet.getMaxColumns()).clearContent();
}

// Alias confirmados el 28/09/2026 (nombre en el padrón -> cómo firman sus
// informes). Los carga cargarAliasIniciales() en la columna "Otros nombres"
// de la pestaña Publicadores; se puede volver a correr al sumar alias acá
// (no repite los que ya están). También se pueden cargar a mano ahí.
var ALIAS_INICIALES = {
  'Beatriz Viera': ['Baty Viera', 'Betty Viera', 'Bety Viera'],
  'Edith Armstrong': ['Edith Amstrong', 'Edhit Amstrong'],
  'Carlos Fernández': ['Carlos Esteban Fernadez Zamora', 'Carlos Esteban Fernandez Zamora'],
  'Mélany De Kuzman': ['Melany', 'Melany Vidal'],
  'Paula De Gerschuni': ['Paula Toloza', 'Pauls Toloza'],
  'Silvya De Gomez': ['Silvya Aramburu', 'Silvia Aramburú', 'Silvia Aramburú de Gómez'],
  'Estefani De Gomez': ['Estefany Pérez', 'Estefany Pérez de Gómez'],
  'Martha De Fernandez': ['Martha Bórtoli', 'Marha Bórtoli', 'Bórtoli, Martha'],
  'Natalia De Aviles': ['Natalia Nuñez'],
  'Leticia De Urdiozola': ['Leticia Lewis', 'Lewis', 'Leticia'],
  'Gladys De Olmedo': ['Gladys Bogao', 'Gladyz Bogao'],
  'Victoria De Ramos': ['Victoria Caraballo'],
  'Evelyn De Toloza': ['Evelyn Razeto'],
  'Elizabeth De Saavedra': ['Elizabeth Moller', 'Moller', 'Moller Elizabeth'],
  'Marianela De Valle': ['Marianela Coloma'],
  'Susana De Gatebled': ['Susana Arias'],
  'Laura De Galarza': ['Laura Roque'],
  'Liliana De Martinez': ['Liliana Nuñez'],
  'Andrea De Saavedra': ['Andrea Martinengo'],
  'Anahí De De Souza': ['Anahi de Vega'],
  'Lilian Haristoy': ['Lilian Galup'],
  'Nilsa Silveira': ['Nilsa Suárez'],
  'Jimena De Inchausti': ['Jimena Carminati'],
  'Jimena De De Brun': ['Jimena Morales'],
  'Karina De Hernández': ['Karina Haristoy'],
  'Johana De Correa': ['Joanna Damele', 'Joannadamele'],
  'Romina De Gunaris': ['Romina Damele'],
  'Flavia De Carminati': ['Flavia Manente'],
  'Flor De Fuentes': ['Flor Gómez'],
  'Maria Luisa De Pena': ['María Luisa Rodriguez'],
  'Fabian Saavedra': ['Saavedra Fabián'],
  'Gabriela De Taroco': ['Gabriela Acha']
};

// Nombres de informes que NO corresponden a nadie (no existe esa persona):
// se ignoran por completo — no se cuentan ni aparecen en el aviso de "sin
// coincidencia", aunque sigan en las planillas viejas.
var NOMBRES_DESCARTADOS = [
  'Karina Rosa',
  'Judith San Martin', 'Judiht San Martin', 'Udith San Martin', 'Judith Rosmary San Martin', 'Judith Rossemarie San Martin',
  'Lucas Matias',
  'Rosa Oliva', 'Rosa',
  'Leonardo Hernandez', // normalize_ ignora tildes y mayúsculas: cubre "Leonardo Hernández" / "Leonardo hernández"
  'Participé' // alguien escribió eso en el campo del nombre
];

function esDescartado_(nombre) {
  var n = normalize_(nombre);
  return NOMBRES_DESCARTADOS.some(function (d) { return normalize_(d) === n; });
}

/**
 * Correr UNA VEZ a mano: agrega ALIAS_INICIALES a la columna "Otros nombres"
 * de la pestaña Publicadores (la crea al final si no existe). No borra lo
 * que ya haya en esa columna ni repite alias. Después correr
 * congelarFormulariosEnHistorico() y recomputeCache(). El log avisa si
 * algún nombre de la lista no se encontró en el padrón.
 */
function cargarAliasIniciales() {
  var ss = SpreadsheetApp.openById(ROSTER_SHEET.id);
  var sheet = getSheetByGid_(ss, ROSTER_SHEET.gid);
  var lastCol = sheet.getLastColumn();
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(normalize_);
  var colNombre = header.indexOf('nombre');
  if (colNombre === -1) throw new Error('La pestaña del padrón no tiene columna "Nombre"');
  var colAlias = header.indexOf('otros nombres');
  if (colAlias === -1) {
    colAlias = lastCol; // nueva columna al final
    sheet.getRange(1, colAlias + 1).setValue('Otros nombres');
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  var nombres = sheet.getRange(2, colNombre + 1, lastRow - 1, 1).getValues();
  var alias = sheet.getRange(2, colAlias + 1, lastRow - 1, 1).getValues();

  var pendientes = {};
  Object.keys(ALIAS_INICIALES).forEach(function (n) { pendientes[normalize_(n)] = n; });

  for (var i = 0; i < nombres.length; i++) {
    var clave = normalize_(String(nombres[i][0] || '').split(/\s+-\s+/)[0]);
    var original = pendientes[clave];
    if (!original) continue;
    var actuales = String(alias[i][0] || '').split(';').map(function (x) { return x.trim(); }).filter(Boolean);
    var normActuales = actuales.map(normalize_);
    ALIAS_INICIALES[original].forEach(function (a) {
      if (normActuales.indexOf(normalize_(a)) === -1) { actuales.push(a); normActuales.push(normalize_(a)); }
    });
    alias[i][0] = actuales.join('; ');
    delete pendientes[clave];
  }
  sheet.getRange(2, colAlias + 1, lastRow - 1, 1).setValues(alias);
  invalidarRespuestaCache_();

  var noEncontrados = Object.keys(pendientes).map(function (k) { return pendientes[k]; });
  Logger.log('Alias cargados. ' + (noEncontrados.length ? 'NO encontrados en el padrón: ' + noEncontrados.join(', ') : 'Todos los nombres se encontraron.'));
}

// Correcciones puntuales confirmadas a mano (28/09/2026): cuando una persona
// tiene dos informes distintos para el mismo mes, vale lo que dice acá.
// Las aplica aplicarCorrecciones() — situación como la escribiría el
// formulario, horas '' = sin horas.
var CORRECCIONES = [
  { nombre: 'Jimena De Inchausti', mes: 'Agosto', anio: 2026, situacion: 'Publicador', horas: '', participo: 'Si' },
  { nombre: 'Nilsa Silveira', mes: 'Marzo', anio: 2026, situacion: 'Precursor Auxiliar 15 horas', horas: 20, participo: 'Si' }
];

/**
 * Correr a mano: aplica CORRECCIONES en "Respuestas" (las filas de esa
 * persona y ese mes, reconocida por nombre o alias) y en "Historico", y
 * después hay que correr recomputeCache(). Toca SOLO esas filas. Se puede
 * volver a correr sin problema (deja los mismos valores).
 */
function aplicarCorrecciones() {
  var ss = SpreadsheetApp.openById(ROSTER_SHEET.id);
  var roster = parseRosterMatrix_(matrixFromSheet_(getSheetByGid_(ss, ROSTER_SHEET.gid)));
  var log = [];

  CORRECCIONES.forEach(function (c) {
    var objetivo = normalize_(c.nombre);
    var mIdx = monthIndex_(c.mes);
    var periodKey = c.anio * 12 + mIdx;
    var bucket = classifySituacion_(c.situacion) || 'Otro';
    var partNorm = normalize_(c.participo);
    var participoCache = partNorm === 'si' ? 'SI' : (partNorm === 'no' ? 'NO' : '');

    // "Respuestas": F Participó (6), G Situación (7), I Horas (9)
    var enRespuestas = 0;
    var resp = ss.getSheetByName(RESPUESTAS_SHEET_NAME);
    if (resp && resp.getLastRow() >= 2) {
      var vals = resp.getRange(2, 1, resp.getLastRow() - 1, 10).getValues();
      vals.forEach(function (row, i) {
        var m = matchRosterName_(normalize_(row[2]), roster);
        if (!m || normalize_(m.canonical) !== objetivo) return;
        if (monthIndex_(row[3]) !== mIdx || parseInt(row[4], 10) !== c.anio) return;
        resp.getRange(i + 2, 6, 1, 2).setValues([[c.participo, c.situacion]]);
        resp.getRange(i + 2, 9).setValue(c.horas);
        enRespuestas++;
      });
    }

    // "Historico": G Situacion (7), H Horas (8), I Participo (9)
    var enHistorico = 0;
    var hist = ss.getSheetByName(HISTORICAL_SHEET_NAME);
    if (hist && hist.getLastRow() >= 2) {
      var hv = hist.getRange(2, 1, hist.getLastRow() - 1, 9).getValues();
      hv.forEach(function (row, i) {
        if (normalize_(row[1]) !== objetivo || Number(row[5]) !== periodKey) return;
        hist.getRange(i + 2, 7, 1, 3).setValues([[bucket, c.horas, participoCache]]);
        enHistorico++;
      });
    }
    log.push(c.nombre + ' ' + c.mes + ' ' + c.anio + ': ' + enRespuestas + ' fila(s) en Respuestas, ' + enHistorico + ' en Historico');
  });

  invalidarRespuestaCache_();
  Logger.log(log.join(' | '));
}

/**
 * Correr a mano SOLO si "Historico" quedó con datos mal asignados (p. ej.
 * informes de una persona cruzados con otra antes de cargar un alias o de
 * ajustar el cruce). Rearma "Historico" desde cero a partir de las fuentes:
 *   1) resumen mensual viejo (HISTORICAL_SUMMARY_SHEETS) como base,
 *   2) las planillas de formulario (FORM_SHEETS) encima — si una persona
 *      tiene varios informes del mismo mes, gana el más reciente,
 * con el padrón, alias y descartados actuales. Antes de escribir guarda una
 * copia completa en una pestaña "Historico respaldo AAAA-MM-DD HH:mm".
 * Después correr aplicarCorrecciones() y recomputeCache() ("Respuestas"
 * vuelve a quedar arriba de todo, con prioridad).
 * Ojo: los meses que estaban SOLO en "Historico" porque se borraron de
 * "Respuestas" se pierden (quedan en el respaldo).
 */
function reconstruirHistorico() {
  var ss = SpreadsheetApp.openById(ROSTER_SHEET.id);
  var roster = parseRosterMatrix_(matrixFromSheet_(getSheetByGid_(ss, ROSTER_SHEET.gid)));
  var header = ['Grupo', 'Nombre', 'Año', 'Mes', 'MesIndex', 'PeriodKey', 'Situacion', 'Horas', 'Participo', 'Cursos'];
  var fila = function (grupo, canonical, row) {
    return [
      grupo, canonical, Math.floor(row.periodKey / 12),
      titleCase_(MONTHS_[row.periodKey % 12]), row.periodKey % 12, row.periodKey,
      row.situacionBucket || 'Otro',
      row.horas == null ? '' : row.horas,
      row.participated === true ? 'SI' : (row.participated === false ? 'NO' : ''),
      row.cursos == null ? '' : row.cursos
    ];
  };

  // Leer TODO primero: si alguna fuente falla, no se toca nada.
  var resumenRows = [];
  HISTORICAL_SUMMARY_SHEETS.forEach(function (cfg) {
    var h = SpreadsheetApp.openById(cfg.id);
    resumenRows = resumenRows.concat(parseHistoricalMatrix_(matrixFromSheet_(getSheetByGid_(h, cfg.gid))));
  });
  var formRows = [];
  FORM_SHEETS.forEach(function (cfg) {
    var fss = SpreadsheetApp.openById(cfg.id);
    formRows = formRows.concat(parseFormMatrix_(matrixFromSheet_(getSheetByGid_(fss, cfg.gid))));
  });

  var merged = {}, unmatchedSet = {};
  resumenRows.forEach(function (row) {
    if (esDescartado_(row.rawName) || row.periodKey == null) return;
    var m = matchRosterName_(row.normName, roster);
    if (!m) { unmatchedSet[row.rawName] = true; return; }
    merged[m.canonical + '|' + row.periodKey] = fila(m.grupo, m.canonical, row);
  });
  var latest = {};
  formRows.forEach(function (row) {
    if (esDescartado_(row.rawName) || row.periodKey == null) return;
    var m = matchRosterName_(row.normName, roster);
    if (!m) { unmatchedSet[row.rawName] = true; return; }
    var key = m.canonical + '|' + row.periodKey;
    if (!latest[key] || row.timestampMs >= latest[key].row.timestampMs) latest[key] = { m: m, row: row };
  });
  Object.keys(latest).forEach(function (key) {
    merged[key] = fila(latest[key].m.grupo, latest[key].m.canonical, latest[key].row);
  });

  var outRows = Object.keys(merged).map(function (k) { return merged[k]; });
  outRows.sort(function (a, b) {
    if (a[1] !== b[1]) return a[1] < b[1] ? -1 : 1;
    return a[5] - b[5];
  });

  // Respaldo antes de escribir.
  var hist = ss.getSheetByName(HISTORICAL_SHEET_NAME);
  var antes = 0;
  if (hist) {
    var copia = hist.copyTo(ss);
    copia.setName('Historico respaldo ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'));
    antes = Math.max(0, hist.getLastRow() - 1);
  } else {
    hist = ss.insertSheet(HISTORICAL_SHEET_NAME);
  }
  escribirTabla_(hist, header, outRows);

  PropertiesService.getScriptProperties().setProperty('HISTORICAL_UNMATCHED', JSON.stringify(Object.keys(unmatchedSet).sort()));
  invalidarRespuestaCache_();
  Logger.log(JSON.stringify({
    filasAntes: antes, filasAhora: outRows.length,
    leidasResumen: resumenRows.length, leidasFormularios: formRows.length,
    sinCoincidencia: Object.keys(unmatchedSet).sort()
  }));
}

function rowObjectToArray_(r) {
  return [
    r.grupo, r.nombre, r.anio, r.mes, r.mesIndex, r.periodKey, r.situacion,
    r.horas == null ? '' : r.horas,
    r.participo === true ? 'SI' : (r.participo === false ? 'NO' : ''),
    r.cursos == null ? '' : r.cursos
  ];
}

/**
 * Correr UNA VEZ a mano desde el editor de Apps Script (seleccionar esta
 * función en el desplegable de arriba → "Ejecutar"). Instala un trigger
 * que llama recomputeCache() todos los días a la madrugada, así la caché
 * se mantiene al día sin que nadie tenga que acordarse de apretar nada.
 * Si la volvés a correr, primero borra el trigger anterior para no
 * duplicarlo.
 */
function createDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'recomputeCache') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('recomputeCache').timeBased().everyDays(1).atHour(3).create();
}

// ---------------------------------------------------------------------
// UTILIDADES DE HOJA
// ---------------------------------------------------------------------
function getSheetByGid_(ss, gid) {
  if (gid) {
    var sheets = ss.getSheets();
    for (var i = 0; i < sheets.length; i++) {
      if (String(sheets[i].getSheetId()) === String(gid)) return sheets[i];
    }
  }
  return ss.getSheets()[0];
}

function matrixFromSheet_(sheet) {
  var values = sheet.getDataRange().getValues();
  if (!values.length) return [];
  var header = values[0].map(function (v) { return v == null ? '' : String(v); });
  return [header].concat(values.slice(1));
}

function matrixToJson_(matrix) {
  if (!matrix.length) return { header: [], rows: [] };
  var rows = matrix.slice(1).map(function (row) {
    return row.map(function (v) {
      if (Object.prototype.toString.call(v) === '[object Date]') {
        return Utilities.formatDate(v, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss');
      }
      return v;
    });
  });
  return { header: matrix[0], rows: rows };
}

// ---------------------------------------------------------------------
// UTILIDADES DE TEXTO Y MATCHING
// (única copia en todo el proyecto — index.html ya no repite esta lógica,
// solo consume el resultado ya calculado vía ?action=cache)
// ---------------------------------------------------------------------
function normalize_(s) {
  // NFKC primero: convierte letras "de fantasía" que algunos copian de
  // redes (𝑨𝒏𝒂𝒉𝒊 𝒅𝒆 𝑽𝒆𝒈𝒂, ancho completo, etc.) a letras normales.
  return (s == null ? '' : String(s))
    .normalize('NFKC')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim().replace(/\s+/g, ' ');
}
function titleCase_(s) {
  return s.replace(/\s+/g, ' ').trim().split(' ').map(function (w) {
    return w ? w.charAt(0).toUpperCase() + w.slice(1) : w;
  }).join(' ');
}
function monthIndex_(raw) {
  var n = normalize_(raw);
  if (n === 'setiembre') return 8;
  return MONTHS_.indexOf(n);
}
function classifySituacion_(raw) {
  var n = normalize_(raw);
  if (!n) return null;
  if (n.indexOf('especial') !== -1) return 'Precursor Especial';
  if (n.indexOf('regular') !== -1) return 'Precursor Regular';
  if (n.indexOf('auxiliar') !== -1) return 'Precursor Auxiliar';
  if (n.indexOf('publicador') !== -1) return 'Publicador';
  return 'Otro';
}
function levenshtein_(a, b) {
  var m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  var prev = new Array(n + 1), cur = new Array(n + 1);
  for (var j = 0; j <= n; j++) prev[j] = j;
  for (var i = 1; i <= m; i++) {
    cur[0] = i;
    for (j = 1; j <= n; j++) {
      var cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    var tmp = prev; prev = cur; cur = tmp;
  }
  return prev[n];
}
// Umbral de similitud tolerante a tipeo, pero conservador (no mezcla
// personas distintas con nombres parecidos): crece muy poco con el largo.
function fuzzyThreshold_(len) { return Math.max(1, Math.min(4, Math.round(0.22 * len))); }

// true si todos los tokens de "short" aparecen en "long", en el mismo
// orden (se permiten tokens de más en el medio) — para casos como
// "Teresa Zulueta" adentro de "Teresa Zulueta De Cabrera", o
// "Carlos Fernandez" adentro de "Carlos Esteban Fernandez Zamora".
function isTokenSubsequence_(shortTokens, longTokens) {
  var i = 0;
  for (var j = 0; j < longTokens.length && i < shortTokens.length; j++) {
    if (longTokens[j] === shortTokens[i]) i++;
  }
  return i === shortTokens.length;
}

// Busca en el padrón la persona más parecida a normName. Devuelve la
// entrada del padrón o null si no hay ninguna lo bastante parecida.
function matchRosterName_(normName, rosterList) {
  for (var i = 0; i < rosterList.length; i++) {
    if (rosterList[i].normName === normName) return rosterList[i];
  }
  // Coincidencia exacta con alguno de sus "Otros nombres" (columna del padrón).
  for (var a = 0; a < rosterList.length; a++) {
    if ((rosterList[a].aliasNorms || []).indexOf(normName) !== -1) return rosterList[a];
  }

  // Nombre acortado/alargado (falta o sobra un nombre del medio o un
  // apellido de casada) — solo si hay UN único candidato, para no
  // arriesgar mezclar personas distintas.
  var inputTokens = normName.split(' ').filter(Boolean);
  var subseqMatches = [];
  for (var k = 0; k < rosterList.length; k++) {
    var rTokens = rosterList[k].normName.split(' ').filter(Boolean);
    var shorter = inputTokens.length <= rTokens.length ? inputTokens : rTokens;
    var longer = inputTokens.length <= rTokens.length ? rTokens : inputTokens;
    if (shorter.length >= 2 && isTokenSubsequence_(shorter, longer)) subseqMatches.push(rosterList[k]);
  }
  if (subseqMatches.length === 1) return subseqMatches[0];

  // Parecido "por letras": además del nombre completo, el ÚLTIMO apellido
  // tiene que parecerse (a lo sumo 2 letras distintas). Sin esto, "Gabriela
  // Acha" terminaba cruzando con "Gabriela Maciera" (mismo nombre de pila,
  // apellido completamente distinto). Los errores de tipeo reales
  // ("Amstrong"/"Armstrong", "Nuñez"/"Nunez") siguen cruzando.
  var inputLast = inputTokens[inputTokens.length - 1] || '';
  var best = null, bestDist = Infinity;
  for (var j = 0; j < rosterList.length; j++) {
    var r = rosterList[j];
    var maxLen = Math.max(normName.length, r.normName.length);
    var d = levenshtein_(normName, r.normName);
    if (d > fuzzyThreshold_(maxLen) || d >= bestDist) continue;
    var rT = r.normName.split(' ').filter(Boolean);
    // (si vino todo junto, ej. "DanielAtrat", no hay apellido separado para comparar)
    if (inputTokens.length > 1 && levenshtein_(inputLast, rT[rT.length - 1] || '') > 2) continue;
    best = r; bestDist = d;
  }
  return best;
}

// Filas del PADRÓN maestro (columnas Grupo / Nombre).
function parseRosterMatrix_(matrix) {
  if (!matrix || !matrix.length) return [];
  var headerNorm = matrix[0].map(normalize_);
  var find = colFinder_(headerNorm);
  // "Estado" (Anciano, Siervo Ministerial, Precursor Regular, ...) es la
  // misma columna que se edita desde el modal de Publicadores; opcional.
  // "Otros nombres" (opcional): apodos, apellido de soltera, errores de
  // tipeo con los que esa persona firma sus informes, separados por ";".
  // Ej. en "Martha De Fernandez": "Martha Bórtoli; Bórtoli, Martha".
  var idx = { grupo: find(/^grupo$/), nombre: find(/^nombre$/), estado: find(/^estado$/), alias: find(/^otros nombres$/) };
  var out = [];
  var seen = {}; // evita duplicados exactos dentro del padrón
  for (var i = 1; i < matrix.length; i++) {
    var row = matrix[i];
    var rawName = (row[idx.nombre] == null ? '' : row[idx.nombre]).toString().trim();
    var grupoNum = parseInt(row[idx.grupo], 10);
    if (!rawName || isNaN(grupoNum)) continue;
    // "Nombre - nota" (p.ej. "Emma Gerschuni - menor") -> se matchea solo
    // por la parte antes del guion, pero se muestra el nombre completo.
    var matchName = rawName.split(/\s+-\s+/)[0].trim();
    var normMatch = normalize_(matchName);
    if (!normMatch || normMatch === 'no publicadora') continue; // fila placeholder, no es una persona
    var key = grupoNum + '|' + normMatch;
    if (seen[key]) continue;
    seen[key] = true;
    var estado = idx.estado >= 0 && row[idx.estado] != null ? String(row[idx.estado]).trim() : '';
    var aliasNorms = idx.alias >= 0 && row[idx.alias] != null
      ? String(row[idx.alias]).split(';').map(normalize_).filter(Boolean)
      : [];
    out.push({ grupo: grupoNum, canonical: titleCase_(rawName), normName: normMatch, estado: estado, aliasNorms: aliasNorms });
  }
  return out;
}

// Filas de una planilla de FORMULARIO (respuestas mensuales).
function parseFormMatrix_(matrix) {
  if (!matrix || !matrix.length) return [];
  var headerNorm = matrix[0].map(normalize_);
  var find = colFinder_(headerNorm);
  var idx = {
    timestamp: find(/marca temporal/),
    name: find(/nombre y apellido/),
    month: find(/^mes$/),
    participated: find(/predicacion/),
    year: find(/^ano$/),
    situacion: find(/situacion/),
    horas: find(/^horas$/),
    cursos: find(/cursos/)
  };
  var out = [];
  for (var i = 1; i < matrix.length; i++) {
    var row = matrix[i];
    var rawName = (row[idx.name] == null ? '' : row[idx.name]).toString().trim();
    if (!rawName) continue; // fila vacía / separador
    var monthRaw = (row[idx.month] == null ? '' : row[idx.month]).toString();
    var mIdx = monthIndex_(monthRaw);
    var yearNum = parseInt((row[idx.year] == null ? '' : row[idx.year]).toString().trim(), 10);
    var situacionRaw = (row[idx.situacion] == null ? '' : row[idx.situacion]).toString().trim();
    var partNorm = normalize_(row[idx.participated]);
    var horasNum = parseFloat(row[idx.horas]);
    var cursosNum = idx.cursos >= 0 ? parseFloat(row[idx.cursos]) : NaN;
    var tsVal = row[idx.timestamp];
    var timestampMs = (Object.prototype.toString.call(tsVal) === '[object Date]') ? tsVal.getTime() : 0;
    out.push({
      rawName: rawName,
      normName: normalize_(rawName),
      monthIdx: mIdx,
      year: isNaN(yearNum) ? null : yearNum,
      participated: partNorm === 'si' ? true : (partNorm === 'no' ? false : null),
      situacionBucket: classifySituacion_(situacionRaw),
      horas: isNaN(horasNum) ? null : horasNum,
      cursos: isNaN(cursosNum) ? null : cursosNum,
      timestampMs: timestampMs,
      periodKey: (mIdx >= 0 && !isNaN(yearNum)) ? (yearNum * 12 + mIdx) : null,
      grupo: null,
      rosterCanonical: null
    });
  }
  return out;
}

// Filas del RESUMEN HISTÓRICO externo (columnas Persona / Mes Año /
// Situación / Participó / Horas — ver HISTORICAL_SUMMARY_SHEETS). "Mes Año"
// viene en una sola celda (p.ej. "marzo 2026"), a diferencia de las
// planillas de formulario que tienen Mes y Año en columnas separadas.
function parseHistoricalMatrix_(matrix) {
  if (!matrix || !matrix.length) return [];
  var headerNorm = matrix[0].map(normalize_);
  var find = colFinder_(headerNorm);
  var idx = {
    name: find(/^persona$/),
    mesAnio: find(/^mes ano$/),
    situacion: find(/situacion/),
    participated: find(/particip/),
    horas: find(/^horas$/),
    cursos: find(/cursos/)
  };
  var out = [];
  for (var i = 1; i < matrix.length; i++) {
    var row = matrix[i];
    var rawName = (row[idx.name] == null ? '' : row[idx.name]).toString().trim();
    if (!rawName) continue; // fila vacía / separador
    var mesAnioRaw = (row[idx.mesAnio] == null ? '' : row[idx.mesAnio]).toString().trim();
    var m = mesAnioRaw.match(/^(.*)\s+(\d{4})$/);
    var mIdx = m ? monthIndex_(m[1]) : -1;
    var yearNum = m ? parseInt(m[2], 10) : NaN;
    var situacionRaw = (row[idx.situacion] == null ? '' : row[idx.situacion]).toString().trim();
    var partNorm = normalize_(row[idx.participated]);
    var horasNum = parseFloat(row[idx.horas]);
    var cursosNum = idx.cursos >= 0 ? parseFloat(row[idx.cursos]) : NaN;
    out.push({
      rawName: rawName,
      normName: normalize_(rawName),
      monthIdx: mIdx,
      year: isNaN(yearNum) ? null : yearNum,
      participated: partNorm === 'si' ? true : (partNorm === 'no' ? false : null),
      situacionBucket: classifySituacion_(situacionRaw),
      horas: isNaN(horasNum) ? null : horasNum,
      cursos: isNaN(cursosNum) ? null : cursosNum,
      timestampMs: 0,
      periodKey: (mIdx >= 0 && !isNaN(yearNum)) ? (yearNum * 12 + mIdx) : null,
      grupo: null,
      rosterCanonical: null
    });
  }
  return out;
}

function colFinder_(headerNorm) {
  return function (regex) {
    for (var i = 0; i < headerNorm.length; i++) if (regex.test(headerNorm[i])) return i;
    return -1;
  };
}

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
