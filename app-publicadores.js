(function () {
  "use strict";

  // ==========================
  // Helpers CSV (mismo patrón que app-map.authgated.js)
  // ==========================
  function parseCSVLine(row) {
    const out = []; let cur = ""; let inQ = false;
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      if (ch === '"') {
        if (inQ && row[i + 1] === '"') { cur += '"'; i++; }
        else { inQ = !inQ; }
      } else if (ch === ',' && !inQ) {
        out.push(cur); cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out;
  }

  function parseCSV(text) {
    const rows = text.split(/\r?\n/).filter(l => l.trim() !== "");
    if (!rows.length) return [];
    const header = parseCSVLine(rows[0]).map(h => h.trim());
    const out = [];
    for (let r = 1; r < rows.length; r++) {
      const cols = parseCSVLine(rows[r]);
      const obj = {};
      header.forEach((h, i) => { obj[h] = (cols[i] ?? "").trim(); });
      out.push(obj);
    }
    return out;
  }

  async function fetchCSV(url) {
    if (!url) return [];
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const text = await res.text();
    return parseCSV(text);
  }

  // Vía preferida: el mismo Apps Script (PUBLICADORES_API_URL) que ya se usa
  // para subir documentos, corriendo con los permisos de quien lo desplegó.
  // Evita depender de "Publicar en la web", que algunas cuentas/organizaciones
  // terminan bloqueando (redirige a un login de Google en vez de servir el CSV).
  async function fetchPublicadoresAPI(apiUrl) {
    const res = await fetch(apiUrl + "?action=publicadoresDetalle&t=" + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    if (!data || data.status !== "ok") throw new Error((data && data.message) || "Error al cargar publicadores");
    return data.publicadores || [];
  }

  function normalizeName(s) {
    return String(s || "")
      .normalize("NFD").replace(/[̀-ͯ]/g, "") // sin acentos
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function isSi(v) {
    return String(v || "").trim().toLowerCase().startsWith("si") ||
           String(v || "").trim().toLowerCase() === "s";
  }

  // ==========================
  // Estado (anciano / siervo ministerial / publicador / publicador no
  // bautizado / precursor regular / precursor especial). Una persona puede
  // tener hasta dos. En la planilla va en la columna "Estado", separados
  // por "," o "|".
  // ==========================
  const ESTADOS_VALIDOS = ["Anciano", "Siervo Ministerial", "Publicador", "Publicador No Bautizado", "Precursor Regular", "Precursor Especial"];

  function normalizeEstado(v) {
    const norm = normalizeName(v);
    const match = ESTADOS_VALIDOS.find(e => normalizeName(e) === norm);
    return match || String(v || "").trim();
  }

  function parseEstados(raw) {
    return String(raw || "")
      .split(/[|,;]/)
      .map(s => s.trim())
      .filter(Boolean)
      .map(normalizeEstado)
      .slice(0, 2);
  }

  // Qué estados NO se pueden combinar entre sí (una persona puede tener
  // hasta dos): Anciano y Siervo Ministerial son excluyentes entre sí;
  // Publicador no combina con ningún precursor ni con "Publicador No
  // Bautizado"; "Publicador No Bautizado" no combina con nada más (va solo).
  const ESTADO_INCOMPATIBLES = {
    "Anciano": ["Siervo Ministerial", "Publicador No Bautizado"],
    "Siervo Ministerial": ["Anciano", "Publicador No Bautizado"],
    "Publicador": ["Precursor Regular", "Precursor Especial", "Publicador No Bautizado"],
    "Precursor Regular": ["Publicador", "Publicador No Bautizado"],
    "Precursor Especial": ["Publicador", "Publicador No Bautizado"],
    "Publicador No Bautizado": ["Anciano", "Siervo Ministerial", "Publicador", "Precursor Regular", "Precursor Especial"]
  };

  // ==========================
  // FechaVenceDPA: el DPA vence 2 años después de subirse.
  // Alerta amarilla si quedan <= 3 meses, roja si quedan <= 1 mes o ya venció.
  // ==========================
  function parseFecha(str) {
    const s = String(str || "").trim();
    if (!s) return null;
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  function formatFecha(d) {
    if (!d) return "";
    const pad = n => String(n).padStart(2, "0");
    return pad(d.getDate()) + "/" + pad(d.getMonth() + 1) + "/" + d.getFullYear();
  }

  function diasHasta(d) {
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const t = new Date(d); t.setHours(0, 0, 0, 0);
    return Math.round((t - hoy) / 86400000);
  }

  function calcularAlertaDPA(fechaVenceDPA) {
    if (!fechaVenceDPA) return { nivel: null, mensaje: "" };
    const dias = diasHasta(fechaVenceDPA);
    const fechaTxt = formatFecha(fechaVenceDPA);
    if (dias < 0) return { nivel: "roja", mensaje: `DPA vencido desde el ${fechaTxt}` };
    if (dias <= 30) return { nivel: "roja", mensaje: `Falta ${dias === 1 ? "1 día" : dias + " días"} para que venza el DPA (${fechaTxt})` };
    if (dias <= 90) return { nivel: "amarilla", mensaje: `Quedan menos de 3 meses para renovar el DPA (vence ${fechaTxt})` };
    return { nivel: null, mensaje: "" };
  }

  function alertaDpaHtml(alerta) {
    if (!alerta || !alerta.nivel) return "";
    const cls = alerta.nivel === "roja" ? "alerta-roja" : "alerta-amarilla";
    return ` <span class="alerta-dpa ${cls} tooltip" tabindex="0" data-tooltip="${alerta.mensaje}">⚠</span>`;
  }

  // ==========================
  // Estado de actividad (Activo / Irregular / Inactivo), tomado del mismo
  // cálculo que ya usa el widget "Informes de predicación"
  // (informes-predicacion/index.html, función personStatus): mira los
  // últimos 6 períodos con datos de alguien y cuenta cuántos meses esa
  // persona no participó. Acá se replica el mismo algoritmo sobre la
  // "Cache" que expone ese mismo backend (?action=cache), para no
  // duplicar/tocar ese widget.
  // ==========================
  function calcularEstadoActividad(historial, periodos, filasPorNombrePeriodo, claveNombre) {
    if (historial.length < 2) return { code: "sin-info", label: "Sin historial suficiente" };

    const primerPeriodoPropio = historial[0].periodKey;
    const ventana = periodos.filter(p => p >= primerPeriodoPropio).slice(0, 6);

    let consecutivosNo = 0, totalNo = 0, rachaCortada = false;
    ventana.forEach(p => {
      const fila = filasPorNombrePeriodo.get(claveNombre + "|" + p);
      const noParticipo = !fila || fila.participo === false;
      if (noParticipo) {
        totalNo++;
        if (!rachaCortada) consecutivosNo++;
      } else {
        rachaCortada = true;
      }
    });

    if (consecutivosNo >= 6) return { code: "inactivo", label: "Inactivo" };
    if (consecutivosNo >= 2 || totalNo >= 2) return { code: "irregular", label: "Irregular" };
    return { code: "activo", label: "Activo" };
  }

  // Devuelve un Map nombre-normalizado -> {code,label} para todos los
  // nombres presentes en la caché de informes-predicacion. Si no se puede
  // cargar (URL sin configurar, sin red, etc.) devuelve un Map vacío — el
  // llamador simplemente no muestra el ícono, sin romper nada.
  async function cargarEstadoActividad(apiUrl) {
    if (!apiUrl) return new Map();
    try {
      const separador = apiUrl.includes("?") ? "&" : "?";
      const res = await fetch(apiUrl + separador + "action=cache&t=" + Date.now(), { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      const filas = Array.isArray(data.rows) ? data.rows : [];

      const porNombre = new Map();
      const porNombrePeriodo = new Map();
      filas.forEach(r => {
        const clave = normalizeName(r.nombre);
        if (!porNombre.has(clave)) porNombre.set(clave, []);
        porNombre.get(clave).push(r);
        porNombrePeriodo.set(clave + "|" + r.periodKey, r);
      });
      porNombre.forEach(lista => lista.sort((a, b) => a.periodKey - b.periodKey));

      const periodosSet = new Set();
      filas.forEach(r => { if (r.periodKey != null) periodosSet.add(r.periodKey); });
      const periodos = [...periodosSet].sort((a, b) => b - a);

      const estados = new Map();
      porNombre.forEach((historial, clave) => {
        estados.set(clave, calcularEstadoActividad(historial, periodos, porNombrePeriodo, clave));
      });
      return estados;
    } catch (err) {
      console.warn("No se pudo cargar el estado de actividad (Informes de predicación):", err);
      return new Map();
    }
  }

  function alertaActividadHtml(actividad) {
    if (!actividad || actividad.code === "activo" || actividad.code === "sin-info") return "";
    const cls = actividad.code === "inactivo" ? "alerta-roja" : "alerta-amarilla";
    return ` <span class="alerta-dpa ${cls} tooltip" tabindex="0" data-tooltip="${actividad.label} en la predicación">⚠</span>`;
  }

  // ==========================
  // Carga + cruce de datos
  // ==========================
  async function cargarPublicadores() {
    const cfg = window.APP_CONFIG || {};
    const rows = cfg.PUBLICADORES_API_URL
      ? await fetchPublicadoresAPI(cfg.PUBLICADORES_API_URL)
      : await fetchCSV(cfg.PUBLICADORES_CSV_URL);

    let respuestasPorNombre = null;
    if (cfg.DATOS_PERSONALES_RESPUESTAS_CSV_URL) {
      try {
        const respuestas = await fetchCSV(cfg.DATOS_PERSONALES_RESPUESTAS_CSV_URL);
        respuestasPorNombre = new Map();
        respuestas.forEach(r => {
          const nombre = r.Nombre || r.nombre || r["Nombre completo"] || "";
          const fecha  = r.Fecha  || r.fecha  || r["Marca temporal"] || "";
          if (!nombre) return;
          respuestasPorNombre.set(normalizeName(nombre), fecha);
        });
      } catch (err) {
        console.warn("No se pudo cargar la planilla de respuestas de Datos Personales:", err);
      }
    }

    return rows.map(r => {
      const dpa       = isSi(r.DPA);
      const usoDatos  = isSi(r.UsoDatos);
      let datosPersonales = isSi(r.DatosPersonales);
      let datosPersonalesFecha = "";

      if (respuestasPorNombre) {
        const hit = respuestasPorNombre.get(normalizeName(r.Nombre));
        if (hit !== undefined) {
          datosPersonales = true;
          datosPersonalesFecha = hit;
        }
      }

      const fechaVenceDPA = parseFecha(r.FechaVenceDPA);

      return {
        grupo: r.Grupo || "",
        nombre: r.Nombre || "",
        sexo: r.Sexo || "",
        estado: parseEstados(r.Estado),
        dpa, linkDpa: r.LinkDPA || "",
        fechaVenceDPA, alertaDPA: calcularAlertaDPA(fechaVenceDPA),
        usoDatos, linkAutorizacion: r.LinkAutorizacion || "",
        datosPersonales, datosPersonalesFecha,
        notas: r.Notas || "",
        // Última "Situación" que la persona reportó en su informe mensual
        // (pestaña "Respuestas"): Precursor Regular/Auxiliar 15h/Auxiliar
        // 30h/Especial/Publicador. Se usa para el gráfico de categorías en
        // Estadísticas — es independiente de "estado" (el rol que carga el
        // admin a mano: Anciano/Siervo Ministerial/etc).
        situacionInforme: r.SituacionInforme || ""
      };
    });
  }

  // ==========================
  // Caché en localStorage (Publicadores + actividad ya cruzados).
  //
  // publicadores.html vive como varias URLs distintas (?vista=grupos,
  // ?vista=estadisticas, etc.) que son recargas de página completas, así que
  // sin esto cada clic entre esas vistas volvía a pegarle a los dos Apps
  // Script (Publicadores + Informes de predicación) desde cero — el segundo
  // en particular es lento. Con la caché, mientras no pasen CACHE_TTL_MS
  // desde la última carga real, se usan los datos guardados en localStorage
  // sin red. Las acciones que modifican datos (agregar, eliminar, mover de
  // grupo, subir documento, etc.) actualizan la caché "in place" con
  // actualizarCachePublicadores para que la próxima carga no muestre algo
  // viejo, sin necesidad de volver a pedir todo por red.
  // ==========================
  const CACHE_KEY = "salinas_publicadores_cache_v3"; // v3: agrega "situacionInforme"
  const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

  function leerCache_() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.personas) || !parsed.timestamp) return null;
      // JSON.stringify/parse convierte fechaVenceDPA (un objeto Date) en un
      // string plano — hay que reconstruirlo como Date acá, si no
      // formatFecha() explota al llamar d.getDate() sobre un string.
      parsed.personas.forEach(p => {
        p.fechaVenceDPA = p.fechaVenceDPA ? new Date(p.fechaVenceDPA) : null;
      });
      return parsed;
    } catch (err) {
      return null;
    }
  }

  function guardarCache_(personas) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), personas }));
    } catch (err) {
      // localStorage lleno, bloqueado (modo privado) o inexistente: seguimos
      // sin caché, no rompe nada.
    }
  }

  // Trae Publicadores + actividad, usando la caché si todavía está vigente.
  // opciones.forzar=true ignora la caché y siempre pega por red (se usa en
  // "Refrescar" y justo después de agregar un publicador nuevo).
  async function cargarDatosPublicadores(cfg, opciones) {
    opciones = opciones || {};
    if (!opciones.forzar) {
      const cache = leerCache_();
      if (cache && (Date.now() - cache.timestamp) < CACHE_TTL_MS) {
        return { personas: cache.personas, desdeCache: true };
      }
    }

    const [personas, estadoActividad] = await Promise.all([
      cargarPublicadores(),
      cargarEstadoActividad(cfg.INFORMES_PREDICACION_API_URL)
    ]);
    personas.forEach(p => {
      p.actividad = estadoActividad.get(normalizeName(p.nombre)) || null;
    });

    // Si hay INFORMES_PREDICACION_API_URL configurada pero el Map de
    // actividad vino vacío, seguramente fue un problema transitorio de red
    // (cargarEstadoActividad ya loguea el error y devuelve un Map vacío en
    // vez de tirar) — no conviene guardar esto en la caché: quedaría
    // "actividad vacía para todo el mundo" pegado ahí hasta que venza el
    // TTL (5 minutos), en vez de reintentar en la próxima carga.
    const actividadDegradada = !!cfg.INFORMES_PREDICACION_API_URL && estadoActividad.size === 0;
    if (!actividadDegradada) {
      guardarCache_(personas);
    }
    return { personas, desdeCache: false };
  }

  // Para usar después de una edición local (ya reflejada en el array de
  // personas en memoria) sin tener que volver a pedir todo por red.
  function actualizarCachePublicadores(personas) {
    guardarCache_(personas);
  }

  function invalidarCachePublicadores() {
    try { localStorage.removeItem(CACHE_KEY); } catch (err) {}
  }

  // Avisa cuando OTRA pestaña/ventana del mismo navegador (misma URL de
  // origen) cambia la caché de Publicadores — por ejemplo, un admin editó
  // algo en otra pestaña de publicadores.html, o alguien completó
  // datos-personales.html (que invalida la caché al enviar). El evento
  // "storage" del navegador solo llega a las OTRAS pestañas, nunca a la que
  // hizo el cambio (por eso no hace falta filtrar esa). callback recibe el
  // array de personas ya actualizado, o null si la caché se invalidó del
  // todo (hay que volver a pedir todo por red).
  //
  // Esto es sincronización entre pestañas del MISMO navegador vía
  // localStorage — no hay forma de empujar cambios a otro dispositivo/
  // navegador sin un backend con push en tiempo real, que este sitio (sin
  // servidor propio, solo Apps Script) no tiene.
  function suscribirseACambiosDeCache(callback) {
    window.addEventListener("storage", (e) => {
      if (e.key !== CACHE_KEY) return;
      if (!e.newValue) { callback(null); return; }
      try {
        const parsed = JSON.parse(e.newValue);
        if (!parsed || !Array.isArray(parsed.personas)) return;
        parsed.personas.forEach(p => {
          p.fechaVenceDPA = p.fechaVenceDPA ? new Date(p.fechaVenceDPA) : null;
        });
        callback(parsed.personas);
      } catch (err) {
        // JSON corrupto o lo que sea: no pasa nada, la próxima carga normal
        // (TTL o "Refrescar") lo arregla solo.
      }
    });
  }

  // ==========================
  // Render
  // ==========================
  function badge(ok, link, labelOk = "Sí", labelPend = "Pendiente") {
    if (ok && link) {
      return `<a class="badge badge-ok tooltip" href="${link}" target="_blank" rel="noopener" data-tooltip="Ver documento">✔ ${labelOk}</a>`;
    }
    if (ok) {
      return `<span class="badge badge-ok">✔ ${labelOk}</span>`;
    }
    return `<span class="badge badge-pend">${labelPend}</span>`;
  }

  // Grupos contraídos en la tabla "Ver estado" (por nombre de grupo). Vive
  // en este módulo para persistir mientras dure la carga de la página, ya
  // que renderTabla se llama de nuevo en cada refresco / búsqueda y
  // reescribe todo el innerHTML.
  const gruposColapsadosTabla = new Set();

  function renderResumen(el, personas) {
    const total = personas.length;
    const c = {
      dpa: personas.filter(p => p.dpa).length,
      usoDatos: personas.filter(p => p.usoDatos).length,
      datosPersonales: personas.filter(p => p.datosPersonales).length
    };
    el.innerHTML = `
      <div class="resumen-item"><span class="n">${total}</span><span class="l">Publicadores</span></div>
      <div class="resumen-item"><span class="n">${c.dpa}/${total}</span><span class="l">DPA</span></div>
      <div class="resumen-item"><span class="n">${c.usoDatos}/${total}</span><span class="l">Uso de Datos</span></div>
      <div class="resumen-item"><span class="n">${c.datosPersonales}/${total}</span><span class="l">Datos Personales</span></div>
    `;
  }

  function renderTabla(el, personas, filtro, onClickPersona) {
    const f = normalizeName(filtro || "");
    const porGrupo = new Map();
    personas.forEach((p, idx) => {
      if (f && !normalizeName(p.nombre).includes(f)) return;
      const g = p.grupo || "Sin grupo";
      if (!porGrupo.has(g)) porGrupo.set(g, []);
      porGrupo.get(g).push({ ...p, __idx: idx });
    });

    const grupos = Array.from(porGrupo.keys()).sort((a, b) => {
      const na = parseInt(a, 10), nb = parseInt(b, 10);
      if (isFinite(na) && isFinite(nb)) return na - nb;
      return String(a).localeCompare(String(b));
    });

    if (!grupos.length) {
      el.innerHTML = `<p class="muted">Sin resultados.</p>`;
      return;
    }

    el.innerHTML = grupos.map(g => {
      const filas = porGrupo.get(g).map(p => {
        const estadoTxt = (p.estado && p.estado.length) ? ` <span class="estado-tag">(${p.estado.join(", ")})</span>` : "";
        return `
        <tr class="fila-persona" data-idx="${p.__idx}" tabindex="0" role="button" aria-haspopup="dialog">
          <td>${p.nombre}${alertaActividadHtml(p.actividad)}${estadoTxt}${p.notas ? `<div class="notas">${p.notas}</div>` : ""}</td>
          <td>${badge(p.dpa, p.linkDpa)}${alertaDpaHtml(p.alertaDPA)}</td>
          <td>${badge(p.usoDatos, p.linkAutorizacion)}</td>
          <td>${badge(p.datosPersonales, "", "Sí", "Pendiente")}${p.datosPersonalesFecha ? `<div class="notas">${p.datosPersonalesFecha}</div>` : ""}</td>
        </tr>
      `;
      }).join("");

      const colapsado = gruposColapsadosTabla.has(String(g));
      return `
        <section class="grupo-block ${colapsado ? "colapsado" : ""}">
          <h2 class="grupo-toggle" data-grupo="${g}" tabindex="0" role="button" aria-expanded="${!colapsado}">
            <span class="grupo-toggle-caret">${colapsado ? "▸" : "▾"}</span> Grupo ${g}
          </h2>
          <div class="tabla-wrap">
            <table>
              <thead>
                <tr><th>Nombre</th><th>DPA</th><th>Uso de Datos</th><th>Datos Personales</th></tr>
              </thead>
              <tbody>${filas}</tbody>
            </table>
          </div>
        </section>
      `;
    }).join("");

    el.querySelectorAll(".grupo-toggle").forEach(h2 => {
      const toggle = () => {
        const g = h2.dataset.grupo;
        if (gruposColapsadosTabla.has(g)) gruposColapsadosTabla.delete(g);
        else gruposColapsadosTabla.add(g);
        renderTabla(el, personas, filtro, onClickPersona);
      };
      h2.addEventListener("click", toggle);
      h2.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
      });
    });

    if (onClickPersona) {
      el.querySelectorAll(".fila-persona").forEach(tr => {
        const persona = personas[Number(tr.dataset.idx)];
        tr.addEventListener("click", (e) => {
          if (e.target.closest("a")) return; // dejar que el link del badge abra el documento
          onClickPersona(persona);
        });
        tr.addEventListener("keydown", (e) => {
          if (e.target.closest("a")) return;
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClickPersona(persona); }
        });
      });
    }
  }

  window.PublicadoresApp = {
    cargarPublicadores,
    renderResumen,
    renderTabla,
    normalizeName,
    badge,
    formatFecha,
    alertaDpaHtml,
    calcularAlertaDPA,
    ESTADOS_VALIDOS,
    ESTADO_INCOMPATIBLES,
    parseEstados,
    cargarEstadoActividad,
    alertaActividadHtml,
    cargarDatosPublicadores,
    actualizarCachePublicadores,
    invalidarCachePublicadores,
    suscribirseACambiosDeCache
  };
})();
