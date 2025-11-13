// revisitas-api.js
// Frontend helper for "Revisitas / Estudios" backed by Apps Script Web App.
// Requires window.APP_CONFIG with REVISITAS_API_URL and (optionally) REVISITAS_CSV_URL.
// Exposes: window.RevisitasApi = { listByUser, save, formatLatLng6Grouped, normalizeLatLngToFloat }

(function(){
  const CFG = (window.APP_CONFIG || {});

  // ===== Helpers =====
  function formatLatLng6Grouped(value){
    const n = Number(value);
    if (!isFinite(n)) return "";
    const sign = n < 0 ? "-" : "";
    const abs = Math.abs(n);
    const parts = abs.toFixed(6).split(".");
    const intPart = parts[0];
    const fracPartRaw = parts[1] || "000000";
    // group 3+3 with dot (e.g., "776710" -> "776.710")
    const fracGrouped = fracPartRaw.slice(0,3) + "." + fracPartRaw.slice(3);
    return `${sign}${intPart}.${fracGrouped}`;
  }

  function normalizeLatLngToFloat(s, maxAbs){
    if (typeof s === "number") return s;
    if (!s) return 0;
    s = String(s).trim();
    // Accept "-34.776.710" -> "-34.776710"
    const m = s.match(/^(-?\d+)\.(\d{3})\.(\d{3})$/);
    if (m) s = `${m[1]}.${m[2]}${m[3]}`;
    s = s.replace(",", ".");
    const n = parseFloat(s);
    if (!isFinite(n)) return 0;
    if (maxAbs && Math.abs(n) > maxAbs) return 0;
    return n;
  }
  function normalizeLat(s){ return normalizeLatLngToFloat(s, 90); }
  function normalizeLng(s){ return normalizeLatLngToFloat(s, 180); }

  // ===== CSV parser (RFC4180-lite) =====
  function parseCSV(text){
    const rows = [];
    let cur = "", row = [], inQ = false;
    for (let i=0;i<text.length;i++){
      const c = text[i], n = text[i+1];
      if (inQ){
        if (c === '"' && n === '"'){ cur += '"'; i++; }
        else if (c === '"'){ inQ = false; }
        else { cur += c; }
      } else {
        if (c === '"'){ inQ = true; }
        else if (c === ','){ row.push(cur); cur=''; }
        else if (c === '\r'){ /* ignore */ }
        else if (c === '\n'){ row.push(cur); rows.push(row); row=[]; cur=''; }
        else { cur += c; }
      }
    }
    if (cur.length || row.length){ row.push(cur); rows.push(row); }
    if (rows.length === 0) return [];
    const headers = rows.shift().map(h => String(h||"").trim());
    const headersLC = headers.map(h => h.toLowerCase());
    return rows
      .filter(r => r.some(x => String(x||'').trim() !== ''))
      .map(r => {
        const o = {};
        headersLC.forEach((h, i) => o[h] = r[i] ?? '');
        return o;
      });
  }

  // ===== Row mapper =====
  function mapRowToModel(x, userFilter){
    const get = (obj, keys, def="") => {
      for (const k of keys){
        if (Object.prototype.hasOwnProperty.call(obj, k) && obj[k] != null && String(obj[k]).trim() !== ""){
          return String(obj[k]).trim();
        }
      }
      return def;
    };

    const user = get(x, ["user","usuario","username","uname","mail","email"], "").trim();
    if (userFilter && user && user !== userFilter) return null;
    if (userFilter && !user) x.user = userFilter;

    const id    = get(x, ["id","codigo","cod","id_revisita","idrev"], "");
    const nombre= get(x, ["nombre","name","persona","familia"], "");
    const fecha = get(x, ["fecha","date","fch"], "");
    const direccion = get(x, ["direccion","dirección","address","addr","dir"], "");
    const tema  = get(x, ["tema","notas","nota","observaciones","obs","comentarios","comentario"], "");
    const prox  = get(x, ["prox","proxima","próxima","next","proximo","próximo","fch_prox"], "");
    const tipo  = (get(x, ["tipo","clase","categoria","categoría"], "revisita") || "revisita").toLowerCase();

    const lat  = normalizeLat(get(x, ["lat","latitude","latitud"], ""));
    const lng  = normalizeLng(get(x, ["lng","long","lon","longitude","longitud"], ""));

    return { id, user: user || (userFilter || ""), nombre, fecha, direccion, tema, prox, tipo, lat, lng };
  }

  // ===== JSONP list with CSV fallback =====
  function listByUser(user){
    return new Promise((resolve) => {
      const API = CFG.REVISITAS_API_URL;
      const CSV = CFG.REVISITAS_CSV_URL;

      function done(arr){ resolve((arr || []).filter(Boolean)); }

      function tryCSV(){
        if (!CSV){
          console.warn("[RevisitasApi] No CSV fallback configured.");
          return done([]);
        }
        fetch(CSV, { cache: "no-store" })
          .then(r => r.text())
          .then(text => {
            const arr = parseCSV(text);
            const mapped = arr.map(x => mapRowToModel(x, user)).filter(Boolean);
            done(mapped);
          })
          .catch(_ => done([]));
      }

      if (!API){ tryCSV(); return; }

      const cbName = "jsonpListCb_" + Date.now();
      let settled = false, script;

      function cleanup(){
        if (settled) return;
        settled = true;
        try{ delete window[cbName]; }catch(_){}
        if (script && script.parentNode) try{ document.body.removeChild(script); }catch(_){}
      }

      window[cbName] = (data) => {
        cleanup();
        if (data && data.ok && Array.isArray(data.items)){
          const mapped = data.items.map(x => mapRowToModel(x, user)).filter(Boolean);
          done(mapped);
        } else if (Array.isArray(data)){
          const mapped = data.map(x => mapRowToModel(x, user)).filter(Boolean);
          done(mapped);
        } else {
          done([]);
        }
      };

      const params = new URLSearchParams({ action: "list", user, callback: cbName, rnd: String(Date.now()) });
      script = document.createElement("script");
      script.src = API + "?" + params.toString();
      script.referrerPolicy = "no-referrer";
      script.async = true;
      script.onerror = () => { cleanup(); tryCSV(); };
      script.onload  = () => { if (!settled){ cleanup(); tryCSV(); } };
      document.body.appendChild(script);

      setTimeout(() => { if (!settled){ cleanup(); tryCSV(); } }, 4000);
    });
  }

  // ===== Save (add/update) =====
  // nuevo: { _mode: "add"|"edit", id, user, nombre, fecha, direccion, tema, prox, tipo, lat, lng|long }
  async function save(nuevo){
    const API = CFG.REVISITAS_API_URL;
    if (!API) throw new Error("REVISITAS_API_URL no configurado");

    const username = (window.AuthApp && window.AuthApp.getUsername && window.AuthApp.getUsername()) || nuevo.user || "";
    if (!username) throw new Error("Usuario no logueado");

    const isEdit = (nuevo && nuevo._mode === "edit");
    const id = String(nuevo.id || Date.now());

    // formato 3+3 al guardar
    const latOut  = formatLatLng6Grouped(nuevo.lat);
    const longOut = formatLatLng6Grouped(nuevo.long ?? nuevo.lng);

    const body = new URLSearchParams();
    body.append("action", isEdit ? "update" : "add");
    body.append("id", id);
    body.append("user", username);
    body.append("nombre", nuevo.nombre || "");
    body.append("fecha", nuevo.fecha || "");
    body.append("direccion", nuevo.direccion || "");
    body.append("tema", nuevo.tema || "");
    body.append("prox", nuevo.prox || "");
    body.append("tipo", (nuevo.tipo || "revisita"));
    body.append("lat",  latOut);
    body.append("long", longOut);

    const res = await fetch(API, { method: "POST", body });
    const data = await res.json();
    if (!data || !data.ok){
      throw new Error("Guardar revisita falló: " + JSON.stringify(data));
    }
    return data;
  }

  // Expose
  window.RevisitasApi = {
    listByUser,
    save,
    formatLatLng6Grouped,
    normalizeLatLngToFloat
  };
})();
