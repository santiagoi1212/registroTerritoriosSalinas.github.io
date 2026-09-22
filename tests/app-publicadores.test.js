"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadPublicadoresApp } = require("./load-publicadores-app");

function fakeElement() {
  return {
    _html: "",
    set innerHTML(v) { this._html = v; },
    get innerHTML() { return this._html; },
    querySelectorAll() { return []; }
  };
}

test("normalizeName: quita acentos, pasa a minúsculas y colapsa espacios", () => {
  const app = loadPublicadoresApp();
  assert.equal(app.normalizeName("  Ángela   Núñez "), "angela nunez");
  assert.equal(app.normalizeName(null), "");
  assert.equal(app.normalizeName(undefined), "");
});

test("ESTADOS_VALIDOS: son los 6 estados esperados, en este orden", () => {
  const app = loadPublicadoresApp();
  assert.deepEqual(app.ESTADOS_VALIDOS, [
    "Anciano", "Siervo Ministerial", "Publicador",
    "Publicador No Bautizado", "Precursor Regular", "Precursor Especial"
  ]);
});

test("parseEstados: separa por coma o pipe, normaliza mayúsculas/acentos y corta en 2", () => {
  const app = loadPublicadoresApp();
  assert.deepEqual(app.parseEstados("Anciano, Precursor Regular"), ["Anciano", "Precursor Regular"]);
  assert.deepEqual(app.parseEstados("anciano|precursor regular|publicador"), ["Anciano", "Precursor Regular"]);
  assert.deepEqual(app.parseEstados(""), []);
  assert.deepEqual(app.parseEstados(null), []);
});

test("ESTADO_INCOMPATIBLES: es simétrico (si A bloquea a B, B también bloquea a A)", () => {
  const app = loadPublicadoresApp();
  const inc = app.ESTADO_INCOMPATIBLES;
  Object.keys(inc).forEach((a) => {
    inc[a].forEach((b) => {
      assert.ok(inc[b] && inc[b].includes(a), `${a} bloquea a ${b} pero ${b} no bloquea de vuelta a ${a}`);
    });
  });
});

test("ESTADO_INCOMPATIBLES: Publicador No Bautizado bloquea a todos los demás estados", () => {
  const app = loadPublicadoresApp();
  const inc = app.ESTADO_INCOMPATIBLES;
  const otros = app.ESTADOS_VALIDOS.filter((e) => e !== "Publicador No Bautizado");
  otros.forEach((e) => assert.ok(inc["Publicador No Bautizado"].includes(e), `falta bloquear a ${e}`));
});

test("calcularAlertaDPA: sin fecha no hay alerta", () => {
  const app = loadPublicadoresApp();
  assert.deepEqual(app.calcularAlertaDPA(null), { nivel: null, mensaje: "" });
});

test("calcularAlertaDPA: vencido hace tiempo da alerta roja", () => {
  const app = loadPublicadoresApp();
  const haceUnAnio = new Date();
  haceUnAnio.setFullYear(haceUnAnio.getFullYear() - 1);
  assert.equal(app.calcularAlertaDPA(haceUnAnio).nivel, "roja");
});

test("calcularAlertaDPA: vence en 60 días da alerta amarilla", () => {
  const app = loadPublicadoresApp();
  const en60Dias = new Date();
  en60Dias.setDate(en60Dias.getDate() + 60);
  assert.equal(app.calcularAlertaDPA(en60Dias).nivel, "amarilla");
});

test("calcularAlertaDPA: vence en 1 año no da alerta", () => {
  const app = loadPublicadoresApp();
  const enUnAnio = new Date();
  enUnAnio.setFullYear(enUnAnio.getFullYear() + 1);
  assert.equal(app.calcularAlertaDPA(enUnAnio).nivel, null);
});

test("formatFecha: formatea dd/mm/aaaa", () => {
  const app = loadPublicadoresApp();
  assert.equal(app.formatFecha(new Date(2028, 8, 18)), "18/09/2028");
  assert.equal(app.formatFecha(null), "");
});

test("badge: con link es un <a> clickable que abre el documento", () => {
  const app = loadPublicadoresApp();
  const html = app.badge(true, "https://drive.google.com/x");
  assert.match(html, /<a /);
  assert.match(html, /href="https:\/\/drive\.google\.com\/x"/);
});

test("badge: ok sin link es un <span>, no clickable", () => {
  const app = loadPublicadoresApp();
  const html = app.badge(true, "");
  assert.match(html, /<span/);
  assert.doesNotMatch(html, /<a /);
});

test("badge: sin ok muestra el label de pendiente", () => {
  const app = loadPublicadoresApp();
  assert.match(app.badge(false, ""), /Pendiente/);
});

test("alertaDpaHtml: sin nivel no imprime nada", () => {
  const app = loadPublicadoresApp();
  assert.equal(app.alertaDpaHtml({ nivel: null, mensaje: "" }), "");
  assert.equal(app.alertaDpaHtml(null), "");
});

