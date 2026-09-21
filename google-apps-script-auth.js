// Google Apps Script: pegar TODO este archivo en "server.gs" (el proyecto
// que atiende AUTH_API_URL, ligado a la planilla
// 1zcsQ2VQyZlawJdEdLHyrBKJ3AYcZ4eGL8b5eeTHZnl4), reemplazando su contenido
// actual. Después, BORRAR el archivo "codigo.gs" de ese mismo proyecto (con
// el "..." al lado del nombre del archivo, en el panel izquierdo) — tiene
// que quedar UN SOLO archivo .gs con doGet/doPost, si no vuelve a pasar lo
// mismo. Por último: Implementar > Administrar implementaciones > (lápiz)
// editar la implementación existente > Nueva versión > Implementar.
//
// Por qué este archivo trae también código de "Revisitas/Estudios" que no
// tiene nada que ver con el login: este mismo proyecto de Apps Script ya
// tenía ese código en server.gs (probablemente lo usan revisitas-api.js /
// revisitas.app.js del sitio) — Apps Script solo permite UN doGet y UN
// doPost por proyecto, así que hay que fusionar los dos en vez de tener dos
// archivos que definan la misma función (eso fue justo el bug: al haber dos
// doGet en archivos distintos, uno pisaba al otro sin avisar).
//
// Qué hace cada parte:
//   - doGet ?op=login       : login real del portal (GET, como ya lo llama
//                             app-auth.js).
//   - doGet ?op=validate    : valida un token temporal (código previo, sin
//                             cambios).
//   - doGet ?action=list / ?action=save : Revisitas/Estudios — CÓDIGO
//                             ORIGINAL DE ESTE PROYECTO, sin ningún cambio
//                             de comportamiento, solo movido a este mismo
//                             doGet para que conviva con el de login.
//   - doPost action=...     : ABM de usuarios del portal (listar/crear/
//                             editar/resetear contraseña/eliminar), usado
//                             por la pestaña "Administradores" de
//                             publicadores.html. Si el body no trae una de
//                             esas acciones, cae al mensaje original de
//                             Revisitas ("use_action_via_GET"), sin cambios.

/***** ============ LOGIN / ABM DE USUARIOS (portal Salinas) ============ *****/

const SHEET_ID   = '1zcsQ2VQyZlawJdEdLHyrBKJ3AYcZ4eGL8b5eeTHZnl4';
const SHEET_NAME = 'Usuarios';

// Este portal es específicamente el de la congregación Salinas: si una
// cuenta tiene cargada una congregación distinta, no puede entrar acá (por
// si en el futuro este mismo backend se reutiliza para otra congregación).
// Las cuentas SIN congregación cargada (todas las que ya existían antes de
// agregar esta columna) se tratan como si fueran de Salinas, para no
// trabarle el login a nadie el día que se despliega este cambio.
const CONGREGACION_PORTAL = 'Salinas';

const CAMPOS_USUARIO = ['username', 'salt', 'hash_hex', 'role', 'nombre', 'apellido', 'congregacion'];

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/***** LOGIN CORE *****/
function apiLogin(username, password) {
  username = String(username || '').trim();
  password = String(password || '');
  if (!username || !password) return { ok: false, error: 'Faltan credenciales' };

  const user = findUser(username);
  if (!user) return { ok: false, error: 'Usuario o contraseña inválidos' };

  const candidateHex = sha256Hex(password + user.salt);
  if (!timingSafeEqual(user.hashHex, candidateHex)) {
    return { ok: false, error: 'Usuario o contraseña inválidos' };
  }

  const congregacionEfectiva = user.congregacion || CONGREGACION_PORTAL;
  if (normalizarTexto_(congregacionEfectiva) !== normalizarTexto_(CONGREGACION_PORTAL)) {
    return { ok: false, error: 'Esta cuenta no pertenece a la congregación ' + CONGREGACION_PORTAL };
  }

  return { ok: true, user: user.username, username: user.username, role: user.role || '', nombre: user.nombre || '', apellido: user.apellido || '' };
}

