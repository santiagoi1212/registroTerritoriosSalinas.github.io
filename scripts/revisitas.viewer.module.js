// scripts/revisitas.viewer.module.js
// Usa window.SheetCSVViewerConfig.{ DATA_SOURCE_TYPE, DATA_URL, MAP } para cargar puntos
(function(global){
  const MOD = {};
  const $ = (s)=>document.querySelector(s);

  function resolveMap(){
    try{
      if (global.MapApp && typeof global.MapApp.getMap === "function") return global.MapApp.getMap();
      if (global.map) return global.map;
    }catch(e){}
    return null;
  }

  let map, revisitasLayer, estudiosLayer;

  function icon(type){
    const html = `<div style="
      background:${type==='Estudio'?'var(--success)':'var(--primary)'};
      color:${type==='Estudio'?'#052e12':'#0b1220'};
      border-radius:12px; padding:4px 8px; border:1px solid var(--border);
      box-shadow:var(--shadow); font-weight:700; font-size:12px;">
      ${type==='Estudio'?'EST':'REV'}
    </div>`;
    return L.divIcon({ className:"", html, iconSize:[36,20], iconAnchor:[18,10] });
  }

  function addPoint(o){
    const lat = parseFloat(o.lat), lng = parseFloat(o.lng);
    if (!isFinite(lat) || !isFinite(lng)) return;
    const t = (o.tipo||"").trim();
    const lyr = (t === "Estudio") ? estudiosLayer : revisitasLayer;
    const marker = L.marker([lat,lng], { icon: icon(t||"Revisita") });
    const tel = o.telefono ? `<br><small>Tel: ${o.telefono}</small>` : "";
    const dir = o.direccion ? `<br><small>Dir: ${o.direccion}</small>` : "";
    const fecha = o.fecha ? `<br><small>Fecha: ${o.fecha}</small>` : "";
    marker.bindPopup(`<strong>${o.nombre||"(sin nombre)"}</strong>${tel}${dir}${fecha}${o.notas?("<br>"+o.notas):""}`);
    marker.addTo(lyr);
  }

  function fitAll(){
    const g = L.featureGroup([revisitasLayer, estudiosLayer]);
    try{
      const b = g.getBounds();
      if (b.isValid()) map.fitBounds(b.pad(0.15));
    }catch{}
  }

  async function fetchCSV(url, mapCfg){
    const text = await fetch(url, {cache:"no-store"}).then(r=>r.text());
    const lines = text.trim().split(/\r?\n/);
    const headers = lines.shift().split(",").map(h=>h.trim());
    const idx = Object.fromEntries(headers.map((h,i)=>[h,i]));
    const out = [];
    const m = mapCfg;
    for (const line of lines){
      const cells = line.split(",");
      const obj = {
        tipo: cells[idx[m.tipo]]?.trim(),
        nombre: cells[idx[m.nombre]]?.trim(),
        telefono: cells[idx[m.telefono]]?.trim(),
        direccion: cells[idx[m.direccion]]?.trim(),
        notas: cells[idx[m.notas]]?.trim(),
        lat: cells[idx[m.lat]]?.trim(),
        lng: cells[idx[m.lng]]?.trim(),
        fecha: cells[idx[m.fecha]]?.trim(),
      };
      out.push(obj);
    }
    return out;
  }

  async function fetchJSON(url){
    return fetch(url, {cache:"no-store"}).then(r=>r.json());
  }

  async function loadPoints(){
    const cfg = global.SheetCSVViewerConfig || {};
    if (!cfg.DATA_SOURCE_TYPE || !cfg.DATA_URL){
      console.warn("[Viewer] Falta SheetCSVViewerConfig.DATA_*");
      revisitasLayer?.clearLayers(); estudiosLayer?.clearLayers();
      return;
    }
    revisitasLayer.clearLayers();
    estudiosLayer.clearLayers();
    let rows = [];
    if (cfg.DATA_SOURCE_TYPE === "csv"){
      rows = await fetchCSV(cfg.DATA_URL, cfg.MAP || {tipo:"Tipo", nombre:"Nombre", telefono:"Telefono", direccion:"Direccion", notas:"Notas", lat:"Lat", lng:"Lng", fecha:"Fecha"});
    }else{
      rows = await fetchJSON(cfg.DATA_URL);
    }
    const showRev = $("#chkRevisitas")?.checked ?? true;
    const showEst = $("#chkEstudios")?.checked ?? true;
    for (const r of rows){
      const t = (r.tipo||"").trim();
      if (t === "Estudio" && !showEst) continue;
      if (t !== "Estudio" && !showRev) continue;
      addPoint(r);
    }
  }

  function bindUI(){
    $("#chkRevisitas")?.addEventListener("change", loadPoints);
    $("#chkEstudios")?.addEventListener("change", loadPoints);
    $("#btnReload")?.addEventListener("click", loadPoints);
    $("#btnFit")?.addEventListener("click", fitAll);
  }

  function init(){
    map = resolveMap();
    if (!map){
      console.warn("[Viewer] No se encontró mapa global. Se inicializará al wireup.");
      return;
    }
    revisitasLayer = L.layerGroup().addTo(map);
    estudiosLayer  = L.layerGroup().addTo(map);
    bindUI();
    loadPoints().then(()=> setTimeout(fitAll, 300));
  }

  MOD.init   = init;
  MOD.reload = loadPoints;
  MOD.fit    = fitAll;

  global.Revisitas = global.Revisitas || {};
  global.Revisitas.Viewer = MOD;
})(window);
