// app-publicadores.js está escrito para el navegador (se cuelga de
// `window.PublicadoresApp`, no usa module.exports). Este helper lo carga
// bajo Node para poder testearlo, con el mínimo de "DOM" simulado que
// necesitan las funciones puras: un `window` con APP_CONFIG y un
// localStorage en memoria. No se levanta un DOM real (jsdom ni similar) a
// propósito — las funciones que sí tocan el DOM real (renderTabla,
// renderResumen) se testean pasándoles un objeto "elemento" falso mínimo,
// ver app-publicadores.test.js.
"use strict";

const path = require("node:path");

function crearLocalStorageEnMemoria() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => { store.clear(); }
  };
}

function loadPublicadoresApp() {
  global.window = global.window || {};
  global.window.APP_CONFIG = global.window.APP_CONFIG || {};
  global.localStorage = crearLocalStorageEnMemoria();

  // Vuelve a ejecutar el archivo cada vez (en vez de servir del cache de
  // require) para que cada test empiece con los Sets/estado interno del
  // módulo (ej: gruposColapsadosTabla) limpios.
  const archivo = path.join(__dirname, "..", "app-publicadores.js");
  delete require.cache[require.resolve(archivo)];
  require(archivo);

  return global.window.PublicadoresApp;
}

module.exports = { loadPublicadoresApp };
