// Google Apps Script: pegar este código en el editor de Apps Script
// (Extensiones > Apps Script) de la planilla de Google donde querés
// guardar las respuestas, y desplegarlo como Web App.
//
// Este archivo REEMPLAZA por completo tu script actual: es tu mismo código
// de informes (sin ningún cambio de comportamiento) más las funciones nuevas
// para subir/borrar DPA y Uso de Datos desde publicadores.html.
//
// Por qué está todo junto: Apps Script solo permite una función doPost(e)
// por proyecto. El envío de informes llega como FormData (queda en
// e.parameter) y la subida/borrado de documentos llega como JSON (queda en
// e.postData.contents) — doPost() de abajo mira cuál de los dos llegó y
// despacha a la lógica correspondiente, así no se pisan entre sí.
//
// Después de pegar y volver a desplegar (Implementar > Gestionar
// implementaciones > editar > Nueva versión), copiá la URL en
// PUBLICADORES_API_URL de app-config.js. Va a ser LA MISMA URL que ya usás
// para el envío de informes (SCRIPT_URL en informes/script.js).

const NOMBRE_HOJA_RESPUESTAS = "Respuestas";

// Planilla donde está la lista de publicadores por grupo.
// Si es la MISMA planilla donde desplegás este script, podés dejar este ID
// (no hace falta cambiarlo) o directamente usar getActiveSpreadsheet().
const ID_PLANILLA_PUBLICADORES = "10iAtM2jSdqSOZ6ot0u-OILEm58BrO9dbnK_Lp4ks3qk";
const NOMBRE_HOJA_PUBLICADORES = "Publicadores";

// Carpeta de Drive donde se guardan los archivos subidos desde el modal de
// publicadores.html: https://drive.google.com/drive/folders/12Emr_Qz7OZVTJKQRHmx_FnMUx0M4JT2V
// Adentro se crean solas dos subcarpetas la primera vez que hace falta: "DPA"
// y "Uso de Datos".
const CARPETA_PUBLICADORES_ID = "12Emr_Qz7OZVTJKQRHmx_FnMUx0M4JT2V";
const SUBCARPETA_DPA = "DPA";
const SUBCARPETA_USO_DATOS = "Uso de Datos";

function doPost(e) {
  // JSON (subir/borrar documento) vs FormData (envío de informe mensual).
  if (e.postData && e.postData.type === "application/json") {
    return doPostDocumentos_(e);
  }
  if (e.postData && e.postData.type === "text/plain") {
    // El fetch de publicadores.html manda text/plain a propósito (evita el
    // preflight CORS de application/json), pero el contenido es JSON igual.
    try {
      JSON.parse(e.postData.contents);
      return doPostDocumentos_(e);
    } catch (err) {
      // no era JSON válido: seguir al flujo de informes por las dudas
    }
  }
  return doPostInforme_(e);
}

// ===================================================================
// Informe mensual (código existente, sin cambios de comportamiento)
// ===================================================================
function doPostInforme_(e) {
  try {
    const hoja = obtenerHojaRespuestas();
    const p = e.parameter;

    hoja.appendRow([
      new Date(),
      p.grupo || "",
      p.nombre || "",
      p.mes || "",
      p.anio || "",
      p.participo || "",
      p.situacion || "",
      p.cursos || "",
      p.horas || "",
      p.comentarios || "",
    ]);

    return respuesta({ status: "ok" });
  } catch (err) {
    return respuesta({ status: "error", message: err.message });
  }
}

function doGet(e) {
  try {
    if (e.parameter.action === "publicadores") {
      return respuesta({ status: "ok", publicadores: obtenerPublicadores() });
    }
    return respuesta({ status: "error", message: "Acción no reconocida" });
  } catch (err) {
    return respuesta({ status: "error", message: err.message });
  }
}

function obtenerPublicadores() {
  const libro = SpreadsheetApp.openById(ID_PLANILLA_PUBLICADORES);
  const hoja = libro.getSheetByName(NOMBRE_HOJA_PUBLICADORES);

  if (!hoja) {
    throw new Error(
      'No se encontró la pestaña "' + NOMBRE_HOJA_PUBLICADORES + '"'
    );
  }

  const filas = hoja.getDataRange().getValues();
  const lista = [];

  // Se asume fila 1 = encabezados, columna A = grupo, columna B = nombre.
  for (let i = 1; i < filas.length; i++) {
    const grupo = filas[i][0];
    const nombre = filas[i][1];

    if (grupo !== "" && nombre !== "") {
      lista.push({ grupo: String(grupo).trim(), nombre: String(nombre).trim() });
    }
  }

  return lista;
}

function obtenerHojaRespuestas() {
  const libro = SpreadsheetApp.getActiveSpreadsheet();
  let hoja = libro.getSheetByName(NOMBRE_HOJA_RESPUESTAS);

  if (!hoja) {
    hoja = libro.insertSheet(NOMBRE_HOJA_RESPUESTAS);
    hoja.appendRow([
      "Fecha de envío",
      "Número de grupo",
      "Nombre y Apellido",
      "Mes",
      "Año",
      "Participó",
      "Situación",
      "Número de cursos bíblicos dirigidos",
      "Horas",
      "Comentarios",
    ]);
  }

  return hoja;
}

