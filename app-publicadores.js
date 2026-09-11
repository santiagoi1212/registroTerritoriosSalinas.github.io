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
  // Carga + cruce de datos
  // ==========================
  async function cargarPublicadores() {
    const cfg = window.APP_CONFIG || {};
    const rows = await fetchCSV(cfg.PUBLICADORES_CSV_URL);

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

      return {
        grupo: r.Grupo || "",
        nombre: r.Nombre || "",
        dpa, linkDpa: r.LinkDPA || "",
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
      return `<a class="badge badge-ok" href="${link}" target="_blank" rel="noopener">✔ ${labelOk}</a>`;
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

  function renderTabla(el, personas, filtro) {
    const f = normalizeName(filtro || "");
    const porGrupo = new Map();
    personas.forEach(p => {
      if (f && !normalizeName(p.nombre).includes(f)) return;
      const g = p.grupo || "Sin grupo";
      if (!porGrupo.has(g)) porGrupo.set(g, []);
      porGrupo.get(g).push(p);
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
      const filas = porGrupo.get(g).map(p => `
        <tr>
          <td>${p.nombre}${p.notas ? `<div class="notas">${p.notas}</div>` : ""}</td>
          <td>${badge(p.dpa, p.linkDpa)}</td>
          <td>${badge(p.usoDatos, p.linkAutorizacion)}</td>
          <td>${badge(p.datosPersonales, "", "Sí", "Pendiente")}${p.datosPersonalesFecha ? `<div class="notas">${p.datosPersonalesFecha}</div>` : ""}</td>
        </tr>
      `).join("");

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
  }

  window.PublicadoresApp = {
    cargarPublicadores,
    renderResumen,
    renderTabla,
    normalizeName
  };
})();