function normalizarTexto_(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/***** DATA (hoja "Usuarios") *****/
function getUsuariosSheet_() {
  const sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
  if (!sh) throw new Error('No existe la pestaña ' + SHEET_NAME);
  return sh;
}

// Devuelve el encabezado (en minúsculas) y crea las columnas que falten
// (nombre, apellido, congregacion) al final, sin tocar las que ya existen.
function ensureUserHeaders_(sh) {
  const lastCol = sh.getLastColumn();
  let header = lastCol > 0 ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim().toLowerCase()) : [];

  if (header.length === 0) {
    sh.getRange(1, 1, 1, CAMPOS_USUARIO.length).setValues([CAMPOS_USUARIO]);
    return CAMPOS_USUARIO.slice();
  }

  const faltantes = CAMPOS_USUARIO.filter(c => header.indexOf(c) === -1);
  if (faltantes.length) {
    const nuevoHeader = header.concat(faltantes);
    sh.getRange(1, 1, 1, nuevoHeader.length).setValues([nuevoHeader]);
    header = nuevoHeader;
  }
  return header;
}

function headerIndex_(header) {
  const idx = {};
  CAMPOS_USUARIO.forEach(c => { idx[c] = header.indexOf(c); });
  return idx;
}

function encontrarFilaPorUsuario_(sh, idx, username) {
  const values = sh.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][idx.username] || '').trim().toLowerCase() === username) return i + 1;
  }
  return -1;
}

function findUser(username) {
  username = String(username || '').trim().toLowerCase();
  const sh = getUsuariosSheet_();
  const header = ensureUserHeaders_(sh);
  const idx = headerIndex_(header);

  const values = sh.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (String(row[idx.username] || '').trim().toLowerCase() === username) {
      return {
        username: String(row[idx.username] || '').trim(),
        salt: String(row[idx.salt] ?? '').trim(),
        hashHex: String(row[idx.hash_hex] ?? '').trim(),
        role: String(row[idx.role] ?? '').trim(),
        nombre: String(row[idx.nombre] ?? '').trim(),
        apellido: String(row[idx.apellido] ?? '').trim(),
        congregacion: String(row[idx.congregacion] ?? '').trim(),
      };
    }
  }
  return null;
}

/***** CRYPTO *****/
function sha256Hex(input) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, input, Utilities.Charset.UTF_8);
  return bytes.map(b => (b & 0xff).toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a, b) {
  a = String(a || '');
  b = String(b || '');
  if (a.length !== b.length) return false;
  let res = 0;
  for (let i = 0; i < a.length; i++) res |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return res === 0;
}

function genSalt() {
  const uuid = Utilities.getUuid();
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, uuid + Date.now());
  return bytes.map(b => (b & 0xff).toString(16).padStart(2, '0')).join('').slice(0, 32);
}

/***** ABM de usuarios (para la pestaña "Administradores" de publicadores.html) *****/
//
// Como este backend puede crear/editar/borrar cuentas de LOGIN del portal
// entero (y la URL en sí es pública, está en app-config.js del repo), cada
// acción exige la contraseña del admin que la está haciendo — no alcanza
// con conocer la URL. verificarSesionAdmin_ hace ese chequeo.
function verificarSesionAdmin_(data) {
  const username = String(data.adminUsername || '').trim();
  const password = String(data.adminPassword || '');
  if (!username || !password) return { ok: false, error: 'Confirmá tu usuario y contraseña de administrador' };

  const user = findUser(username);
  if (!user) return { ok: false, error: 'Usuario/contraseña de administrador inválidos' };

  const candidateHex = sha256Hex(password + user.salt);
  if (!timingSafeEqual(user.hashHex, candidateHex)) {
    return { ok: false, error: 'Usuario/contraseña de administrador inválidos' };
  }
  if (String(user.role || '').trim().toLowerCase() !== 'admin') {
    return { ok: false, error: 'Esta acción es solo para administradores' };
  }
  return { ok: true, admin: user };
}

// Congregación "real" de una fila: si viene vacía, se considera Salinas
// (todas las cuentas que ya existían antes de agregar esta columna).
function congregacionEfectiva_(user) {
  return (user && user.congregacion) || CONGREGACION_PORTAL;
}

function mismaCongregacion_(a, b) {
  return normalizarTexto_(a) === normalizarTexto_(b);
}