function respuesta(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

// ===================================================================
// Subir / borrar DPA y Uso de Datos (nuevo, para publicadores.html)
//
// Requiere que la pestaña "Publicadores" tenga, en la fila 1, columnas con
// estos nombres exactos (en cualquier orden): Nombre, DPA, LinkDPA,
// FechaVenceDPA, UsoDatos, LinkAutorizacion.
// ===================================================================
function doPostDocumentos_(e) {
  let result;
  try {
    const data = JSON.parse(e.postData.contents);
    switch (data.action) {
      case "subirDocumento":  result = subirDocumento(data); break;
      case "borrarDocumento": result = borrarDocumento(data); break;
      default:                result = { ok: false, error: "Acción desconocida" };
    }
  } catch (err) {
    result = { ok: false, error: String((err && err.message) || err) };
  }
  return respuesta(result);
}

function getPublicadoresSheet_() {
  const libro = SpreadsheetApp.openById(ID_PLANILLA_PUBLICADORES);
  const hoja = libro.getSheetByName(NOMBRE_HOJA_PUBLICADORES);
  if (!hoja) throw new Error('No se encontró la pestaña "' + NOMBRE_HOJA_PUBLICADORES + '"');
  return hoja;
}

function getHeaderMap_(sheet) {
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const map = {};
  header.forEach((h, i) => { if (h) map[String(h).trim()] = i + 1; });
  return map;
}

function findRowByNombre_(sheet, colNombre, nombre) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  const values = sheet.getRange(2, colNombre, lastRow - 1, 1).getValues();
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0]).trim() === String(nombre).trim()) return i + 2;
  }
  return -1;
}

function getOrCreateSubfolder_(parent, nombre) {
  const it = parent.getFoldersByName(nombre);
  if (it.hasNext()) return it.next();
  return parent.createFolder(nombre);
}

function guardarArchivo_(subcarpetaNombre, fileName, mimeType, base64) {
  const carpetaPadre = DriveApp.getFolderById(CARPETA_PUBLICADORES_ID);
  const folder = getOrCreateSubfolder_(carpetaPadre, subcarpetaNombre);
  const bytes = Utilities.base64Decode(base64);
  const blob = Utilities.newBlob(bytes, mimeType || "application/octet-stream", fileName || "documento");
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}

function subirDocumento(data) {
  const nombre = data.nombre, tipo = data.tipo, fileBase64 = data.fileBase64;
  if (!nombre || !tipo || !fileBase64) return { ok: false, error: "Faltan datos (nombre, tipo o archivo)" };
  if (tipo !== "dpa" && tipo !== "usoDatos") return { ok: false, error: "Tipo inválido: " + tipo };

  const sheet = getPublicadoresSheet_();
  const cols = getHeaderMap_(sheet);
  if (!cols["Nombre"]) return { ok: false, error: 'La hoja no tiene columna "Nombre"' };

  const row = findRowByNombre_(sheet, cols["Nombre"], nombre);
  if (row === -1) return { ok: false, error: 'No se encontró a "' + nombre + '" en la planilla' };

  const subcarpeta = tipo === "dpa" ? SUBCARPETA_DPA : SUBCARPETA_USO_DATOS;
  const url = guardarArchivo_(subcarpeta, data.fileName, data.mimeType, fileBase64);

  let fechaVenceTxt = "";
  if (tipo === "dpa") {
    if (cols["DPA"])      sheet.getRange(row, cols["DPA"]).setValue("Si");
    if (cols["LinkDPA"])  sheet.getRange(row, cols["LinkDPA"]).setValue(url);
    if (cols["FechaVenceDPA"]) {
      const vence = new Date();
      vence.setFullYear(vence.getFullYear() + 2);
      sheet.getRange(row, cols["FechaVenceDPA"]).setValue(vence);
      fechaVenceTxt = Utilities.formatDate(vence, Session.getScriptTimeZone(), "dd/MM/yyyy");
    }
  } else {
    if (cols["UsoDatos"])         sheet.getRange(row, cols["UsoDatos"]).setValue("Si");
    if (cols["LinkAutorizacion"]) sheet.getRange(row, cols["LinkAutorizacion"]).setValue(url);
  }

  return { ok: true, link: url, fechaVenceDPA: fechaVenceTxt };
}

function borrarDocumento(data) {
  const nombre = data.nombre, tipo = data.tipo;
  if (!nombre || !tipo) return { ok: false, error: "Faltan datos (nombre o tipo)" };
  if (tipo !== "dpa" && tipo !== "usoDatos") return { ok: false, error: "Tipo inválido: " + tipo };

  const sheet = getPublicadoresSheet_();
  const cols = getHeaderMap_(sheet);
  if (!cols["Nombre"]) return { ok: false, error: 'La hoja no tiene columna "Nombre"' };

  const row = findRowByNombre_(sheet, cols["Nombre"], nombre);
  if (row === -1) return { ok: false, error: 'No se encontró a "' + nombre + '" en la planilla' };

  if (tipo === "dpa") {
    if (cols["DPA"])           sheet.getRange(row, cols["DPA"]).setValue("");
    if (cols["LinkDPA"])       sheet.getRange(row, cols["LinkDPA"]).setValue("");
    if (cols["FechaVenceDPA"]) sheet.getRange(row, cols["FechaVenceDPA"]).setValue("");
  } else {
    if (cols["UsoDatos"])         sheet.getRange(row, cols["UsoDatos"]).setValue("");
    if (cols["LinkAutorizacion"]) sheet.getRange(row, cols["LinkAutorizacion"]).setValue("");
  }

  return { ok: true };
}
