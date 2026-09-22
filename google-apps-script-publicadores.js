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

// Hoja nueva (dentro de la misma planilla de Publicadores) donde se guardan
// las respuestas del formulario de Datos Personales de datos-personales.html.
// Espeja las preguntas del Google Form que reemplaza. Se crea sola la
// primera vez que alguien envía el formulario.
const NOMBRE_HOJA_DATOS_PERSONALES = "DatosPersonales";
const ENCABEZADOS_DATOS_PERSONALES = [
  "Marca temporal",
  "Nombre completo",
  "Correo electronico",
  "Dirección",
  "Número de teléfono fijo",
  "Numero de teléfono celular",
  "Fecha de nacimiento",
  "Fecha de bautismo",
  "Dato adicional",
  "Servicio de salud - Mutualista",
  "Cuenta con emergencia móvil",
  "Nombre de la emergencia móvil / identificación como socio",
  "Cuenta con servicio de acompañante",
  "Medicación regular",
  "Tiene DPA vigente",
  "Otros datos de salud",
  "Nombre del familiar de contacto",
  "Relación con el familiar",
  "Teléfono del familiar",
];

// Mapa encabezado de la hoja -> nombre del campo que manda datos-personales.html.
const CAMPO_POR_ENCABEZADO_DATOS_PERSONALES = {
  "Nombre completo": "nombre",
  "Correo electronico": "correo",
  "Dirección": "direccion",
  "Número de teléfono fijo": "telefonoFijo",
  "Numero de teléfono celular": "telefonoCelular",
  "Fecha de nacimiento": "fechaNacimiento",
  "Fecha de bautismo": "fechaBautismo",
  "Dato adicional": "datoAdicional",
  "Servicio de salud - Mutualista": "mutualista",
  "Cuenta con emergencia móvil": "emergenciaMovil",
  "Nombre de la emergencia móvil / identificación como socio": "nombreEmergenciaMovil",
  "Cuenta con servicio de acompañante": "servicioAcompanante",
  "Medicación regular": "medicacionRegular",
  "Tiene DPA vigente": "tieneDPAVigente",
  "Otros datos de salud": "otrosDatosSalud",
  "Nombre del familiar de contacto": "nombreFamiliar",
  "Relación con el familiar": "relacionFamiliar",
  "Teléfono del familiar": "telefonoFamiliar",
};

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
    if (e.parameter.action === "publicadoresDetalle") {
      return respuesta({ status: "ok", publicadores: obtenerPublicadoresDetalle_() });
    }
    if (e.parameter.action === "datosPersonales") {
      const r = obtenerDatosPersonalesDePersona_(e.parameter.nombre);
      return respuesta({ status: r.ok ? "ok" : "error", datos: r.datos, message: r.error });
    }
    return respuesta({ status: "error", message: "Acción no reconocida" });
  } catch (err) {
    return respuesta({ status: "error", message: err.message });
  }
}

