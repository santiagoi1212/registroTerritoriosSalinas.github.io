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
  { id: '1I5EV4UDiMUU9qb9tvG0K0PgoyqQecHC1IN3nstk20-o', gid: '1363353925' }
];

// Nombre de la pestaña de caché, siempre dentro de la planilla padrón.
var CACHE_SHEET_NAME = 'Cache';

// Nombre de la pestaña donde queda guardado, para siempre, el histórico
// importado UNA SOLA VEZ desde las planillas de "resumen mensual" (ver
// HISTORICAL_SUMMARY_SHEETS e importHistoricalSummary() más abajo). A
// diferencia de "Cache" (que se borra y recalcula entero en cada corrida),
// esta pestaña nunca la toca recomputeCache() — solo la lee y la mezcla.
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
function handleCacheRequest_() {
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
    result.roster = roster.map(function (r) { return { grupo: r.grupo, nombre: r.canonical }; });
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
        participo: r[8] === 'SI' ? true : (r[8] === 'NO' ? false : null)
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
 * Relee el padrón + las 5 planillas de formulario, matchea cada respuesta
 * contra el padrón, se queda con la más reciente por (persona, período), la
 * fusiona con el histórico importado una vez (pestaña "Historico" — ver
 * importHistoricalSummary()) y reescribe la pestaña "Cache" dentro de la
 * planilla padrón. El histórico cubre los (persona, mes) que las 5
 * planillas en vivo no tienen; cuando ambos tienen datos para el mismo mes,
 * gana lo recién leído de las planillas en vivo. Se puede llamar
 * manualmente (editor de Apps Script, o vía ?action=recompute) o desde el
 * trigger diario instalado por createDailyTrigger().
 */
function recomputeCache() {
  var ss = SpreadsheetApp.openById(ROSTER_SHEET.id);
  var roster = parseRosterMatrix_(matrixFromSheet_(getSheetByGid_(ss, ROSTER_SHEET.gid)));

  // Base: lo importado una vez desde el resumen histórico, si existe.
  // "Cache" se reescribe entera en cada corrida, pero "Historico" nunca la
  // toca esta función — solo la lee.
  var merged = {}; // "nombre|periodKey" -> fila en formato de salida (array)
  var historicoSheet = ss.getSheetByName(HISTORICAL_SHEET_NAME);
  if (historicoSheet) {
    readCacheSheet_(historicoSheet).forEach(function (r) {
      merged[r.nombre + '|' + r.periodKey] = rowObjectToArray_(r);
    });
  }

  var allFormRows = [];
  var sheetStatus = [];
  for (var i = 0; i < FORM_SHEETS.length; i++) {
    var cfg = FORM_SHEETS[i];
    try {
      var formSs = SpreadsheetApp.openById(cfg.id);
      var matrix = matrixFromSheet_(getSheetByGid_(formSs, cfg.gid));
      allFormRows = allFormRows.concat(parseFormMatrix_(matrix));
      sheetStatus.push({ ok: true, error: null });
    } catch (e) {
      sheetStatus.push({ ok: false, error: String(e) });
    }
  }

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

  // Lo recién leído de las 5 planillas en vivo pisa al histórico para el
  // mismo (persona, período) — el histórico solo rellena los huecos.
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
      row.participated === true ? 'SI' : (row.participated === false ? 'NO' : '')
    ];
  });

  var cacheRows = Object.keys(merged).map(function (key) { return merged[key]; });
  cacheRows.sort(function (a, b) {
    if (a[1] !== b[1]) return a[1] < b[1] ? -1 : 1;
    return a[5] - b[5];
  });

  var cacheSheet = ss.getSheetByName(CACHE_SHEET_NAME);
  if (!cacheSheet) cacheSheet = ss.insertSheet(CACHE_SHEET_NAME);
  cacheSheet.clearContents();
  var header = ['Grupo', 'Nombre', 'Año', 'Mes', 'MesIndex', 'PeriodKey', 'Situacion', 'Horas', 'Participo'];
  cacheSheet.getRange(1, 1, 1, header.length).setValues([header]);
  if (cacheRows.length) {
    cacheSheet.getRange(2, 1, cacheRows.length, header.length).setValues(cacheRows);
  }

  // El banner de "nombres sin coincidencia" muestra tanto lo que no
  // matcheó en esta corrida (planillas en vivo) como lo que no matcheó en
  // la importación histórica (que no se vuelve a correr sola).
  var historicalUnmatched = [];
  try {
    historicalUnmatched = JSON.parse(PropertiesService.getScriptProperties().getProperty('HISTORICAL_UNMATCHED') || '[]');
  } catch (e) { /* no se corrió importHistoricalSummary() todavía */ }
  var allUnmatched = {};
  Object.keys(unmatchedSet).forEach(function (n) { allUnmatched[n] = true; });
  historicalUnmatched.forEach(function (n) { allUnmatched[n] = true; });

  var meta = {
    generatedAt: new Date().toISOString(),
    sheetStatus: sheetStatus,
    unmatched: Object.keys(allUnmatched).sort()
  };
  PropertiesService.getScriptProperties().setProperty('CACHE_META', JSON.stringify(meta));
  return meta;
}

