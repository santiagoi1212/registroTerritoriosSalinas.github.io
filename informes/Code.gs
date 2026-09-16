// Google Apps Script: pegar este código en el editor de Apps Script
// (Extensiones > Apps Script) de la planilla de Google donde querés
// guardar las respuestas, y desplegarlo como Web App.

const NOMBRE_HOJA_RESPUESTAS = "Respuestas";

// Planilla donde está la lista de publicadores por grupo.
// Si es la MISMA planilla donde desplegás este script, podés dejar este ID
// (no hace falta cambiarlo) o directamente usar getActiveSpreadsheet().
const ID_PLANILLA_PUBLICADORES = "10iAtM2jSdqSOZ6ot0u-OILEm58BrO9dbnK_Lp4ks3qk";
const NOMBRE_HOJA_PUBLICADORES = "Publicadores";

function doPost(e) {
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
