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
  // Estado (publicador / precursor regular / precursor especial /
  // siervo ministerial / anciano). Una persona puede tener hasta dos.
  // En la planilla va en la columna "Estado", separados por "," o "|".
  // ==========================
  const ESTADOS_VALIDOS = ["Publicador", "Precursor Regular", "Precursor Especial", "Siervo Ministerial", "Anciano"];

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
        estado: parseEstados(r.Estado),
        dpa, linkDpa: r.LinkDPA || "",
        fechaVenceDPA, alertaDPA: calcularAlertaDPA(fechaVenceDPA),
        usoDatos, linkAutorizacion: r.LinkAutorizacion || "",
        datosPersonales, datosPersonalesFecha,
        notas: r.Notas || ""
      };
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
          <td>${p.nombre}${estadoTxt}${p.notas ? `<div class="notas">${p.notas}</div>` : ""}</td>
          <td>${badge(p.dpa, p.linkDpa)}${alertaDpaHtml(p.alertaDPA)}</td>
          <td>${badge(p.usoDatos, p.linkAutorizacion)}</td>
          <td>${badge(p.datosPersonales, "", "Sí", "Pendiente")}${p.datosPersonalesFecha ? `<div class="notas">${p.datosPersonalesFecha}</div>` : ""}</td>
        </tr>
      `;
      }).join("");

      return `
        <section class="grupo-block">
          <h2>Grupo ${g}</h2>
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
    calcularAlertaDPA
  };
})();