// No devuelve salt/hash_hex nunca — son las cuentas de login de todo el
// portal, no hace falta mandar eso al navegador para nada.
function accionListarUsuarios_(data) {
  const auth = verificarSesionAdmin_(data);
  if (!auth.ok) return auth;
  const congregacionAdmin = congregacionEfectiva_(auth.admin);

  const sh = getUsuariosSheet_();
  const header = ensureUserHeaders_(sh);
  const idx = headerIndex_(header);
  const values = sh.getDataRange().getValues();

  const usuarios = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const username = String(row[idx.username] || '').trim();
    if (!username) continue;
    const congregacion = String(row[idx.congregacion] || '').trim() || CONGREGACION_PORTAL;
    // Cada admin solo ve/gestiona usuarios de su propia congregación — por
    // si este mismo backend termina compartido entre más de una.
    if (!mismaCongregacion_(congregacion, congregacionAdmin)) continue;
    usuarios.push({
      username: username,
      nombre: String(row[idx.nombre] || '').trim(),
      apellido: String(row[idx.apellido] || '').trim(),
      role: String(row[idx.role] || '').trim(),
      congregacion: congregacion,
    });
  }
  return { ok: true, usuarios: usuarios };
}

function accionCrearUsuario_(data) {
  const auth = verificarSesionAdmin_(data);
  if (!auth.ok) return auth;

  const username = String(data.username || '').trim().toLowerCase();
  const password = String(data.password || '');
  if (!username) return { ok: false, error: 'Falta el usuario' };
  if (!password || password.length < 6) return { ok: false, error: 'La contraseña tiene que tener al menos 6 caracteres' };
  if (findUser(username)) return { ok: false, error: 'Ya existe el usuario "' + username + '"' };

  const sh = getUsuariosSheet_();
  const header = ensureUserHeaders_(sh);
  const idx = headerIndex_(header);

  const salt = genSalt();
  const hashHex = sha256Hex(password + salt);
  const fila = new Array(header.length).fill('');
  fila[idx.username] = username;
  fila[idx.salt] = salt;
  fila[idx.hash_hex] = hashHex;
  fila[idx.role] = String(data.role || '').trim();
  fila[idx.nombre] = String(data.nombre || '').trim();
  fila[idx.apellido] = String(data.apellido || '').trim();
  // Siempre la congregación del admin que lo está creando, no lo que venga
  // en el pedido — así nadie crea de arrastre un usuario para otra
  // congregación que no debería gestionar.
  fila[idx.congregacion] = congregacionEfectiva_(auth.admin);
  sh.appendRow(fila);

  return { ok: true };
}

function accionActualizarUsuario_(data) {
  const auth = verificarSesionAdmin_(data);
  if (!auth.ok) return auth;

  const usernameActual = String(data.usernameActual || '').trim().toLowerCase();
  if (!usernameActual) return { ok: false, error: 'Falta el usuario a editar' };

  const objetivo = findUser(usernameActual);
  if (!objetivo) return { ok: false, error: 'No se encontró el usuario "' + usernameActual + '"' };
  if (!mismaCongregacion_(congregacionEfectiva_(objetivo), congregacionEfectiva_(auth.admin))) {
    return { ok: false, error: 'No podés editar usuarios de otra congregación' };
  }

  const sh = getUsuariosSheet_();
  const header = ensureUserHeaders_(sh);
  const idx = headerIndex_(header);
  const fila = encontrarFilaPorUsuario_(sh, idx, usernameActual);

  const nuevoUsername = data.nuevoUsername != null ? String(data.nuevoUsername).trim().toLowerCase() : '';
  if (nuevoUsername && nuevoUsername !== usernameActual) {
    if (findUser(nuevoUsername)) return { ok: false, error: 'Ya existe el usuario "' + nuevoUsername + '"' };
    sh.getRange(fila, idx.username + 1).setValue(nuevoUsername);
  }
  if (data.nombre != null) sh.getRange(fila, idx.nombre + 1).setValue(String(data.nombre).trim());
  if (data.apellido != null) sh.getRange(fila, idx.apellido + 1).setValue(String(data.apellido).trim());
  if (data.role != null) sh.getRange(fila, idx.role + 1).setValue(String(data.role).trim());
  // La congregación NO se edita desde acá a propósito: si un admin pudiera
  // cambiarla libremente, podría "pasar" un usuario a otra congregación que
  // no le corresponde gestionar.

  return { ok: true };
}

