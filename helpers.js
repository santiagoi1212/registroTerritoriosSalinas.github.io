// helpers.js — funciones utilitarias globales (sin dependencias del DOM)
(function (root) {
  'use strict';

  function normalizarId(x) {
    let s = String(x ?? "")
      .normalize("NFKC")
      .replace(/[\u200B\u200C\u200D\u2060\uFEFF]/g, "")
      .replace(/[\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!s) return "";
    const stripZeros = (v) => v.replace(/^0+/, "") || "0";
    if (/^\d+$/.test(s)) return stripZeros(s);
    let m = s.match(/(\d+)\s*$/);
    if (m) return stripZeros(m[1]);
    if (s.includes("|")) {
      const right = s.split("|").pop();
      m = right.match(/(\d+)(?!.*\d)/);
      if (m) return stripZeros(m[1]);
    }
    const all = s.match(/\d+/g);
    if (all && all.length) return stripZeros(all[all.length - 1]);
    return s;
  }

  function idKey(x){ return normalizarId(x); }

  function diferenciaEnMeses(a, b) {
    if (!(a instanceof Date) || isNaN(a)) return Infinity;
    let m = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
    if (b.getDate() < a.getDate()) m -= 1;
    return m;
  }

  function quitarTildes(s) { return s?.normalize?.("NFD").replace(/\p{Diacritic}/gu, "") || s; }

  function parseCSVLine(line) {
    const out = []; let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else { inQ = !inQ; }
      } else if (ch === "," && !inQ) { out.push(cur); cur = ""; }
      else { cur += ch; }
    }
    out.push(cur); return out;
  }

  function parseFechaSeguro(s) {
    s = String(s || "").trim();
    if (!s) return new Date("Invalid");
    const d1 = new Date(s); if (!isNaN(d1)) return d1;
    const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
    return new Date("Invalid");
  }

  function parseFecha(s){
    if(!s) return null;
    const t = String(s).trim();
    const d1 = new Date(t); if(!isNaN(d1)) return d1;
    const m = t.match(/^([0-3]?\d)[\/\-]([0-1]?\d)[\/\-](\d{4})$/);
    if(m){ const [_,dd,mm,yy]=m; return new Date(parseInt(yy), parseInt(mm)-1, parseInt(dd)); }
    const m2 = t.match(/^(\d{4})[\/\-]([0-1]?\d)[\/\-]([0-3]?\d)$/);
    if(m2){ const [_,yy,mm,dd]=m2; return new Date(parseInt(yy), parseInt(mm)-1, parseInt(dd)); }
    return null;
  }

  function normalizarFinalizado(v){
    const s = String(v ?? '').trim().toLowerCase();
    if(!s) return '';
    if(['si','sí','s','true','1','ok','finalizado','completo','terminado'].includes(s)) return 'Si';
    if(['no','n','false','0','pendiente','incompleto','en curso','trabajando'].includes(s)) return 'No';
    return s;
  }

  function estiloPorKey(key){
    const base = { color:'#333', weight:1, fillOpacity:0.35 };
    if(key==='blue')   return { ...base, fillColor:'#3388ff' };
    if(key==='green')  return { ...base, fillColor:'#2e7d32' };
    if(key==='yellow') return { ...base, fillColor:'#ffd500' };
    if(key==='red')    return { ...base, fillColor:'#b53a22' };
    if(key==='gray')   return { ...base, fillColor:'#9e9e9e' };
    return { ...base, fillColor:'#90caf9' };
  }

  function colorKeyPorFechaEstado(p){
    const fechaValida = p.fecha instanceof Date && !isNaN(p.fecha);
    if(!fechaValida) return 'gray';
    const diffMeses = diferenciaEnMeses(p.fecha, new Date());
    if(diffMeses < 2) return p.finalizado === 'Si' ? 'green' : 'blue';
    if(diffMeses <= 3) return 'yellow';
    return 'red';
  }

  function obtenerColor(fecha, finalizado) {
    if (!(fecha instanceof Date) || isNaN(fecha)) return "gray";
    const ahora = new Date();
    const diffMeses = diferenciaEnMeses(fecha, ahora);
    const fin = String(finalizado ?? "").trim().toLowerCase();
    const esSi = ["si","sí","true","1","ok","finalizado","completo","terminado"].includes(fin) || finalizado === true;
    if (diffMeses < 2 && !esSi) return "blue";
    if (diffMeses < 2 &&  esSi) return "green";
    if (diffMeses <= 3) return "yellow";
    return "red";
  }

  async function fetchTextWithFallback(sheetCsvUrl) {
    try {
      const res = await fetch(sheetCsvUrl, { redirect: "follow", headers: { Accept: "text/csv" } });
      if (res.ok) {
        const txt = await res.text();
        if (txt && txt.trim() !== "") return txt;
      }
    } catch (_) {}
    const candidates = [
      "https://api.allorigins.win/raw?url=" + encodeURIComponent(sheetCsvUrl),
      "https://cors.isomorphic-git.org/" + sheetCsvUrl,
      "https://r.jina.ai/http://" + sheetCsvUrl.replace(/^https?:\/\//, ""),
      "https://r.jina.ai/https://" + sheetCsvUrl.replace(/^https?:\/\//, ""),
    ];
    for (const url of candidates) {
      try {
        const res = await fetch(url, { redirect: "follow" });
        if (res.ok) {
          const txt = await res.text();
          if (txt && txt.trim() !== "") return txt;
        }
      } catch (e) { /* ignore */ }
    }
    throw new Error("No se pudo obtener el CSV (CORS/proxy).");
  }

  function indicesPorEncabezado(headers) {
    const norm = headers.map((h) => quitarTildes(String(h || "").trim().toLowerCase()));
    const lookup = (...aliases) => {
      const aliNorm = aliases.map((a) => quitarTildes(a.toLowerCase()));
      for (let i = 0; i < norm.length; i++) if (aliNorm.includes(norm[i])) return i;
      return -1;
    };
    return {
      id: lookup("id", "identificador", "territorio"),
      fecha: lookup("ultima fecha","última fecha","fecha","fecha ultima","fecha última"),
      finalizado: lookup("finalizado","estado","se finalizo","se finalizó")
    };
  }

  const api = {
    normalizarId, idKey, diferenciaEnMeses, quitarTildes, parseCSVLine,
    parseFechaSeguro, parseFecha, normalizarFinalizado, estiloPorKey,
    colorKeyPorFechaEstado, obtenerColor, fetchTextWithFallback, indicesPorEncabezado
  };

  // export global
  root.Helpers = api;
  // también como funciones globales directas para compat
  Object.keys(api).forEach(k => { if (!root[k]) root[k] = api[k]; });

})(window);