/**
 * Correr UNA SOLA VEZ a mano desde el editor de Apps Script, para poblar el
 * histórico previo a este sistema a partir de las pestañas de "resumen
 * mensual" (HISTORICAL_SUMMARY_SHEETS: columnas Persona / Mes Año /
 * Situación / Participó / Horas — el número de grupo no importa, se
 * resuelve contra el padrón actual igual que todo lo demás; columnas
 * extra a la derecha, como el bloque sin encabezado de "Respaldo", se
 * ignoran solas). Escribe el
 * resultado en la pestaña "Historico" (se puede volver a correr si hace
 * falta corregir algo: siempre relee la fuente entera y reescribe esa
 * pestaña, nunca toca "Cache" directamente). Después de correrla, corré
 * "Recalcular ahora" (o recomputeCache) para que ese histórico se refleje
 * en "Cache".
 */
function importHistoricalSummary() {
  var ss = SpreadsheetApp.openById(ROSTER_SHEET.id);
  var roster = parseRosterMatrix_(matrixFromSheet_(getSheetByGid_(ss, ROSTER_SHEET.gid)));

  var rows = [];
  HISTORICAL_SUMMARY_SHEETS.forEach(function (cfg) {
    var histSs = SpreadsheetApp.openById(cfg.id);
    var histMatrix = matrixFromSheet_(getSheetByGid_(histSs, cfg.gid));
    rows = rows.concat(parseHistoricalMatrix_(histMatrix));
  });

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

  var outRows = Object.keys(byKey).map(function (key) {
    var entry = byKey[key], row = entry.row;
    var year = Math.floor(row.periodKey / 12), monthIdx = row.periodKey % 12;
    return [
      entry.grupo,
      entry.canonical,
      year,
      titleCase_(MONTHS_[monthIdx]),
      monthIdx,
      row.periodKey,
      row.situacionBucket || 'Otro',
      row.horas == null ? '' : row.horas,
      row.participated === true ? 'SI' : (row.participated === false ? 'NO' : '')
    ];
  });
  outRows.sort(function (a, b) {
    if (a[1] !== b[1]) return a[1] < b[1] ? -1 : 1;
    return a[5] - b[5];
  });

  var histSheet = ss.getSheetByName(HISTORICAL_SHEET_NAME);
  if (!histSheet) histSheet = ss.insertSheet(HISTORICAL_SHEET_NAME);
  histSheet.clearContents();
  var header = ['Grupo', 'Nombre', 'Año', 'Mes', 'MesIndex', 'PeriodKey', 'Situacion', 'Horas', 'Participo'];
  histSheet.getRange(1, 1, 1, header.length).setValues([header]);
  if (outRows.length) {
    histSheet.getRange(2, 1, outRows.length, header.length).setValues(outRows);
  }

  var unmatched = Object.keys(unmatchedSet).sort();
  PropertiesService.getScriptProperties().setProperty('HISTORICAL_UNMATCHED', JSON.stringify(unmatched));

  var summary = { importedRows: outRows.length, totalSourceRows: rows.length, unmatched: unmatched };
  Logger.log(JSON.stringify(summary));
  return summary;
}

function rowObjectToArray_(r) {
  return [
    r.grupo, r.nombre, r.anio, r.mes, r.mesIndex, r.periodKey, r.situacion,
    r.horas == null ? '' : r.horas,
    r.participo === true ? 'SI' : (r.participo === false ? 'NO' : '')
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
  return (s == null ? '' : String(s))
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

  var best = null, bestDist = Infinity;
  for (var j = 0; j < rosterList.length; j++) {
    var r = rosterList[j];
    var maxLen = Math.max(normName.length, r.normName.length);
    var d = levenshtein_(normName, r.normName);
    if (d <= fuzzyThreshold_(maxLen) && d < bestDist) { best = r; bestDist = d; }
  }
  return best;
}

// Filas del PADRÓN maestro (columnas Grupo / Nombre).
function parseRosterMatrix_(matrix) {
  if (!matrix || !matrix.length) return [];
  var headerNorm = matrix[0].map(normalize_);
  var find = colFinder_(headerNorm);
  var idx = { grupo: find(/^grupo$/), nombre: find(/^nombre$/) };
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
    out.push({ grupo: grupoNum, canonical: titleCase_(rawName), normName: normMatch });
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
    horas: find(/^horas$/)
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
    horas: find(/^horas$/)
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
    out.push({
      rawName: rawName,
      normName: normalize_(rawName),
      monthIdx: mIdx,
      year: isNaN(yearNum) ? null : yearNum,
      participated: partNorm === 'si' ? true : (partNorm === 'no' ? false : null),
      situacionBucket: classifySituacion_(situacionRaw),
      horas: isNaN(horasNum) ? null : horasNum,
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