test("alertaDpaHtml: nivel roja usa la clase alerta-roja", () => {
  const app = loadPublicadoresApp();
  assert.match(app.alertaDpaHtml({ nivel: "roja", mensaje: "x" }), /alerta-roja/);
});

test("alertaActividadHtml: activo y sin-info no muestran ícono", () => {
  const app = loadPublicadoresApp();
  assert.equal(app.alertaActividadHtml({ code: "activo", label: "Activo" }), "");
  assert.equal(app.alertaActividadHtml({ code: "sin-info", label: "..." }), "");
  assert.equal(app.alertaActividadHtml(null), "");
});

test("alertaActividadHtml: irregular usa alerta-amarilla, inactivo usa alerta-roja", () => {
  const app = loadPublicadoresApp();
  assert.match(app.alertaActividadHtml({ code: "irregular", label: "Irregular" }), /alerta-amarilla/);
  assert.match(app.alertaActividadHtml({ code: "inactivo", label: "Inactivo" }), /alerta-roja/);
});

test("cargarEstadoActividad: sin apiUrl devuelve un Map vacío sin pegarle a la red", async () => {
  const app = loadPublicadoresApp();
  const estados = await app.cargarEstadoActividad("");
  assert.equal(estados.size, 0);
});

test("cargarEstadoActividad: si falla el fetch devuelve Map vacío en vez de tirar", async () => {
  const app = loadPublicadoresApp();
  global.fetch = async () => { throw new Error("network down"); };
  const estados = await app.cargarEstadoActividad("https://fake.example/api");
  assert.equal(estados.size, 0);
});

test("cargarEstadoActividad: calcula activo/irregular/inactivo igual que el widget de informes", async () => {
  const app = loadPublicadoresApp();

  // periodKey 1..6, más viejo a más nuevo.
  const filasDe = (nombre, participaciones) =>
    participaciones.map((participo, i) => ({ nombre, periodKey: i + 1, participo }));

  const rows = [
    ...filasDe("Ana Activa", [true, true, true, true, true, true]),
    ...filasDe("Beto Irregular", [true, false, true, false, true, true]),
    ...filasDe("Cami Inactiva", [false, false, false, false, false, false]),
  ];
  global.fetch = async () => ({ ok: true, json: async () => ({ rows }) });

  const estados = await app.cargarEstadoActividad("https://fake.example/api");
  assert.equal(estados.get("ana activa").code, "activo");
  assert.equal(estados.get("beto irregular").code, "irregular");
  assert.equal(estados.get("cami inactiva").code, "inactivo");
});

test("renderResumen: escribe los totales y conteos correctos", () => {
  const app = loadPublicadoresApp();
  const personas = [
    { dpa: true, usoDatos: true, datosPersonales: false },
    { dpa: false, usoDatos: true, datosPersonales: false },
    { dpa: true, usoDatos: false, datosPersonales: true },
  ];
  const el = fakeElement();
  app.renderResumen(el, personas);
  assert.match(el.innerHTML, />3</); // total publicadores
  assert.match(el.innerHTML, />2\/3</); // DPA y Uso de Datos, ambos 2/3
  assert.match(el.innerHTML, />1\/3</); // Datos Personales
});

test("renderTabla: agrupa por grupo y filtra por nombre (sin distinguir acentos/mayúsculas)", () => {
  const app = loadPublicadoresApp();
  const personaBase = { estado: [], dpa: true, linkDpa: "", usoDatos: true, linkAutorizacion: "", datosPersonales: false, datosPersonalesFecha: "", notas: "" };
  const personas = [
    { ...personaBase, grupo: "1", nombre: "Ana Gómez" },
    { ...personaBase, grupo: "2", nombre: "Beto Diaz" },
  ];

  const elCompleto = fakeElement();
  app.renderTabla(elCompleto, personas, "", null);
  assert.match(elCompleto.innerHTML, /Grupo 1/);
  assert.match(elCompleto.innerHTML, /Grupo 2/);
  assert.match(elCompleto.innerHTML, /Ana Gómez/);
  assert.match(elCompleto.innerHTML, /Beto Diaz/);

  const elFiltrado = fakeElement();
  app.renderTabla(elFiltrado, personas, "ana gomez", null); // sin acento, minúscula
  assert.match(elFiltrado.innerHTML, /Ana Gómez/);
  assert.doesNotMatch(elFiltrado.innerHTML, /Beto Diaz/);
});

test("renderTabla: sin resultados muestra el mensaje de vacío", () => {
  const app = loadPublicadoresApp();
  const el = fakeElement();
  app.renderTabla(el, [], "", null);
  assert.match(el.innerHTML, /Sin resultados/);
});

