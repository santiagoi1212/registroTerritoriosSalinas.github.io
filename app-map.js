(function () {
  "use strict";

  // ==========================
  // Estado interno
  // ==========================
  let map;

  // Capas
  let territoriosLayer;
  let housesLayer;
  let weeklyLayer;
  let revisitasLayer;
// === Safe renderer for Revisitas markers ===
function renderRevisitasMarkers(data){
  try{
    const map = getMap();
    if (!map) return;
    revisitasLayer.addTo(map);
    revisitasLayer.clearLayers();
    (Array.isArray(data) ? data : []).forEach(rv => {
      const lat = parseFloat(rv.lat);
      const lng = parseFloat(rv.lng ?? rv.long);
      if (!isFinite(lat) || !isFinite(lng)) return;
      const m = L.marker([lat, lng]).addTo(revisitasLayer);
      const title = rv.nombre || rv.direccion || "Revisita";
      m.bindPopup(`<b>${title}</b><br>${rv.fecha||""}`);
    });
  }catch(e){
    console.warn("renderRevisitasMarkers error", e);
  }
}


  
  // ===== Revisitas CSV unificado en MapApp =====
  let revisitasData = [];

  function parseCsvRfc4180(text){
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
    if (cur.length>0 || row.length>0) { row.push(cur); rows.push(row); }
    return rows;
  }
  function normalizeLatLngToFloat(s, maxAbs){
    s = String(s ?? "").trim();
    if (!s) return 0;
    const m = s.match(/^(-?\d+)\.(\d{3})\.(\d{3})$/);
    if (m) s = `${m[1]}.${m[2]}${m[3]}`;
    s = s.replace(",", ".");
    const n = parseFloat(s);
    if (!isFinite(n)) return 0;
    if (maxAbs && Math.abs(n) > maxAbs) return 0;
    return n;
  }
  function nLat(s){ return normalizeLatLngToFloat(s, 90); }
  function nLng(s){ return normalizeLatLngToFloat(s, 180); }

  async function loadRevisitasCsv(url, user){
    const res = await fetch(url, { cache: "no-store" });
    const text = await res.text();
    const rows = parseCsvRfc4180(text);
    const head = rows[0] || [];
    const idx = (name) => head.indexOf(name);
    const IU = idx("user"), IN = idx("nombre"), IF = idx("fecha"), ID = idx("direccion"),
          IT = idx("tema"), IP = idx("prox"), ITP = idx("tipo"), ILA = idx("lat"), ILO = idx("lng");
    revisitasData = rows.slice(1).map(r => ({
      user: r[IU] || "", nombre: r[IN] || "", fecha: r[IF] || "",
      direccion: r[ID] || "", tema: r[IT] || "", prox: r[IP] || "",
      tipo: r[ITP] || "", lat: nLat(r[ILA]), lng: nLng(r[ILO])
    })).filter(x => x.lat && x.lng && (!user || (x.user||'').toLowerCase() === user.toLowerCase()));
    // Pintar
    renderRevisitasMarkers(revisitasData);
  }

  function renderRevisitasMarkers(data){
    try{
      if (!map) return;
      if (!revisitasLayer) revisitasLayer = L.layerGroup();
      // limpiar previos
      revisitasLayer.clearLayers();
      (data||[]).forEach((rv)=>{
        if (!isFinite(rv.lat) || !isFinite(rv.lng)) return;
        const m = L.marker([rv.lat, rv.lng], { title: rv.nombre || "Revisita" });
        m.bindPopup(
          `<strong>${rv.nombre||"Revisita"}</strong><br>`+
          (rv.direccion? `${rv.direccion}<br>`:"")+
          (rv.fecha? `📅 ${rv.fecha}<br>`:"")+
          (rv.tipo? `🏷️ ${rv.tipo}`:"")
        );
        m.addTo(revisitasLayer);
      });
    }catch(e){
      console.warn("renderRevisitasMarkers error", e);
    }
  }

  function showRevisitas(on){
    if (!map) return;
    if (!revisitasLayer) revisitasLayer = L.layerGroup();
    if (on){ revisitasLayer.addTo(map); } else { try{ map.removeLayer(revisitasLayer); }catch(_){ } }
    return !!on;
  }

// ===== NUEVO: "No visitar" y offline-first de sugerencias =====
  let noVisitarLayer;
  let noVisitarVisible = false;

  const NOVI_LS = {
    points: "novisitar.points.v1",      // puntos aprobados (visibles a todos)
    queue:  "novisitar.suggestions.v1", // cola de sugerencias (si falla red)
  };

  function nv_lsGet(key, def){ try { return JSON.parse(localStorage.getItem(key)||"null") ?? def; } catch { return def; } }
  function nv_lsSet(key, val){ try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

  function buildNoVisitarIcon(label="⛔"){
    return L.divIcon({
      className: "no-visitar-marker",
      html: label,
      iconSize: [1,1],
      iconAnchor: [0,0],
    });
  }

  function renderNoVisitar(){
    if (!noVisitarLayer) return;
    noVisitarLayer.clearLayers();
    const pts = nv_lsGet(NOVI_LS.points, []);
    pts.forEach(p=>{
      const m = L.marker([p.lat, p.lng], {
        icon: buildNoVisitarIcon("⛔"),
        title: p.comment ? `No visitar: ${p.comment}` : "No visitar",
        interactive: true
      });
      if (p.comment){
        m.bindPopup(`<strong>No visitar</strong><br>${p.comment}`);
      }
      m.addTo(noVisitarLayer);
    });
  }

  function toggleNoVisitar(){
    noVisitarVisible = !noVisitarVisible;
    if (noVisitarVisible){
      renderNoVisitar();
      noVisitarLayer && noVisitarLayer.addTo(map);
    } else {
      noVisitarLayer && noVisitarLayer.remove();
    }
    updateNovisitarFab();
    return noVisitarVisible;
  }

  let novistarPendingLatLng = null;

  function enableNovistarPick(){
    if (!map) return;
    window.showToast && window.showToast("Tocá el mapa para marcar el lugar");
    const onceHandler = (ev) => {
      novistarPendingLatLng = ev.latlng;
      // Abrir modal si existe; si no, usamos prompt
      const ov = document.getElementById("novistar-overlay");
      if (ov){
        const pos = document.getElementById("novistar-pos");
        if (pos){
          const {lat,lng} = novistarPendingLatLng;
          pos.textContent = `Posición: ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
        }
        ov.style.display = "block";
      } else {
        // Fallback
        const comment = window.prompt("Comentario para 'No visitar':");
        if (comment !== null){
          sendNovistarSuggestion(comment);
        }
      }
      map.off("click", onceHandler);
    };
    map.once("click", onceHandler);
  }

  async function sendNovistarSuggestion(comment){
    const cfg = (window.APP_CONFIG || window.APP || {});
    const url = cfg.WEBHOOK_URL;
    const payload = {
      type: "no_visitar_suggestion",
      lat: novistarPendingLatLng?.lat,
      lng: novistarPendingLatLng?.lng,
      comment: comment || "",
      user: (typeof AuthApp !== "undefined" && AuthApp.getUsername ? (AuthApp.getUsername() || "anon") : "anon"),
      ts: Date.now()
    };
    if (!payload.lat || !payload.lng){
      window.showToast && window.showToast("Falta posición. Intentá de nuevo.");
      return;
    }
    try{
      const r = await fetch(url, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(payload) });
      if (!r.ok) throw new Error("HTTP "+r.status);
      window.showToast && window.showToast("Sugerencia enviada ✅");
    } catch(err){
      const q = nv_lsGet(NOVI_LS.queue, []);
      q.push(payload);
      nv_lsSet(NOVI_LS.queue, q);
      window.showToast && window.showToast("Sin red. Sugerencia en cola ⏳");
    } finally {
      novistarPendingLatLng = null;
    }
  }

  async function flushNovistarSuggestions(){
    const cfg = (window.APP_CONFIG || window.APP || {});
    const url = cfg.WEBHOOK_URL;
    if (!url) return;
    let q = nv_lsGet(NOVI_LS.queue, []);
    if (!q.length) return;
    const remain = [];
    for (const item of q){
      try{
        const r = await fetch(url, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(item) });
        if (!r.ok) throw new Error("HTTP "+r.status);
      } catch {
        remain.push(item);
      }
    }
    nv_lsSet(NOVI_LS.queue, remain);
    if (q.length && !remain.length){
      window.showToast && window.showToast("Sugerencias enviadas ✅");
    }
  }

  // ===== FAB flotante "Sugerir" =====
  let fabNovisitar;

  function ensureNovisitarToggleButton(){
    const bar = document.getElementById("bottombar");
    if (!bar) return;
    if (!document.getElementById("btn-novistar-toggle")){
      const btn = document.createElement("button");
      btn.id = "btn-novistar-toggle";
      btn.className = "bb-item";
      btn.setAttribute("data-active","off");
      btn.title = "Mostrar/Ocultar No visitar";
      btn.innerHTML = '<div class="bb-icon" id="icon-novistar">⛔</div><div class="bb-label">No visitar</div>';
      bar.appendChild(btn);
      btn.addEventListener("click", ()=>{
        const on = toggleNoVisitar();
        btn.setAttribute("data-active", on ? "on" : "off");
      });
    }
  }

  function createNovisitarFab(){
    if (fabNovisitar) return;
    fabNovisitar = document.createElement("button");
    fabNovisitar.id = "fab-novistar-sugerir";
    fabNovisitar.textContent = "Sugerir";
    fabNovisitar.setAttribute("type","button");
    fabNovisitar.style.display = "none";
    fabNovisitar.className = "fab-novisitar";
    document.body.appendChild(fabNovisitar);

    fabNovisitar.addEventListener("click", ()=>{
      enableNovistarPick();
    });

    // Modal hooks si existen
    const ov = document.getElementById("novistar-overlay");
    if (ov){
      const btnClose = document.getElementById("novistar-close");
      const btnCancel= document.getElementById("novistar-cancel");
      const btnSend  = document.getElementById("novistar-send");
      const txtArea  = document.getElementById("novistar-coment");

      const closeModal = ()=>{ ov.style.display = "none"; txtArea && (txtArea.value=""); };
      btnClose && btnClose.addEventListener("click", closeModal);
      btnCancel && btnCancel.addEventListener("click", closeModal);
      btnSend && btnSend.addEventListener("click", async ()=>{
        const comment = (txtArea && txtArea.value) || "";
        await sendNovistarSuggestion(comment);
        closeModal();
      });
    }
  }

function updateNovisitarFab(){
  const fab = document.getElementById("fab-novistar-sugerir");
  if (!fab) return;
  const visible = (typeof AuthApp !== "undefined" && AuthApp.getRole && AuthApp.getRole() === "publicador") && noVisitarVisible;
  fab.style.display = visible ? "flex" : "none";
}


  function injectExtraStyles(){
    if (document.getElementById("appmap-extra-styles")) return;
    const st = document.createElement("style");
    st.id = "appmap-extra-styles";
    st.textContent = `
      .no-visitar-marker{
        display:inline-flex;align-items:center;justify-content:center;
        font-weight:700;font-size:14px;background:rgba(220,38,38,.9);
        color:#fff;border:1px solid #7f1d1d;border-radius:10px;padding:3px 6px;
        box-shadow:0 2px 6px rgba(0,0,0,.35);
      }
      .fab-novisitar{
        position:fixed;right:16px;bottom:120px;z-index:1000;
        padding:10px 14px;border-radius:9999px;border:none;
        box-shadow:0 6px 16px rgba(0,0,0,.35);
        background:#ef4444;color:#fff;font-weight:700;cursor:pointer;
      }
      .fab-route{
        position:fixed;right:16px;bottom:180px;z-index:1000;
      }
      #btnToggleLabels.bb-item{ /* nada */}
    `;
    document.head.appendChild(st);
  }

  function fixRouteButtonAsFab(){
    const btn = document.getElementById("btn-route-toggle");
    if (!btn) return;
    btn.classList.add("fab-route");
  }


  // Visibilidad / flags
  let territoriosVisible      = true;
  let housesVisible           = false;
  let weeklyRoutingEnabled    = false;
  let weeklyLayerVisible      = false;
  let revisitasMode = false;
  // Ruta / geoloc
  let routeControl = null;
  let geoWatchId   = null;
  let geoMarker    = null;

  // Predicación semanal selección
  let weeklyMarker    = null;
  let lastWeeklyPoint = null;

  // Etiquetas polígonos
  let labelsVisible   = true;

  // Rol actual del usuario (admin/capitan/publicador/etc)
  let userRole        = "";

  // Datos
  let poligonosData   = [];
  let WEEKLY_POINTS   = [];
  let HOUSES_POINTS   = [];

  // ==========================
  // Helpers
  // ==========================
  function mesesDiferencia(a, b){
    if (!(a instanceof Date) || isNaN(a)) return Infinity;
    let m = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
    if (b.getDate() < a.getDate()) m -= 1;
    return m;
  }

    // Ajustar visibilidad inicial del botón "Números" (ojo)
    (function initToggleLabelsButton(){
      const btnLabels = document.getElementById("btnToggleLabels");
      if (!btnLabels) return;
      if (territoriosVisible){
        btnLabels.style.display = "";
        btnLabels.disabled = false;
        btnLabels.classList.remove("bb-disabled");
      } else {
        btnLabels.style.display = "none";
      }
    })();

  function colorKeyPorFechaEstado(fecha, finalizado){
    // Esta función para cuando SÍ hay fecha
    const f = fecha ? new Date(fecha) : null;
    const fin = String(finalizado||"").trim();

    if (!f || isNaN(f)) {
      return "grey";
    }

    if (fin === 'Si'){
      const diffMeses = mesesDiferencia(f, new Date());
      if (diffMeses < 2) return 'green';
      if (diffMeses <= 3) return 'yellow';
      return 'red';
    } else {
      // tiene fecha pero no finalizado -> azul
      return 'blue';
    }
  }

  function styleFromColorKey(key){
    switch(key){
      case 'blue':
        return {color:'#1e3a8a', weight:1.2, fillColor:'#93c5fd', fillOpacity:0.5}; // trabajando
      case 'green':
        return {color:'#065f46', weight:1.2, fillColor:'#86efac', fillOpacity:0.5}; // finalizado reciente
      case 'yellow':
        return {color:'#78350f', weight:1.2, fillColor:'#fde68a', fillOpacity:0.5}; // finalizado 2-3m
      case 'red':
        return {color:'#7f1d1d', weight:1.2, fillColor:'#fca5a5', fillOpacity:0.5}; // finalizado viejo
      case 'grey':
      default:
        return {color:'#374151', weight:1.2, fillColor:'#e5e7eb', fillOpacity:0.5}; // sin datos aún
    }
  }

  // ==========================
  // Carga de datos externos
  // ==========================
  async function loadWeeklyPoints() {
    try {
      const resp = await fetch("./predicacion_semanal.json", { cache: "no-store" });
      if (!resp.ok) throw new Error("Error HTTP " + resp.status);
      WEEKLY_POINTS = await resp.json();
    } catch (err) {
      console.error("No se pudo cargar predicación semanal:", err);
      WEEKLY_POINTS = [];
    }
  }

  async function loadHousesPoints() {
    try {
      const resp = await fetch("./casas_familias.json", { cache: "no-store" });
      if (!resp.ok) throw new Error("Error HTTP " + resp.status);
      HOUSES_POINTS = await resp.json();
    } catch (err) {
      console.error("No se pudo cargar casas_familias.json:", err);
      HOUSES_POINTS = [];
    }
  }

  async function loadPolygonsJSON(){
    const url = (window.APP && window.APP.POLIGONOS_JSON_URL) || "./poligonos_salinas.json";
    const res = await fetch(url, { cache: "no-store" });
    const arr = await res.json();

    // territorio: nro territorio (si lo tenés)
    // id: identificador único de polígono (lo mostramos como "manzana")
    poligonosData = arr.map(p => ({
      id: p.id,
      territorio: p.territorio || p.id,
      coords: p.coords,
      fecha: null,
      finalizado: null,
      colorKey: "grey", // default gris
      layer: null
    }));
  }

  // ==========================
  // Casas
  // ==========================
  function renderHouses(){
    housesLayer.clearLayers();

    HOUSES_POINTS.forEach(h => {
      const emoji = h.emoji || "🏠";

      const html = `
        <div class="house-marker">
          <div class="house-marker-emoji">${emoji}</div>
          <div class="house-marker-label">${h.label}</div>
        </div>
      `;

      const icon = L.divIcon({
        className: "",
        html,
        iconSize: [1,1],
        iconAnchor: [0,0]
      });

      const m = L.marker([h.lat, h.lng], {
        icon,
        interactive: true,
        title: h.label
      });

      m.bindPopup(`<strong>${h.label}</strong>`);
      m.addTo(housesLayer);
    });
  }

  function toggleHouses(){
    housesVisible = !housesVisible;
    if (housesVisible){
      renderHouses();
      housesLayer.addTo(map);
    } else {
      housesLayer.remove();
    }
    return housesVisible;
  }

  // ==========================
  // Polígonos territorios
  // ==========================
  async function cargarDatosDesdeSheets() {
    // Tomar primero de APP_CONFIG, luego de APP, sin usar la URL dummy
    const cfg = (window.APP_CONFIG || window.APP || {});
    const SHEETS_URL = cfg.SHEETS_TERRITORIOS_CSV_URL;

    if (!SHEETS_URL) {
      console.warn("Falta SHEETS_URL en app-config.js o en APP");
      return [];
    }

    let text;
    try {
      const r = await fetch(SHEETS_URL, { cache: "no-store" });
      text = await r.text();
    } catch (err){
      console.error("Error Sheets:", err);
      return [];
    }

    const rows = text.split(/\r?\n/).filter(l=>l.trim()!=="");
    if (!rows.length) return [];

    function parseCSVLine(row){
      const out=[]; let cur=""; let inQ=false;
      for (let i=0;i<row.length;i++){
        const ch=row[i];
        if (ch === '"'){
          if (inQ && row[i+1] === '"'){ cur+='"'; i++; }
          else { inQ=!inQ; }
        } else if (ch === ',' && !inQ){
          out.push(cur); cur="";
        } else {
          cur+=ch;
        }
      }
      out.push(cur);
      return out;
    }

    const headerCols = parseCSVLine(rows[0]);
    let idxId=-1, idxFecha=-1, idxFin=-1;
    headerCols.forEach((h,i)=>{
      const hh = h.toLowerCase();
      if (idxId   === -1 && (hh.includes("id") || hh.includes("territorio"))) idxId=i;
      if (idxFecha=== -1 && hh.includes("fecha")) idxFecha=i;
      if (idxFin  === -1 && (hh.includes("finaliz") || hh.includes("estado"))) idxFin=i;
    });

    const data = [];
    for (let rIndex=1;rIndex<rows.length;rIndex++){
      const cols = parseCSVLine(rows[rIndex]);
      const rawId    = cols[idxId]    ?? "";
      const rawFecha = cols[idxFecha] ?? "";
      const rawFin   = cols[idxFin]   ?? "";

      data.push({
        id: rawId,
        fecha: rawFecha,
        finalizado: rawFin
      });
    }
    return data;
  }

  function applyTooltip(layer, texto){
    layer.bindTooltip(
      `<div class="tooltip-content">${texto}</div>`,
      {
        permanent: true,
        direction: "center",
        className: "numero-cartel"
      }
    );
    if (!labelsVisible){
      try { layer.closeTooltip(); } catch(_){}
    } else {
      try { layer.openTooltip(); } catch(_){}
    }
  }

  function buildRegistroFormHTML(poly){
    return `
      <div class="form-field">
        <label class="form-label">Nº Territorio</label>
        <input class="form-input" value="${poly.territorio || poly.id || ""}" readonly />
      </div>

      <div class="form-field">
        <label class="form-label">Nº Manzana</label>
        <input class="form-input" value="${poly.id || "-"}" readonly />
      </div>

      <div class="form-field">
        <label class="form-label">Capitán</label>
        <select id="reg-capitan" class="form-input">
          <option></option>
          <option>Juan Pérez</option>
          <option>María Gómez</option>
          <option>Luis Rodríguez</option>
          <option>Ana Fernández</option>
        </select>
      </div>

      <div class="form-field">
        <label class="form-label">Fecha</label>
        <input id="reg-fecha" class="form-input" type="date"
               value="${new Date().toISOString().slice(0,10)}" />
      </div>

      <div class="form-field">
        <label class="form-label">¿Finalizado?</label>
        <select id="reg-fin" class="form-input">
          <option value="No" selected>No</option>
          <option value="Si">Si</option>
        </select>
      </div>

      <div class="form-actions">
        <button id="reg-cancel" class="btn-cancel" type="button">Cancelar</button>
        <button id="reg-send"   class="btn-primary" type="button">Guardar</button>
      </div>
    `;
  }

  function recolorPolygon(poly, newColorKey){
    poly.colorKey = newColorKey;
    if (poly.layer){
      const st = styleFromColorKey(newColorKey);
      poly.layer.setStyle(st);
    }
  }

  function openRegistroModal(poly){
    const overlay = document.getElementById("territorio-overlay");
    const body    = document.getElementById("territorio-body");
    if (!overlay || !body) return;

    if (!window.AuthApp || !window.AuthApp.isLogged()){
      window.showToast?.("Tenés que iniciar sesión para registrar este territorio");
      return;
    }

    // si sos publicador no deberías ni ver polígonos,
    // pero por las dudas bloqueamos también acá
    if (userRole === "publicador"){
      window.showToast?.("No tenés permiso para registrar este territorio");
      return;
    }

    body.innerHTML = buildRegistroFormHTML(poly);
    overlay.style.display = "flex";

    body.querySelector("#reg-cancel").addEventListener("click", ()=>{
      overlay.style.display = "none";
    });

    body.querySelector("#reg-send").addEventListener("click", ()=>{
      const finVal = (body.querySelector('#reg-fin') || {}).value || "No";

      // "Si"  => verde
      // "No"  => azul
      const newColorKey = (finVal === "Si") ? "green" : "blue";
      recolorPolygon(poly, newColorKey);

      window.showToast?.("Registrado ✅");
      overlay.style.display = "none";
    });
  }

  function attachPolygonClick(poly, layer){
    layer.on("click", ()=>{
      openRegistroModal(poly);
    });
  }

  function drawSinglePolygon(poly){
    const style = styleFromColorKey(poly.colorKey);
    const layer = L.polygon(poly.coords, style).addTo(territoriosLayer);
    poly.layer = layer;

    applyTooltip(layer, poly.id || "");
    attachPolygonClick(poly, layer);
  }

  async function paintAllPolygonsIfLogged(){
    if (!window.AuthApp || !window.AuthApp.isLogged()) return;
    if (userRole === "publicador") {
      // publicador no pinta polígonos
      return;
    }

    const registros = await cargarDatosDesdeSheets();

    const byId = new Map();
    registros.forEach(r=>{
      const key = String(r.id).trim().split("|")[0];
      byId.set(key, r);
    });

    poligonosData.forEach(p=>{
      const key = String(p.id).trim().split("|")[0];
      const found = byId.get(key);

      if (found){
        p.fecha       = found.fecha;
        p.finalizado  = found.finalizado;

        if (p.fecha) {
          p.colorKey = colorKeyPorFechaEstado(p.fecha, p.finalizado);
        } else {
          p.colorKey = "grey";
        }
      } else {
        // sin datos
        p.fecha       = null;
        p.finalizado  = null;
        p.colorKey    = "grey";
      }
    });

    territoriosLayer.clearLayers();
    poligonosData.forEach(p=> drawSinglePolygon(p));
  }

  function clearAllPolygons(){
    if (territoriosLayer){
      territoriosLayer.clearLayers();
    }
    poligonosData.forEach(p=>{
      p.layer = null;
    });
  }

  // Mostrar/ocultar capa de territorios manualmente (botón)
function toggleTerritoriosLayer(){
  if (!map || !territoriosLayer) return false;

  territoriosVisible = !territoriosVisible;
  if (territoriosVisible){
    territoriosLayer.addTo(map);
  } else {
    territoriosLayer.remove();
  }

  const btnLabels = document.getElementById("btnToggleLabels");
  if (btnLabels){
    if (territoriosVisible){
      btnLabels.style.display = "";
      btnLabels.disabled = false;
      btnLabels.classList.remove("bb-disabled");
    } else {
      btnLabels.style.display = "none";
    }
  }
  return territoriosVisible;
}


  function isTerritoriosVisible(){
    return territoriosVisible;
  }

  function toggleLabels(){
    labelsVisible = !labelsVisible;
    poligonosData.forEach(p=>{
      if (!p.layer) return;
      const tt = p.layer.getTooltip && p.layer.getTooltip();
      if (!tt) return;
      if (labelsVisible){
        p.layer.openTooltip();
      } else {
        p.layer.closeTooltip();
      }
    });
    return labelsVisible;
  }

  // ==========================
  // Predicación semanal
  // ==========================
  function buildWeeklyMarkerHTML(p) {
    const tipo = (p.type || "familia").toLowerCase();
    const emoji = (tipo === "grupo") ? "👥" : "🏠";
    const emojiClass = (tipo === "grupo")
      ? "house-marker-emoji grupo"
      : "house-marker-emoji familia";

    const visibleName = p.label || "Salida";
    return `
      <div class="house-marker">
        <div class="${emojiClass}">${emoji}</div>
        <div class="house-marker-label">${visibleName}</div>
      </div>
    `;
  }

  function makeWeeklyDivIcon(p) {
    return L.divIcon({
      className: "",
      html: buildWeeklyMarkerHTML(p),
      iconSize: [1,1],
      iconAnchor: [20,30]
    });
  }

  function renderWeeklyPointsOnMap() {
    weeklyLayer.clearLayers();

    WEEKLY_POINTS.forEach((p, idx) => {
      const icon = makeWeeklyDivIcon(p);

      const m = L.marker([p.lat, p.lng], {
        icon,
        title: p.label || "Salida"
      });

      const hoverInfo = `${p.dia || ""} ${p.hora || ""}`.trim();
      m.bindPopup(
        `<strong>${p.label || ""}</strong><br>${hoverInfo || ""}`
      );

      m.on("click", async () => {
        await showSingleWeeklyPoint(idx);
        redrawRouteIfPossible();
      });

      weeklyLayer.addLayer(m);
    });
  }

  function getWeeklyPoints(){
    return WEEKLY_POINTS.slice();
  }

  function showWeeklyLayerWithRoutingOnClick(){
    clearWeeklyPoint();
    clearRoute();
    renderWeeklyPointsOnMap();
    if (!weeklyLayerVisible){
      weeklyLayer.addTo(map);
      weeklyLayerVisible = true;
    }
  }

  async function showSingleWeeklyPoint(idx){
    clearWeeklyPoint();
    clearRoute();

    const p = WEEKLY_POINTS[idx];
    if (!p) return;
    lastWeeklyPoint = p;

    const icon = makeWeeklyDivIcon(p);
    weeklyMarker = L.marker([p.lat, p.lng], {
      icon,
      title: p.label || "Salida"
    }).addTo(map);

    map.setView([p.lat, p.lng], 17, { animate:true });
    redrawRouteIfPossible();
  }

  function clearWeeklyPoint(){
    if (weeklyMarker){
      try { map.removeLayer(weeklyMarker); } catch(_){}
      weeklyMarker = null;
    }
    lastWeeklyPoint = null;
  }

  // ==========================
  // Geolocalización + Ruta
  // ==========================
  function setWeeklyRoutingEnabled(flag){
    weeklyRoutingEnabled = !!flag;
  }

  function isGeoActive(){
    return geoWatchId !== null;
  }

function redrawRouteIfPossible(){
  if (!weeklyRoutingEnabled) return;
  if (!geoMarker) return;
  if (!lastWeeklyPoint) return;

  const fromLatLng = geoMarker.getLatLng();
  const toLatLng   = L.latLng(lastWeeklyPoint.lat, lastWeeklyPoint.lng);

  // Limpiar anterior de forma segura
  clearRoute();

  // Crear control y asegurarnos de agregarlo ANTES de setear waypoints
  routeControl = L.Routing.control({
    fitSelectedRoutes: false,
    addWaypoints: false,
    draggableWaypoints: false,
    routeWhileDragging: false,
    language: 'es',
    show: false,
    showAlternatives: false,
    lineOptions: { addWaypoints: false, weight: 5 },
    createMarker: function(){ return null; }
  });

  // 👇 Asegurate de agregarlo al mapa primero
  routeControl.addTo(map);

  try {
    routeControl.setWaypoints([ fromLatLng, toLatLng ]);
  } catch (e) {
    // Si algo falló, destruimos y reintentamos una vez
    try { clearRoute(); } catch(_) {}
    routeControl = L.Routing.control({
      fitSelectedRoutes: false,
      addWaypoints: false,
      draggableWaypoints: false,
      routeWhileDragging: false,
      language: 'es',
      show: false,
      showAlternatives: false,
      lineOptions: { addWaypoints: false, weight: 5 },
      createMarker: function(){ return null; }
    }).addTo(map);
    try { routeControl.setWaypoints([ fromLatLng, toLatLng ]); } catch(_) {}
  }
}


 function clearRoute(){
  if (!routeControl) return;
  try {
    // Vaciar waypoints primero evita que intente tocar capas ya removidas
    try { routeControl.setWaypoints([]); } catch(_) {}

    // Remover el control solo si sigue asociado a un map
    if (routeControl._map) {
      try { routeControl._map.removeControl(routeControl); } catch(_) {}
    }
  } catch(_) {
    // no-op
  } finally {
    routeControl = null;
  }
}


  async function startGeo(){
    if (geoWatchId !== null){
      return true;
    }
    if (!navigator.geolocation){
      window.showToast?.("Geolocalización no soportada");
      return false;
    }
    return new Promise((resolve)=>{
      geoWatchId = navigator.geolocation.watchPosition(
        (pos)=>{
          const { latitude, longitude } = pos.coords;
          const latlng = [latitude, longitude];

          if (!geoMarker){
            geoMarker = L.marker(latlng, { title: "Mi posición" }).addTo(map);
          } else {
            geoMarker.setLatLng(latlng);
          }

          document.dispatchEvent(new CustomEvent("geo:state", {
            detail: { active: true, lat: latitude, lng: longitude }
          }));

          if (!lastWeeklyPoint){
            map.setView(latlng, 16, { animate:true });
          }

          redrawRouteIfPossible();
          resolve(true);
        },
        (err)=>{
          console.error("watchPosition error:", err);
          stopGeo();
          document.dispatchEvent(new CustomEvent("geo:state", {
            detail: { active: false }
          }));
          window.showToast?.("No se pudo obtener ubicación precisa");
          resolve(false);
        },
        {
          enableHighAccuracy: true,
          maximumAge: 10000,
          timeout: 20000
        }
      );
    });
  }

  function stopGeo(){
    if (geoWatchId !== null){
      navigator.geolocation.clearWatch(geoWatchId);
      geoWatchId = null;
    }
    if (geoMarker){
      try { map.removeLayer(geoMarker); } catch(_){}
      geoMarker = null;
    }
    document.dispatchEvent(new CustomEvent("geo:state", {
      detail: { active: false }
    }));
  }

  async function ensureRouteWithGeo(){
    weeklyRoutingEnabled = true;

    if (!isGeoActive()){
      const ok = await startGeo();
      if (!ok) return false;
    }

    redrawRouteIfPossible();
    return !!routeControl;
  }

  // ==========================
  // Sesión / logout hooks
  // ==========================
  async function paintPolygonsForSession(){
    await paintAllPolygonsIfLogged();
  }

  function clearAllPolygonsForLogout(){
    clearAllPolygons();
    clearWeeklyPoint();
    clearRoute();
    if (housesVisible){
      toggleHouses();
    }
    // revisitasLayer la maneja index.slim
  }

  

function handleClickNewRevisita(e){
  // Si tenés modal propio, llamalo aquí. Fallback a prompt:
  const comentario = (document.getElementById("revisita-coment") ? null : prompt("Comentario de revisita (opcional):")) || "";
  const payload = {
    lat: e.latlng.lat,
    lng: e.latlng.lng,
    comentario,
    tipo: "revisita",
    fecha: new Date().toISOString(),
    user: (typeof AuthApp !== "undefined" && AuthApp.getUsername ? (AuthApp.getUsername() || "anon") : "anon")
  };
  if (window.MapApp && typeof window.MapApp.saveRevisitaOfflineFirst === "function"){
    window.MapApp.saveRevisitaOfflineFirst(payload);
  }
  // pintar pin local si usás revisitasLayer
  try {
    if (revisitasLayer) L.marker([payload.lat, payload.lng]).addTo(revisitasLayer);
  } catch(_){}
}

function enableRevisitasMode(on){
  revisitasMode = !!on;
  if (!map) return;
  map.off("click", handleClickNewRevisita);
  if (revisitasMode){
    map.on("click", handleClickNewRevisita);
    window.showToast?.("Tocá el mapa para crear una revisita");
  } else {
    window.showToast?.("Revisitas desactivado");
  }
}

// Wiring del botón Revisitas
(function wireRevisitas(){
  const btnRev = document.getElementById("btn-revisitas");
  if (!btnRev) return;
  btnRev.addEventListener("click", () => {
    const active = btnRev.getAttribute("data-active") === "on";
    const next = !active;
    btnRev.setAttribute("data-active", next ? "on" : "off");
    enableRevisitasMode(next);
    if (next && revisitasLayer && !map.hasLayer(revisitasLayer)) revisitasLayer.addTo(map);
    if (!next && revisitasLayer && map.hasLayer(revisitasLayer)) revisitasLayer.remove();
  });
})();


  // ==========================
  // init()
  // ==========================
  async function init(){
    map = L.map("map").setView(
      [-34.7773604512622, -55.855506081213164],
      16
    );

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);

    territoriosLayer = L.layerGroup().addTo(map);
    housesLayer      = L.layerGroup();
    weeklyLayer      = L.layerGroup();
    revisitasLayer   = L.layerGroup();

    // No visitar layer y UI
    noVisitarLayer = L.layerGroup();

    // Inyectar estilos extra y ajustar FAB de ruta
    injectExtraStyles();
    fixRouteButtonAsFab();

    // Asegurar botón en barra y FAB de sugerencia
    ensureNovisitarToggleButton();
    createNovisitarFab();
    updateNovisitarFab();

    // En cada arranque, intentar enviar sugerencias pendientes
    flushNovistarSuggestions && flushNovistarSuggestions();

    // Ajustar visibilidad inicial del botón "Números" según territoriosVisible
    const btnLabelsInit = document.getElementById("btnToggleLabels");
    if (btnLabelsInit){
      if (territoriosVisible){
        btnLabelsInit.style.display = "";
      } else {
        btnLabelsInit.style.display = "none";
      }
    }


    await loadWeeklyPoints();
    await loadHousesPoints();
    await loadPolygonsJSON();

    (function wireNoVisitarUI(){
  const btnToggle = document.getElementById("btn-novistar-toggle");
  if (btnToggle){
    btnToggle.addEventListener("click", () => {
      const on = toggleNoVisitar();
      btnToggle.setAttribute("data-active", on ? "on" : "off");
      updateNovisitarFab(); // refrescar visibilidad de la FAB
    });
  }

  const btnSug = document.getElementById("btn-novistar-sugerir");
  if (btnSug){
    btnSug.addEventListener("click", () => {
      const role = (typeof AuthApp !== "undefined" && AuthApp.getRole ? AuthApp.getRole() : "");
      if (role === "publicador"){
        // Mostrar FAB si el toggle está activo; si no, activarlo y pedir punto
        if (!noVisitarVisible) {
          toggleNoVisitar();
          btnToggle && btnToggle.setAttribute("data-active", "on");
        }
        updateNovisitarFab();
        enableNovistarPick(); // pedir marcar en el mapa
      } else {
        window.showToast?.("Solo los publicadores pueden sugerir.");
      }
    });
  }

  // FAB flotante
  const fab = document.getElementById("fab-novistar-sugerir");
  if (fab){
    fab.addEventListener("click", () => {
      const role = (typeof AuthApp !== "undefined" && AuthApp.getRole ? AuthApp.getRole() : "");
      if (role === "publicador"){
        enableNovistarPick();
      } else {
        window.showToast?.("Solo los publicadores pueden sugerir.");
      }
    });
  }
})();

  }

  // ==========================
  // API pública
  // ==========================
  function getMap(){ return map; }
  function getRevisitasLayer(){ return revisitasLayer; }

  function setUserRole(r){
    userRole = r || "";
    // Si es publicador, sacamos polígonos inmediatamente
    if (userRole === "publicador"){
      clearAllPolygons();
      territoriosLayer.remove();
      territoriosVisible = false;
    }
  }

  window.MapApp = {
  renderRevisitasMarkers: renderRevisitasMarkers,
    init,
    ready: Promise.resolve(),

    // Territorios
    paintPolygonsForSession,
    clearAllPolygonsForLogout,

    toggleTerritoriosLayer,
    isTerritoriosVisible,
    toggleLabels,

    // Casas
    toggleHouses,

    // Predicación semanal
    getWeeklyPoints,
    showWeeklyLayerWithRoutingOnClick,
    showSingleWeeklyPoint,
    clearWeeklyPoint,
    setWeeklyRoutingEnabled,

    // Geoloc / ruta
    startGeo,
    stopGeo,
    isGeoActive,
    ensureRouteWithGeo,
    clearRoute,
    redrawRouteIfPossible,

    // Revisitas
    getMap,
    getRevisitasLayer,
    loadRevisitasCsv,
    showRevisitas,
    get revisitasData(){ return revisitasData; },

    // Rol
    setUserRole
  ,

    // No visitar
    toggleNoVisitar,
    renderNoVisitar};
})();
