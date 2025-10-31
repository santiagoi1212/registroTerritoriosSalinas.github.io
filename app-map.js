(function () {
  'use strict';

  // ==========================
  // Estado interno
  // ==========================
  let map;
  let territoriosLayer;
  let routeControl = null;

  let geoWatchId   = null;
  let geoMarker    = null;

  let labelsVisible = true;
  let weeklyRoutingEnabled = false;

  // marcador actual de predicación semanal elegido
  let weeklyMarker = null;

  // cache de polígonos de territorio
  let poligonosData = [];

  // Datos mock de predicación semanal (reemplazá con lo que venga de tu Apps Script)
  // label = lo que se muestra al usuario
  // lat,lng = punto al que queremos ir
  const WEEKLY_POINTS = [
    {
      label: "Lunes 09:30 - Flia. Fernandez",
      lat: -34.7705,
      lng: -55.8259
    },
    {
      label: "Martes 18:00 - Flia. Rodríguez",
      lat: -34.7721,
      lng: -55.8280
    },
    {
      label: "Jueves 16:00 - Flia. García",
      lat: -34.7694,
      lng: -55.8272
    }
  ];

  // ==========================
  // Helpers DOM
  // ==========================
  function $(id){ return document.getElementById(id); }

  // ==========================
  // Fechas / Colores (mismo que antes)
  // ==========================
  function parseFechaSeguro(raw){
    if (!raw) return null;
    const s = String(raw).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const d = new Date(s+"T00:00:00");
      return isNaN(d) ? null : d;
    }
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)){
      const [dd,mm,yyyy] = s.split('/');
      const d = new Date(+yyyy, +mm-1, +dd);
      return isNaN(d) ? null : d;
    }
    const d2 = new Date(s);
    return isNaN(d2) ? null : d2;
  }

  function normalizarFinalizado(val){
    const s = String(val || '').trim().toLowerCase();
    if (s === 'si' || s === 'sí' || s === 'true' || s === '1' || s.startsWith('s')) return 'Si';
    return 'No';
  }

  function mesesDiferencia(a,b){
    const ms = Math.abs(b - a);
    const meses = ms / (1000*60*60*24*30.4375);
    return meses;
  }

  function colorKeyPorFechaEstado(fecha, finalizado){
    const fin = normalizarFinalizado(finalizado);
    const f = parseFechaSeguro(fecha);
    if (!f) return "grey";

    const diffMeses = mesesDiferencia(f, new Date());

    if (fin === 'Si'){
      if (diffMeses < 2) return 'green';
      if (diffMeses <= 3) return 'yellow';
      return 'red';
    } else {
      return 'blue';
    }
  }

  function styleFromColorKey(key){
    switch(key){
      case 'blue':
        return {color:'#1e3a8a', weight:1.2, fillColor:'#93c5fd', fillOpacity:0.5};
      case 'green':
        return {color:'#065f46', weight:1.2, fillColor:'#86efac', fillOpacity:0.5};
      case 'yellow':
        return {color:'#78350f', weight:1.2, fillColor:'#fde68a', fillOpacity:0.5};
      case 'red':
        return {color:'#7f1d1d', weight:1.2, fillColor:'#fca5a5', fillOpacity:0.5};
      default:
        return {color:'#374151', weight:1.2, fillColor:'#e5e7eb', fillOpacity:0.5};
    }
  }

  // ==========================
  // Sheets merge
  // ==========================
  async function cargarDatosDesdeSheets() {
    const SHEETS_URL = (window.APP && window.APP.SHEETS_URL)
      || 'https://docs.google.com/spreadsheets/d/e/2PACX-1vS-TxyDU1xvaMwDjc5GQxjglSfBUYTUyu2_NDcAsJ_v0ngaD8g_-WcmxsUd9921RF2q5I4bcscjsf6N/pub?gid=1159469350&single=true&output=csv';

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
        if (ch === '"'){ inQ=!inQ; continue; }
        if (ch === ',' && !inQ){ out.push(cur); cur=""; }
        else { cur+=ch; }
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

      if (!rawId.trim()) continue;

      data.push({
        id: rawId.trim(),
        fecha: rawFecha.trim(),
        finalizado: rawFin.trim()
      });
    }

    const mapUltimo = new Map();
    data.forEach(row=>{
      mapUltimo.set(String(row.id).trim(), row);
    });

    return Array.from(mapUltimo.values());
  }

  // ==========================
  // Registrar territorio (modal)
  // ==========================
  function fmtDateInput(d){
    const dt = d instanceof Date && !isNaN(d) ? d : new Date();
    const y = dt.getFullYear();
    const m = String(dt.getMonth()+1).padStart(2,'0');
    const dd= String(dt.getDate()).padStart(2,'0');
    return `${y}-${m}-${dd}`;
  }

  function buildRegistroFormHTML(poly){
    return `
      <div class="form-field">
        <label class="form-label">Número de Territorio</label>
        <input class="form-input" id="reg-territorio" value="${poly.territorio || ''}" readonly />
      </div>

      <div class="form-field">
        <label class="form-label">Número de Manzana</label>
        <input class="form-input" id="reg-manzana" value="${poly.id || ''}" readonly />
      </div>

      <div class="form-field">
        <label class="form-label">Capitán</label>
        <select class="form-select" id="reg-capitan">
          <option value="">Seleccionar...</option>
          <option value="Juan Pérez">Juan Pérez</option>
          <option value="María Gómez">María Gómez</option>
          <option value="Carlos Ruiz">Carlos Ruiz</option>
        </select>
      </div>

      <div class="form-field">
        <label class="form-label">Fecha</label>
        <input class="form-input" id="reg-fecha" type="date" value="${fmtDateInput(new Date())}" />
      </div>

      <div class="form-field">
        <label class="form-label">Finalizado</label>
        <select class="form-select" id="reg-finalizado">
          <option value="No">No</option>
          <option value="Si">Sí</option>
        </select>
      </div>

      <div class="form-actions">
        <button class="btn-cancel" type="button" id="reg-cancel">Cancelar</button>
        <button class="btn-primary" type="button" id="reg-send">Enviar</button>
      </div>
    `;
  }

  function openRegistroModal(poly){
    const overlay = $('territorio-overlay');
    const body    = $('territorio-body');
    if (!overlay || !body) return;

    if (!window.AuthApp || !window.AuthApp.isLogged()){
      window.showToast?.('Tenés que iniciar sesión para registrar este territorio');
      return;
    }

    body.innerHTML = buildRegistroFormHTML(poly);
    overlay.style.display = 'flex';

    body.querySelector('#reg-cancel').addEventListener('click', ()=>{
      overlay.style.display = 'none';
    });

    body.querySelector('#reg-send').addEventListener('click', async ()=>{
      window.showToast?.('Enviado ✅');
      overlay.style.display = 'none';
    });
  }

  // ==========================
  // Pintar polígonos
  // ==========================
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

  function attachPolygonClick(poly, layer){
    layer.on('click', ()=>{
      openRegistroModal(poly);
    });
  }

  function drawSinglePolygon(poly){
    const style = styleFromColorKey(poly.colorKey);
    const layer = L.polygon(poly.coords, style).addTo(territoriosLayer);
    poly.layer = layer;

    applyTooltip(layer, poly.id || '');
    attachPolygonClick(poly, layer);
  }

  async function paintAllPolygonsIfLogged(){
    if (!window.AuthApp || !window.AuthApp.isLogged()) return;

    const registros = await cargarDatosDesdeSheets();
    const byId = new Map();
    registros.forEach(r=>{
      byId.set(String(r.id).trim(), r);
    });

    poligonosData.forEach(p=>{
      const found = byId.get(String(p.id).trim());
      if (found){
        p.fecha = found.fecha;
        p.finalizado = found.finalizado;
      }
      p.colorKey = colorKeyPorFechaEstado(p.fecha, p.finalizado);
    });

    territoriosLayer.clearLayers();
    poligonosData.forEach(p=>{
      drawSinglePolygon(p);
    });
  }

  function clearAllPolygons(){
    if (territoriosLayer){
      territoriosLayer.clearLayers();
    }
    poligonosData.forEach(p=>{
      p.layer = null;
    });
  }

  // ==========================
  // Toggle Números
  // ==========================
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

    const btn = $('btnToggleLabels');
    if (btn){
      btn.textContent = labelsVisible ? 'Ocultar Números' : 'Mostrar Números';
    }
  }

  // ==========================
  // Predicación semanal con puntos
  // ==========================

  function getWeeklyPoints(){
    // en el futuro podés filtrar por día, traer del servidor, etc.
    // ahora devolvemos toda la lista
    return WEEKLY_POINTS.slice();
  }

  // borra marcador y ruta actuales
  function clearWeeklyPoint(){
    if (weeklyMarker){
      map.removeLayer(weeklyMarker);
      weeklyMarker = null;
    }
  }

  function clearRoute(){
    if (routeControl){
      map.removeControl(routeControl);
      routeControl = null;
    }
  }

  // Dado un índice de WEEKLY_POINTS:
  // - centra el mapa en ese punto
  // - coloca marcador bonito
  // - si weeklyRoutingEnabled y tenemos geoMarker => dibuja ruta
  async function selectWeeklyPoint(idx){
    const p = WEEKLY_POINTS[idx];
    if (!p) return;

    // aseguramos geoloc si routing está habilitado
    if (weeklyRoutingEnabled){
      await startGeo();
    }

    // limpiar marcador viejo
    clearWeeklyPoint();
    clearRoute();

    // crear marcador destino
    weeklyMarker = L.marker([p.lat, p.lng], {
      title: p.label
    }).addTo(map);

    map.setView([p.lat, p.lng], 17, { animate:true });

    // trazar ruta si corresponde
    if (weeklyRoutingEnabled && geoMarker){
      const from = geoMarker.getLatLng();
      const to   = L.latLng(p.lat, p.lng);
      drawRoute(from, to);
    }
  }

  function setWeeklyRoutingEnabled(flag){
    weeklyRoutingEnabled = !!flag;
    if (!weeklyRoutingEnabled){
      clearWeeklyPoint();
      clearRoute();
    }
  }

  function drawRoute(fromLatLng, toLatLng){
    clearRoute();
    routeControl = L.Routing.control({
      waypoints: [
        L.latLng(fromLatLng.lat, fromLatLng.lng),
        L.latLng(toLatLng.lat,   toLatLng.lng)
      ],
      lineOptions: {
        addWaypoints: false,
        weight: 5,
        opacity: 0.8
      },
      draggableWaypoints: false,
      fitSelectedRoutes: true,
      show: false
    }).addTo(map);

    const container = routeControl.getContainer();
    container.classList.add('route-panel-minimal');
  }

  // ==========================
  // Geolocalización
  // ==========================
  function isGeoActive(){
    return geoWatchId !== null;
  }

  function stopGeo(){
    if (geoWatchId !== null){
      navigator.geolocation.clearWatch(geoWatchId);
      geoWatchId = null;
    }
    if (geoMarker){
      map.removeLayer(geoMarker);
      geoMarker = null;
    }
    document.dispatchEvent(new CustomEvent('geo:state',{detail:{active:false}}));
  }

  async function startGeo(){
    if (geoWatchId !== null){
      return true;
    }
    if (!navigator.geolocation){
      window.showToast?.('Geolocalización no disponible');
      return false;
    }

    return new Promise((resolve)=>{
      geoWatchId = navigator.geolocation.watchPosition(
        (pos)=>{
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;

          if (!geoMarker){
            geoMarker = L.marker([lat,lng], { draggable:false })
              .addTo(map);
          } else {
            geoMarker.setLatLng([lat,lng]);
          }

          // centrar primera vez
          map.setView([lat,lng], Math.max(map.getZoom(),16), {animate:true});

          document.dispatchEvent(new CustomEvent('geo:state',{detail:{active:true}}));
          resolve(true);
        },
        (err)=>{
          console.error('geo error', err);
          window.showToast?.('No se pudo obtener ubicación precisa');
          stopGeo();
          resolve(false);
        },
        {
          enableHighAccuracy: true,
          maximumAge: 1000,
          timeout: 10000
        }
      );
    });
  }

  // ==========================
  // Carga inicial de polígonos
  // ==========================
  async function loadPolygonsJSON(){
    const url = (window.APP && window.APP.POLIGONOS_JSON_URL) || './poligonos_salinas.json';
    const res = await fetch(url, {cache:'no-store'});
    const arr = await res.json();

    poligonosData = arr.map(p => ({
      id: p.id,
      territorio: p.territorio,
      coords: p.coords,
      fecha: null,
      finalizado: null,
      colorKey: 'grey',
      layer: null
    }));
  }

  // ==========================
  // init() y hooks con AuthApp
  // ==========================
  async function init(){
    map = L.map('map').setView([-34.7773604512622, -55.855506081213164], 16);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(map);

    territoriosLayer = L.layerGroup().addTo(map);

    await loadPolygonsJSON();

    // si ya estás logueado cuando arranca
    if (window.AuthApp && window.AuthApp.isLogged()){
      await paintAllPolygonsIfLogged();
    }
  }

  async function paintPolygonsForSession(){
    await paintAllPolygonsIfLogged();
  }

  function clearAllPolygonsForLogout(){
    clearAllPolygons();
    clearWeeklyPoint();
    clearRoute();
  }

  // ==========================
  // Exponer API pública
  // ==========================
  window.MapApp = {
    init,
    ready: Promise.resolve(),
    toggleLabels,
    // predicación semanal:
    getWeeklyPoints,
    selectWeeklyPoint,
    clearWeeklyPoint,
    setWeeklyRoutingEnabled,
    clearRoute,
    // geo
    startGeo,
    stopGeo,
    isGeoActive,
    // territorios
    paintPolygonsForSession,
    clearAllPolygonsForLogout
  };

})();