test("cargarDatosPublicadores: la segunda llamada usa la caché (no vuelve a pegarle a la red) hasta forzar", async () => {
  const app = loadPublicadoresApp();
  app.invalidarCachePublicadores();

  let fetchCalls = 0;
  global.fetch = async (url) => {
    fetchCalls++;
    return {
      ok: true,
      json: async () => ({
        status: "ok",
        publicadores: [
          { Grupo: "1", Nombre: "Ana Gomez", Sexo: "Femenino", Estado: "Publicador", DPA: "Si", UsoDatos: "", DatosPersonales: "", SituacionInforme: "Precursor Regular" }
        ]
      })
    };
  };

  // cargarPublicadores() lee PUBLICADORES_API_URL de window.APP_CONFIG (no
  // del parámetro cfg que recibe cargarDatosPublicadores) — en la app real
  // ambos son el mismo objeto, así que acá hay que igualarlos a mano.
  const cfg = { PUBLICADORES_API_URL: "https://fake.example/pub", INFORMES_PREDICACION_API_URL: "" };
  global.window.APP_CONFIG = cfg;

  const r1 = await app.cargarDatosPublicadores(cfg, {});
  assert.equal(r1.desdeCache, false);
  assert.equal(r1.personas.length, 1);
  assert.equal(r1.personas[0].nombre, "Ana Gomez");
  assert.equal(r1.personas[0].sexo, "Femenino");
  assert.equal(r1.personas[0].situacionInforme, "Precursor Regular");
  const llamadasTrasPrimeraCarga = fetchCalls;

  const r2 = await app.cargarDatosPublicadores(cfg, {});
  assert.equal(r2.desdeCache, true);
  assert.equal(fetchCalls, llamadasTrasPrimeraCarga, "no debería haber pegado a la red de nuevo");

  const r3 = await app.cargarDatosPublicadores(cfg, { forzar: true });
  assert.equal(r3.desdeCache, false);
  assert.ok(fetchCalls > llamadasTrasPrimeraCarga, "forzar:true sí debería pegarle a la red de nuevo");
});

test("cargarDatosPublicadores: si la actividad viene vacía (falla transitoria) no queda pegada en caché", async () => {
  const app = loadPublicadoresApp();
  app.invalidarCachePublicadores();

  let fetchCalls = 0;
  global.fetch = async (url) => {
    fetchCalls++;
    if (String(url).includes("action=publicadoresDetalle")) {
      return {
        ok: true,
        json: async () => ({
          status: "ok",
          publicadores: [{ Grupo: "1", Nombre: "Ana Gomez" }]
        })
      };
    }
    // action=cache (Informes de predicación): falla, como una red caída.
    throw new Error("network down");
  };

  const cfg = { PUBLICADORES_API_URL: "https://fake.example/pub", INFORMES_PREDICACION_API_URL: "https://fake.example/informes" };
  global.window.APP_CONFIG = cfg;

  const r1 = await app.cargarDatosPublicadores(cfg, {});
  assert.equal(r1.personas[0].actividad, null);
  const llamadasTrasPrimeraCarga = fetchCalls;

  // Como la actividad vino vacía, la SEGUNDA llamada (sin forzar) debería
  // reintentar por red en vez de reusar esa caché degradada.
  const r2 = await app.cargarDatosPublicadores(cfg, {});
  assert.equal(r2.desdeCache, false, "no debería haber usado una caché con actividad vacía");
  assert.ok(fetchCalls > llamadasTrasPrimeraCarga, "debería haber vuelto a pegarle a la red");
});

test("suscribirseACambiosDeCache: avisa con las personas actualizadas cuando otra pestaña cambia la caché", () => {
  const app = loadPublicadoresApp();

  let recibido = "no llamado";
  app.suscribirseACambiosDeCache((personas) => { recibido = personas; });

  const personas = [{ nombre: "Ana Gomez", grupo: "1", fechaVenceDPA: "2028-09-18T00:00:00.000Z" }];
  global.window.dispatchEvent({
    type: "storage",
    key: "salinas_publicadores_cache_v3",
    newValue: JSON.stringify({ timestamp: Date.now(), personas })
  });

  assert.ok(Array.isArray(recibido));
  assert.equal(recibido[0].nombre, "Ana Gomez");
  assert.ok(recibido[0].fechaVenceDPA instanceof Date, "fechaVenceDPA debería reconstruirse como Date");
});

test("suscribirseACambiosDeCache: avisa con null cuando la caché se invalida desde otra pestaña", () => {
  const app = loadPublicadoresApp();

  let recibido = "no llamado";
  app.suscribirseACambiosDeCache((personas) => { recibido = personas; });

  global.window.dispatchEvent({ type: "storage", key: "salinas_publicadores_cache_v3", newValue: null });

  assert.equal(recibido, null);
});

test("suscribirseACambiosDeCache: ignora cambios de storage de OTRAS claves (no es la caché de Publicadores)", () => {
  const app = loadPublicadoresApp();

  let llamado = false;
  app.suscribirseACambiosDeCache(() => { llamado = true; });

  global.window.dispatchEvent({ type: "storage", key: "otra_clave_cualquiera", newValue: "{}" });

  assert.equal(llamado, false);
});