// Versión completa de obtenerPublicadores(), pensada para reemplazar al CSV
// público (PUBLICADORES_CSV_URL) que publicadores.html / app-publicadores.js
// usaban antes: cuando Google bloquea el "Publicar en la web" (redirige a
// login por política de la cuenta/organización), esta ruta sigue funcionando
// porque el script corre con los permisos de quien lo desplegó, sin depender
// de que la hoja esté publicada. Devuelve las mismas columnas que esperaba
// el parseo del CSV (por nombre de encabezado, no por posición).
// Mismo criterio de "sin acentos, minúscula" que normalizeName() del lado
// del cliente (app-publicadores.js) — se usa acá para cruzar nombres entre
// la pestaña "publicadores" y la pestaña "Respuestas" (informe mensual) sin
// que un tilde o una mayúscula distinta rompa el cruce.
function normalizarNombre_(s) {
  return String(s || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Último informe mensual (pestaña "Respuestas") de cada persona: el más
// reciente por "Fecha de envío". Devuelve un Map clave-normalizada ->
// {nombre, grupo, situacion}. Se usa para (a) el gráfico de categorías de
// Estadísticas (Precursor Regular/Auxiliar/Especial/Publicador, tal como la
// persona lo reportó ese mes) y (b) como respaldo del grupo para alguien
// que todavía no tiene fila en "publicadores".
function obtenerUltimosInformesPorPersona_() {
  const libro = SpreadsheetApp.openById(ID_PLANILLA_PUBLICADORES);
  const hoja = libro.getSheetByName(NOMBRE_HOJA_RESPUESTAS);
  const resultado = new Map();
  if (!hoja) return resultado;
  const lastRow = hoja.getLastRow();
  if (lastRow < 2) return resultado;

  // Columnas fijas (ver obtenerHojaRespuestas()): A Fecha envío, B Grupo,
  // C Nombre, D Mes, E Año, F Participó, G Situación, H Cursos, I Horas, J Comentarios.
  const filas = hoja.getRange(2, 1, lastRow - 1, 10).getValues();
  filas.forEach((fila) => {
    const nombre = String(fila[2] || "").trim();
    if (!nombre) return;
    const clave = normalizarNombre_(nombre);
    const fecha = fila[0];
    const fechaMs = esFecha_(fecha) ? fecha.getTime() : 0;

    const actual = resultado.get(clave);
    if (actual && actual.fechaMs > fechaMs) return; // ya hay uno más reciente

    resultado.set(clave, {
      fechaMs,
      nombre,
      grupo: fila[1] === "" || fila[1] === null || fila[1] === undefined ? "" : String(fila[1]),
      situacion: String(fila[6] || "").trim(),
    });
  });
  return resultado;
}

// Combina la pestaña "publicadores" (DPA, Uso de Datos, Datos Personales,
// Sexo, Estado/rol — todo lo que se edita a mano desde el modal) con la
// pestaña "Respuestas" (informe mensual): la lista final es la UNIÓN de
// ambas, para no perder de vista a nadie que ya estaba siendo trackeado
// aunque todavía no haya enviado ningún informe. El grupo mostrado es el de
// "publicadores" si esa persona tiene fila ahí (así "Organizar grupos"
// sigue funcionando); si no tiene fila, se usa el grupo de su último
// informe. SituacionInforme es la categoría (Precursor Regular/Auxiliar/
// Especial/Publicador) que esa persona reportó en su informe más reciente
// — se usa en el gráfico de categorías de Estadísticas en vez de "Estado".
function obtenerPublicadoresDetalle_() {
  const sheet = getPublicadoresSheet_();
  const cols = getHeaderMap_(sheet);
  const lastRow = sheet.getLastRow();

  const leer = (fila, nombreCol) => {
    const idx = cols[nombreCol];
    if (!idx) return "";
    const v = fila[idx - 1];
    if (esFecha_(v)) return Utilities.formatDate(v, Session.getScriptTimeZone(), "dd/MM/yyyy");
    return v === null || v === undefined ? "" : String(v);
  };

  const porNombrePublicadores = new Map(); // clave normalizada -> fila cruda de "publicadores"
  if (lastRow >= 2) {
    const colNombre = cols["Nombre"];
    const filas = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    filas.forEach((fila) => {
      const nombre = colNombre ? String(fila[colNombre - 1] || "").trim() : "";
      if (!nombre) return;
      porNombrePublicadores.set(normalizarNombre_(nombre), fila);
    });
  }

  const ultimosInformes = obtenerUltimosInformesPorPersona_();
  const claves = new Set([...porNombrePublicadores.keys(), ...ultimosInformes.keys()]);

  const resultado = [];
  claves.forEach((clave) => {
    const filaPub = porNombrePublicadores.get(clave);
    const ultimoInforme = ultimosInformes.get(clave);
    const leerPub = (nombreCol) => (filaPub ? leer(filaPub, nombreCol) : "");

    const grupoPub = leerPub("Grupo");
    const grupo = grupoPub !== "" ? grupoPub : (ultimoInforme ? ultimoInforme.grupo : "");
    const nombre = filaPub ? leerPub("Nombre") : (ultimoInforme ? ultimoInforme.nombre : "");

    resultado.push({
      Grupo: grupo,
      Nombre: nombre,
      Sexo: leerPub("Sexo"),
      Estado: leerPub("Estado"),
      DPA: leerPub("DPA"),
      LinkDPA: leerPub("LinkDPA"),
      FechaVenceDPA: leerPub("FechaVenceDPA"),
      UsoDatos: leerPub("UsoDatos"),
      LinkAutorizacion: leerPub("LinkAutorizacion"),
      DatosPersonales: leerPub("DatosPersonales"),
      DatosPersonalesFecha: leerPub("DatosPersonalesFecha"),
      Notas: leerPub("Notas"),
      SituacionInforme: ultimoInforme ? ultimoInforme.situacion : "",
    });
  });

  return resultado;
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

// Chequeo de "es una fecha" más confiable que `instanceof Date`: los valores
// que devuelve getValues() para celdas de fecha a veces no pasan
// `instanceof Date` en el contexto de una web app (aunque se comporten como
// fecha), así que se compara por el nombre interno del tipo en vez de por
// identidad de constructor.
function esFecha_(v) {
  return v !== null && typeof v === "object" && Object.prototype.toString.call(v) === "[object Date]";
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
      case "subirDocumento":         result = subirDocumento(data); break;
      case "borrarDocumento":        result = borrarDocumento(data); break;
      case "guardarDatosPersonales":       result = guardarDatosPersonales(data); break;
      case "actualizarDatosPersonalesAdmin": result = actualizarDatosPersonalesAdmin(data); break;
      case "cambiarGrupo":                 result = cambiarGrupoPublicador(data); break;
      case "cambiarEstado":                result = cambiarEstadoPublicador(data); break;
      case "agregarPublicador":            result = agregarPublicador(data); break;
      case "eliminarPublicador":           result = eliminarPublicador(data); break;
      default:                       result = { ok: false, error: "Acción desconocida" };
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
  if (sheet.getLastColumn() < 1) return {}; // hoja completamente vacía, sin encabezados todavía
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

// ===================================================================
// Formulario de Datos Personales (nuevo, para datos-personales.html)
//
// Reemplaza al Google Form: las respuestas se guardan en la hoja
// "DatosPersonales" de esta misma planilla, una fila por persona (si la
// persona ya había enviado el formulario antes, se actualiza su fila en
// vez de duplicarla). Solo se acepta el envío si esa persona ya tiene el
// Uso de Datos cargado y aprobado (columna UsoDatos = "Si") con su link
// (LinkAutorizacion) — se vuelve a validar acá aunque el front ya lo
// chequee, por si alguien llama a la API directo.
// ===================================================================
function verificarUsoDatosListo_(nombre) {
  const sheet = getPublicadoresSheet_();
  const cols = getHeaderMap_(sheet);
  if (!cols["Nombre"]) return { ok: false, error: 'La hoja "' + NOMBRE_HOJA_PUBLICADORES + '" no tiene columna "Nombre"' };

  const row = findRowByNombre_(sheet, cols["Nombre"], nombre);
  if (row === -1) return { ok: false, error: 'No se encontró a "' + nombre + '" en la planilla de Publicadores' };

  const usoDatos = cols["UsoDatos"] ? String(sheet.getRange(row, cols["UsoDatos"]).getValue() || "").trim().toLowerCase() : "";
  const linkAutorizacion = cols["LinkAutorizacion"] ? String(sheet.getRange(row, cols["LinkAutorizacion"]).getValue() || "").trim() : "";
  // Alcanza con que la columna diga "Si": hay personas cargadas a mano en la
  // planilla (antes de que existiera la subida de archivo) que tienen el
  // "Si" pero nunca un LinkAutorizacion, y no corresponde bloquearlas por eso.
  const listo = (usoDatos === "si" || usoDatos === "sí");

  return { ok: true, listo, usoDatos, linkAutorizacion };
}

function getOrCreateDatosPersonalesSheet_() {
  const libro = SpreadsheetApp.openById(ID_PLANILLA_PUBLICADORES);
  let hoja = libro.getSheetByName(NOMBRE_HOJA_DATOS_PERSONALES);
  if (!hoja) {
    hoja = libro.insertSheet(NOMBRE_HOJA_DATOS_PERSONALES);
  }
  // Por si la hoja ya existía pero vacía (de alguna prueba anterior): escribe
  // los encabezados igual, no solo cuando se acaba de crear la hoja.
  if (hoja.getLastRow() === 0) {
    hoja.appendRow(ENCABEZADOS_DATOS_PERSONALES);
    hoja.getRange(1, 1, 1, ENCABEZADOS_DATOS_PERSONALES.length).setFontWeight("bold");
  }
  return hoja;
}

// Escribe/actualiza la fila de una persona en la hoja DatosPersonales.
// Compartido entre el envío propio (guardarDatosPersonales, con gate de Uso
// de Datos) y la edición desde el modal de admin (actualizarDatosPersonalesAdmin,
// sin gate).
function guardarFilaDatosPersonales_(nombre, data) {
  const hoja = getOrCreateDatosPersonalesSheet_();
  const cols = getHeaderMap_(hoja);
  const colNombre = cols["Nombre completo"];

  const fila = ENCABEZADOS_DATOS_PERSONALES.map((encabezado) => {
    if (encabezado === "Marca temporal") return new Date();
    const campo = CAMPO_POR_ENCABEZADO_DATOS_PERSONALES[encabezado];
    return (campo && data[campo]) || "";
  });

  const filaExistente = colNombre ? findRowByNombre_(hoja, colNombre, nombre) : -1;
  if (filaExistente === -1) {
    hoja.appendRow(fila);
  } else {
    hoja.getRange(filaExistente, 1, 1, fila.length).setValues([fila]);
  }
}

function guardarDatosPersonales(data) {
  const nombre = data.nombre;
  if (!nombre) return { ok: false, error: "Falta el nombre" };

  const estado = verificarUsoDatosListo_(nombre);
  if (!estado.ok) return estado;
  if (!estado.listo) {
    return { ok: false, error: "Todavía no tenés el Uso de Datos cargado y aprobado. Pedile a tu capitán/admin que lo suba primero en Publicadores." };
  }

  guardarFilaDatosPersonales_(nombre, data);
  marcarDatosPersonalesEnPublicadores_(nombre);

  return { ok: true };
}

// Edición desde el modal de publicadores.html (admin/capitán viendo la ficha
// de la persona). No exige el gate de Uso de Datos: si ya está viendo el
// modal con "Datos Personales: Sí" es porque ya existe el registro y lo está
// corrigiendo, no enviándolo por primera vez.
function actualizarDatosPersonalesAdmin(data) {
  const nombre = data.nombre;
  if (!nombre) return { ok: false, error: "Falta el nombre" };

  guardarFilaDatosPersonales_(nombre, data);
  marcarDatosPersonalesEnPublicadores_(nombre);

  return { ok: true };
}

// Devuelve las respuestas guardadas de una persona (para mostrarlas/editarlas
// en el modal de publicadores.html). datos:null si todavía no envió nada.
function obtenerDatosPersonalesDePersona_(nombre) {
  if (!nombre) return { ok: false, error: "Falta el nombre" };

  const hoja = getOrCreateDatosPersonalesSheet_();
  const cols = getHeaderMap_(hoja);
  const colNombre = cols["Nombre completo"];
  const row = colNombre ? findRowByNombre_(hoja, colNombre, nombre) : -1;
  if (row === -1) return { ok: true, datos: null };

  const valores = hoja.getRange(row, 1, 1, ENCABEZADOS_DATOS_PERSONALES.length).getValues()[0];
  const datos = {};
  ENCABEZADOS_DATOS_PERSONALES.forEach((encabezado, i) => {
    const campo = CAMPO_POR_ENCABEZADO_DATOS_PERSONALES[encabezado];
    if (!campo) return; // "Marca temporal" no tiene campo de formulario
    let v = valores[i];
    if (esFecha_(v)) v = Utilities.formatDate(v, Session.getScriptTimeZone(), "dd/MM/yyyy");
    datos[campo] = v === null || v === undefined ? "" : String(v);
  });

  return { ok: true, datos };
}

// Marca "DatosPersonales" = "Si" (y la fecha, si existe esa columna) en la
// hoja Publicadores — la misma hoja que ya se publica como CSV público para
// que el sitio muestre el estado. Así el estado "hecho/pendiente" se ve sin
// tener que publicar la hoja "DatosPersonales" (que sí tiene datos
// sensibles: salud, dirección, contacto familiar, etc.) en ningún lado.
function marcarDatosPersonalesEnPublicadores_(nombre) {
  const sheet = getPublicadoresSheet_();
  const cols = getHeaderMap_(sheet);
  if (!cols["Nombre"]) return;
  const row = findRowByNombre_(sheet, cols["Nombre"], nombre);
  if (row === -1) return;

  if (cols["DatosPersonales"]) sheet.getRange(row, cols["DatosPersonales"]).setValue("Si");
  if (cols["DatosPersonalesFecha"]) {
    sheet.getRange(row, cols["DatosPersonalesFecha"]).setValue(
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy")
    );
  }
}

// ===================================================================
// Organizar grupos (nuevo, para la pestaña "Organizar grupos" de
// publicadores.html): mueve a una persona de su grupo actual a otro,
// simplemente reescribiendo la columna "Grupo" de su fila.
// ===================================================================
function cambiarGrupoPublicador(data) {
  const nombre = data.nombre;
  const grupo = data.grupo;
  if (!nombre) return { ok: false, error: "Falta el nombre" };
  if (!grupo && grupo !== 0) return { ok: false, error: "Falta el grupo destino" };

  const sheet = getPublicadoresSheet_();
  const cols = getHeaderMap_(sheet);
  if (!cols["Nombre"]) return { ok: false, error: 'La hoja no tiene columna "Nombre"' };
  if (!cols["Grupo"]) return { ok: false, error: 'La hoja no tiene columna "Grupo"' };

  const row = findRowByNombre_(sheet, cols["Nombre"], nombre);
  if (row === -1) return { ok: false, error: 'No se encontró a "' + nombre + '" en la planilla' };

  sheet.getRange(row, cols["Grupo"]).setValue(grupo);
  return { ok: true };
}

// ===================================================================
// Estado (nuevo, para el modal de publicadores.html): asigna/quita hasta
// dos estados (Anciano, Siervo Ministerial, Publicador, Publicador No
// Bautizado, Precursor Regular, Precursor Especial), reescribiendo la
// columna "Estado" de la fila de esa persona. data.estados es un array
// (0, 1 o 2 elementos); se guarda uno por otro, separados por ", ", igual
// formato que ya venía usando la planilla (ej: "Anciano, Precursor Regular").
// Un array vacío borra el estado.
//
// Si la persona es Femenino (columna "Sexo"), se rechaza Anciano/Siervo
// Ministerial — son estados que no aplican a una publicadora. Esto es
// además de la restricción que ya aplica publicadores.html en el modal;
// queda acá también por si alguna vez se llama a esta acción de otro lado.
// ===================================================================
function cambiarEstadoPublicador(data) {
  const nombre = data.nombre;
  const estados = Array.isArray(data.estados) ? data.estados.filter(Boolean).slice(0, 2) : [];
  if (!nombre) return { ok: false, error: "Falta el nombre" };

  const sheet = getPublicadoresSheet_();
  const cols = getHeaderMap_(sheet);
  if (!cols["Nombre"]) return { ok: false, error: 'La hoja no tiene columna "Nombre"' };
  if (!cols["Estado"]) return { ok: false, error: 'La hoja no tiene columna "Estado"' };

  const row = findRowByNombre_(sheet, cols["Nombre"], nombre);
  if (row === -1) return { ok: false, error: 'No se encontró a "' + nombre + '" en la planilla' };

  if (cols["Sexo"]) {
    const sexo = String(sheet.getRange(row, cols["Sexo"]).getValue() || "").trim();
    if (sexo === "Femenino" && estados.some(e => e === "Anciano" || e === "Siervo Ministerial")) {
      return { ok: false, error: "Anciano y Siervo Ministerial no aplican a una publicadora" };
    }
  }

  sheet.getRange(row, cols["Estado"]).setValue(estados.join(", "));
  return { ok: true };
}

// ===================================================================
// ABM de publicadores (nuevo, para el formulario "Agregar publicador" y el
// botón "Eliminar" del modal en publicadores.html).
// ===================================================================
function agregarPublicador(data) {
  const nombre = String(data.nombre || "").trim();
  const grupo = data.grupo;
  const sexo = String(data.sexo || "").trim();
  if (!nombre) return { ok: false, error: "Falta el nombre" };
  if (!grupo && grupo !== 0) return { ok: false, error: "Falta el grupo" };

  const sheet = getPublicadoresSheet_();
  const cols = getHeaderMap_(sheet);
  if (!cols["Nombre"]) return { ok: false, error: 'La hoja no tiene columna "Nombre"' };
  if (!cols["Grupo"]) return { ok: false, error: 'La hoja no tiene columna "Grupo"' };

  if (findRowByNombre_(sheet, cols["Nombre"], nombre) !== -1) {
    return { ok: false, error: 'Ya existe "' + nombre + '" en la planilla' };
  }

  const fila = new Array(sheet.getLastColumn()).fill("");
  fila[cols["Nombre"] - 1] = nombre;
  fila[cols["Grupo"] - 1] = grupo;
  if (sexo && cols["Sexo"]) fila[cols["Sexo"] - 1] = sexo;
  sheet.appendRow(fila);

  return { ok: true };
}

function eliminarPublicador(data) {
  const nombre = data.nombre;
  if (!nombre) return { ok: false, error: "Falta el nombre" };

  const sheet = getPublicadoresSheet_();
  const cols = getHeaderMap_(sheet);
  if (!cols["Nombre"]) return { ok: false, error: 'La hoja no tiene columna "Nombre"' };

  const row = findRowByNombre_(sheet, cols["Nombre"], nombre);
  if (row === -1) return { ok: false, error: 'No se encontró a "' + nombre + '" en la planilla' };

  sheet.deleteRow(row);
  return { ok: true };
}
