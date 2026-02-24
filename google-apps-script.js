// ===================================================================
// GOOGLE APPS SCRIPT — Pegar en el editor de Apps Script de tu hoja
// Versión 2.0 — incluye Estudio Atalaya y celular
// ===================================================================
// 1. Abrí tu Google Spreadsheet
// 2. Extensiones > Apps Script
// 3. Reemplazá todo el contenido con este código
// 4. Implementar > Nueva implementación > Aplicación web
//    Ejecutar como: Yo | Quién puede acceder: Cualquier usuario
// 5. Copiá la URL y pegala en app.js (SHEETS_WEBAPP_URL)
// ===================================================================

const SPREADSHEET_ID = SpreadsheetApp.getActiveSpreadsheet().getId();
const SHEET_PERSONAS = 'Personas';
const SHEET_CRONOGRAMAS = 'Cronogramas';

function doPost(e) {
  const data = JSON.parse(e.postData.contents);
  let result;
  try {
    switch (data.action) {
      case 'getAll':    result = getAllData(); break;
      case 'saveAll':   saveAllData(data.personas, data.cronogramas); result = { ok: true }; break;
      default:          result = { error: 'Acción desconocida' };
    }
  } catch (err) { result = { error: err.message }; }
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return ContentService.createTextOutput(JSON.stringify(getAllData())).setMimeType(ContentService.MimeType.JSON);
}

function getAllData() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  ensureSheetsExist(ss);
  return { personas: getPersonas(ss), cronogramas: getCronogramas(ss) };
}

function saveAllData(personas, cronogramas) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  ensureSheetsExist(ss);
  savePersonas(ss, personas);
  saveCronogramas(ss, cronogramas);
}

function ensureSheetsExist(ss) {
  [SHEET_PERSONAS, SHEET_CRONOGRAMAS].forEach(name => {
    if (!ss.getSheetByName(name)) ss.insertSheet(name);
  });
}

// --- PERSONAS ---
function getPersonas(ss) {
  const data = ss.getSheetByName(SHEET_PERSONAS).getDataRange().getValues();
  if (data.length <= 1) return [];
  return data.slice(1).map(row => ({
    id: row[0], nombre: row[1], apellido: row[2],
    celular: row[3] || '',
    departamentos: row[4] ? row[4].split('|') : [],
    rolesAcomo:    row[5] ? row[5].split('|') : [],
    rolesAV:       row[6] ? row[6].split('|') : [],
    rolesAtalaya:  row[7] ? row[7].split('|') : [],
    ultimaAsignacion: row[8] || null
  })).filter(p => p.id);
}

function savePersonas(ss, personas) {
  const sheet = ss.getSheetByName(SHEET_PERSONAS);
  sheet.clearContents();
  const header = ['ID','Nombre','Apellido','Celular','Departamentos','RolesAcomo','RolesAV','RolesAtalaya','UltimaAsignacion'];
  const rows = personas.map(p => [
    p.id, p.nombre, p.apellido, p.celular || '',
    (p.departamentos||[]).join('|'), (p.rolesAcomo||[]).join('|'),
    (p.rolesAV||[]).join('|'), (p.rolesAtalaya||[]).join('|'),
    p.ultimaAsignacion || ''
  ]);
  sheet.getRange(1,1,1,header.length).setValues([header]).setFontWeight('bold');
  if (rows.length > 0) sheet.getRange(2,1,rows.length,header.length).setValues(rows);
}

// --- CRONOGRAMAS ---
function getCronogramas(ss) {
  const data = ss.getSheetByName(SHEET_CRONOGRAMAS).getDataRange().getValues();
  if (data.length <= 1) return [];
  return data.slice(1).map(row => ({
    id: row[0], mes: row[1], fechaInicio: row[2],
    acomodadores: row[3] ? JSON.parse(row[3]) : {},
    audioVideo:   row[4] ? JSON.parse(row[4]) : {},
    presidencia:  row[5] ? JSON.parse(row[5]) : {},
    conferencia:  row[6] ? row[6].split('|').filter(Boolean) : [],
    atalaya:      row[7] ? JSON.parse(row[7]) : {}
  })).filter(c => c.id);
}

function saveCronogramas(ss, cronogramas) {
  const sheet = ss.getSheetByName(SHEET_CRONOGRAMAS);
  sheet.clearContents();
  const header = ['ID','Mes','FechaInicio','Acomodadores','AudioVideo','Presidencia','Conferencia','Atalaya'];
  const rows = cronogramas.map(c => [
    c.id, c.mes, c.fechaInicio,
    JSON.stringify(c.acomodadores||{}),
    JSON.stringify(c.audioVideo||{}),
    JSON.stringify(c.presidencia||{}),
    (c.conferencia||[]).join('|'),
    JSON.stringify(c.atalaya||{})
  ]);
  sheet.getRange(1,1,1,header.length).setValues([header]).setFontWeight('bold');
  if (rows.length > 0) sheet.getRange(2,1,rows.length,header.length).setValues(rows);
}