function accionResetearPassword_(data) {
  const auth = verificarSesionAdmin_(data);
  if (!auth.ok) return auth;

  const username = String(data.username || '').trim().toLowerCase();
  const nuevaPassword = String(data.nuevaPassword || '');
  if (!username) return { ok: false, error: 'Falta el usuario' };
  if (!nuevaPassword || nuevaPassword.length < 6) return { ok: false, error: 'La contraseña tiene que tener al menos 6 caracteres' };

  const objetivo = findUser(username);
  if (!objetivo) return { ok: false, error: 'No se encontró el usuario "' + username + '"' };
  if (!mismaCongregacion_(congregacionEfectiva_(objetivo), congregacionEfectiva_(auth.admin))) {
    return { ok: false, error: 'No podés resetear la contraseña de usuarios de otra congregación' };
  }

  const sh = getUsuariosSheet_();
  const header = ensureUserHeaders_(sh);
  const idx = headerIndex_(header);
  const fila = encontrarFilaPorUsuario_(sh, idx, username);

  const salt = genSalt();
  const hashHex = sha256Hex(nuevaPassword + salt);
  sh.getRange(fila, idx.salt + 1).setValue(salt);
  sh.getRange(fila, idx.hash_hex + 1).setValue(hashHex);

  return { ok: true };
}

function accionEliminarUsuario_(data) {
  const auth = verificarSesionAdmin_(data);
  if (!auth.ok) return auth;

  const username = String(data.username || '').trim().toLowerCase();
  if (!username) return { ok: false, error: 'Falta el usuario' };
  if (username === String(data.adminUsername || '').trim().toLowerCase()) {
    return { ok: false, error: 'No podés eliminar tu propia cuenta desde acá.' };
  }

  const objetivo = findUser(username);
  if (!objetivo) return { ok: false, error: 'No se encontró el usuario "' + username + '"' };
  if (!mismaCongregacion_(congregacionEfectiva_(objetivo), congregacionEfectiva_(auth.admin))) {
    return { ok: false, error: 'No podés eliminar usuarios de otra congregación' };
  }

  const sh = getUsuariosSheet_();
  const header = ensureUserHeaders_(sh);
  const idx = headerIndex_(header);
  const fila = encontrarFilaPorUsuario_(sh, idx, username);
  if (fila === -1) return { ok: false, error: 'No se encontró el usuario "' + username + '"' };

  sh.deleteRow(fila);
  return { ok: true };
}

/***** Uso manual desde el editor (opcional, ya no hace falta usarlo una vez
 que esté la pestaña "Administradores" en publicadores.html) *****/
function admin_upsertUser(username, plainPassword, role, nombre, apellido, congregacion) {
  const sh = getUsuariosSheet_();
  const header = ensureUserHeaders_(sh);
  const idx = headerIndex_(header);

  const salt = genSalt();
  const hashHex = sha256Hex(plainPassword + salt);

  const fila = encontrarFilaPorUsuario_(sh, idx, String(username).trim().toLowerCase());
  const rowVals = new Array(header.length).fill('');
  rowVals[idx.username] = username;
  rowVals[idx.salt] = salt;
  rowVals[idx.hash_hex] = hashHex;
  rowVals[idx.role] = role || '';
  rowVals[idx.nombre] = nombre || '';
  rowVals[idx.apellido] = apellido || '';
  rowVals[idx.congregacion] = congregacion || CONGREGACION_PORTAL;

  if (fila === -1) {
    sh.appendRow(rowVals);
  } else {
    sh.getRange(fila, 1, 1, rowVals.length).setValues([rowVals]);
  }
  return { username, role, salt, hashHex };
}

/***** ============ REVISITAS / ESTUDIOS (código previo de este mismo
 proyecto — SIN CAMBIOS de comportamiento, solo movido a este archivo
 único para que conviva con el login) ============ *****/

const SHEET_NAME_REV = 'RevisitasEstudios';
const EXPECTED_HEADERS = [
  'id', 'user', 'nombre', 'fecha', 'direccion',
  'tema', 'prox', 'tipo', 'lat', 'lng'
];

function getRevSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME_REV);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME_REV);
    sh.getRange(1, 1, 1, EXPECTED_HEADERS.length).setValues([EXPECTED_HEADERS]);
  }
  return sh;
}

function readAllRevisitas_() {
  const sh = getRevSheet_();
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];

  const headers = values[0];
  const out = [];

  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    if (row.join('').trim() === '') continue;

    const obj = {};
    headers.forEach((h, i) => { obj[String(h)] = row[i]; });
    obj._row = r + 1;
    out.push(obj);
  }

  return out;
}

function handleList_(user) {
  if (!user) return { ok: false, error: "missing user" };

  const all = readAllRevisitas_();
  const mine = all.filter(r => String(r.user) === String(user));

  return { ok: true, items: mine };
}

function handleSave_(params) {
  const requiredUser = params.user;
  if (!requiredUser) return { ok: false, error: "missing user" };

  const sh = getRevSheet_();
  const data = readAllRevisitas_();

  let rowToWrite = null;
  let recordId = params.id || "";

  if (recordId) {
    const found = data.find(r => r.id === recordId && r.user === requiredUser);
    if (!found) return { ok: false, error: "not_found_or_not_owner" };
    rowToWrite = found._row;
  } else {
    recordId = Utilities.getUuid();
    rowToWrite = sh.getLastRow() + 1;
  }

  const rowObj = {
    id: recordId,
    user: requiredUser,
    nombre: params.nombre || "",
    fecha: params.fecha || "",
    direccion: params.direccion || "",
    tema: params.tema || "",
    prox: params.prox || "",
    tipo: params.tipo || "",
    lat: params.lat || "",
    lng: params.lng || ""
  };

  const rowArr = EXPECTED_HEADERS.map(h => rowObj[h]);
  sh.getRange(rowToWrite, 1, 1, rowArr.length).setValues([rowArr]);

  return { ok: true, id: recordId };
}

// Si viene ?callback=MiFuncion respondemos MiFuncion({...}) (JSONP); si no,
// JSON plano. Código original, sin cambios.
function buildJsonOrJsonp_(e, obj) {
  const cb = e && e.parameter && e.parameter.callback;
  const json = JSON.stringify(obj);

  if (cb) {
    return ContentService.createTextOutput(cb + "(" + json + ");").setMimeType(ContentService.MimeType.JAVASCRIPT);
  } else {
    return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
  }
}

/***** ============ ENTRY POINTS ÚNICOS (fusionados) ============ *****/

function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    const op = params.op;

    // --- Login / portal Salinas ---
    if (op === 'login') {
      return jsonResponse_(apiLogin(params.username, params.password));
    }
    if (op === 'validate') {
      const token = params.token;
      if (!token) return jsonResponse_({ ok: false, error: 'no token' });
      const cache = CacheService.getScriptCache();
      const val = cache.get(token);
      if (!val) return jsonResponse_({ ok: true, valid: false });
      const [username, role] = val.split('|');
      return jsonResponse_({ ok: true, valid: true, username, role });
    }

    // --- Revisitas/Estudios (código original de este proyecto) ---
    const action = params.action || "";
    if (action === "list") {
      return buildJsonOrJsonp_(e, handleList_(params.user || ""));
    }
    if (action === "save") {
      return buildJsonOrJsonp_(e, handleSave_(params));
    }

    // Mismo fallback que tenía Revisitas originalmente.
    return buildJsonOrJsonp_(e, { ok: false, error: "unknown_action" });
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    const data = e.postData && JSON.parse(e.postData.contents);
    if (data && data.action) {
      switch (data.action) {
        case 'listarUsuarios':    return jsonResponse_(accionListarUsuarios_(data));
        case 'crearUsuario':      return jsonResponse_(accionCrearUsuario_(data));
        case 'actualizarUsuario': return jsonResponse_(accionActualizarUsuario_(data));
        case 'resetearPassword':  return jsonResponse_(accionResetearPassword_(data));
        case 'eliminarUsuario':   return jsonResponse_(accionEliminarUsuario_(data));
      }
    }
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err) });
  }
  // Revisitas/Estudios no usa doPost — mismo mensaje que ya tenía.
  return buildJsonOrJsonp_(e, { ok: false, error: "use_action_via_GET" });
}
