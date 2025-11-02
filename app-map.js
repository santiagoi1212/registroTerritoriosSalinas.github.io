(function () {
  'use strict';

  // ==========================
  // Estado interno
  // ==========================
  let map;
let territoriosLayer;
let housesLayer;
let weeklyLayer;        // <--- NUEVA capa visual para predicación semanal (todas las salidas/puntos)
let routeControl = null;

let geoWatchId   = null;
let geoMarker    = null;

let labelsVisible = true;
let housesVisible = false;
let weeklyRoutingEnabled = false;

let weeklyLayerVisible = false; // para trackear si estamos mostrando todos los puntos semanales

// marcador actual de predicación semanal elegido
let weeklyMarker = null;

// último punto semanal elegido (para redibujar ruta)
let lastWeeklyPoint = null;

// cache polígonos
let poligonosData = [];

// cargadas desde JSON externo
let WEEKLY_POINTS = [];
let HOUSES_POINTS = [];



 // ==========================
// Cargar archivos JSON externos
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
    console.error("No se pudo cargar casas de familias:", err);
    HOUSES_POINTS = [];
  }
}

function buildWeeklyMarkerHTML(p) {
  // tipo define el ícono y color
  const tipo = (p.type || "familia").toLowerCase();
  const emoji = (tipo === "grupo") ? "👥" : "🏠";
  const emojiClass = (tipo === "grupo")
    ? "house-marker-emoji grupo"
    : "house-marker-emoji familia";

  // Lo que se ve siempre en el mapa (sin día/hora)
  const visibleName = p.label || "Salida";

  return `
    <div class="house-marker">
      <div class="${emojiClass}">${emoji}</div>
      <div class="house-marker-label">${visibleName}</div>
    </div>
  `;
}

// crea icono leaflet.divIcon acorde al punto p
function makeWeeklyDivIcon(p) {
  return L.divIcon({
    className: "",
    html: buildWeeklyMarkerHTML(p),
    iconSize: [1, 1],
    iconAnchor: [20, 30]
  });
}

// dibuja TODOS los puntos en weeklyLayer
function renderWeeklyPointsOnMap() {
  weeklyLayer.clearLayers();

  WEEKLY_POINTS.forEach((p, idx) => {
    const tipo = (p.type || "familia").toLowerCase();
    const emoji = (tipo === "grupo") ? "👥" : "🏠";
    const emojiClass = (tipo === "grupo")
      ? "house-marker-emoji grupo"
      : "house-marker-emoji familia";

    const visibleName = p.label || "Salida";
    const hoverInfo = `${p.dia || ""} ${p.hora || ""}`.trim();

    const html = `
      <div class="house-marker">
        <div class="${emojiClass}">${emoji}</div>
        <div class="house-marker-label">${visibleName}</div>
      </div>
    `;

    const icon = L.divIcon({
      className: "",
      html: html,
      iconSize: [1, 1],
      iconAnchor: [20, 30]
    });

    const m = L.marker([p.lat, p.lng], {
      icon: icon,
      title: hoverInfo || visibleName,
      interactive: true
    });

    // Popup táctil
    m.bindPopup(`
      <strong>${visibleName}</strong><br/>
      <span>${p.dia || ""} ${p.hora || ""}</span>
    `);

    // Tooltip hover desktop
    if (hoverInfo) {
      m.bindTooltip(
        `<div style="font-size:12px;font-weight:600;color:#fff;background:#111827cc;padding:4px 6px;border-radius:6px;line-height:1.3;box-shadow:0 4px 10px rgba(0,0,0,.6);">
          ${hoverInfo}
        </div>`,
        { permanent: false, direction: "top", offset: [0, -10], opacity: 1 }
      );
    }

    // 👇 NUEVO: click en el punto cuando estamos en modo "todas"
    m.on("click", async () => {
      // guardamos este punto como seleccionado
      weeklyMarker = m;
      lastWeeklyPoint = p;

      // centramos
      map.setView([p.lat, p.lng], 17, { animate: true });

      // si tenemos geo activa, mostrar ruta
      if (weeklyRoutingEnabled && geoMarker){
        const from = geoMarker.getLatLng();
        const to   = L.latLng(p.lat, p.lng);
        drawRoute(from, to);

        // avisar al UI de ruta que está activa
        const btnRoute = document.getElementById('btn-route-toggle');
        const iconRoute = document.getElementById('icon-route');
        if (btnRoute && iconRoute){
          btnRoute.setAttribute("data-active","on");
          iconRoute.textContent = "🛣️";
        }
      }
    });

    m.addTo(weeklyLayer);
  });
}


async function showSingleWeeklyPoint(idx){
  const p = WEEKLY_POINTS[idx];
  if (!p) return;

  // limpiar marcador individual anterior + ruta vieja
  clearWeeklyPoint();
  clearRoute();

 
  // crear un marker individual para esta salida concreta
  const marker = L.marker([p.lat, p.lng], {
    icon: makeWeeklyDivIcon(p),
    title: `${p.dia || ""} ${p.hora || ""}`.trim()
  });

  // guardamos para poder trazar ruta luego
  weeklyMarker = marker;
  lastWeeklyPoint = p;

  marker.bindPopup(`
    <strong>${p.label || "Salida"}</strong><br/>
    <span>${p.dia || ""} ${p.hora || ""}</span>
  `);

  if ((p.dia || p.hora)) {
    marker.bindTooltip(
      `<div style="font-size:12px;font-weight:600;color:#fff;background:#111827cc;padding:4px 6px;border-radius:6px;line-height:1.3;box-shadow:0 4px 10px rgba(0,0,0,.6);">
        ${(p.dia||"")} ${(p.hora||"")}
      </div>`,
      { permanent: false, direction: "top", offset: [0,-10], opacity: 1 }
    );
  }

  marker.addTo(map);

  // centrar mapa ahí
  map.setView([p.lat, p.lng], 17, { animate: true });

  // si estamos en modo predicar + hay geolocalización activa, dibujar ruta
  if (weeklyRoutingEnabled && geoMarker){
    const from = geoMarker.getLatLng();
    const to   = L.latLng(p.lat, p.lng);
    drawRoute(from, to);
  }
}




  // ==========================
  // Helpers DOM
  // ==========================
  function $(id){ return document.getElementById(id); }

  // ==========================
  // Fechas / Colores
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
          <option value="Julio Fernandez">Julio Fernandez</option>
          <option value="Rafael Manente">Rafael Manente</option>
          <option value="German Varela">German Varela</option>
          <option value="Carlos Carminati">Carlos Carminati</option>
          <option value="Julio Galarza">Julio Galarza</option>
          <option value="Gaston Gerschuni">Gaston Gerschuni</option>
          <option value="Carlos Pena">Carlos Pena</option>
          <option value="Luis Lopez">Luis Lopez</option>
          <option value="Fernando Taroco">Fernando Taroco</option>
          <option value="Lucas Aviles">Lucas Aviles</option>
          <option value="Andres Cruz">Andres Cruz</option>
          <option value="Gabriel Correa">Gabriel Correa</option>
          <option value="Mateo Damele">Mateo Damele</option>
          <option value="Martin Kuzman">Martin Kuzman</option>
          <option value="Gonzalo Valle">Gonzalo Valle</option>
          <option value="Rodrigo Gomez">Rodrigo Gomez</option>
          <option value="Santiago Inchausti">Santiago Inchausti</option>
          <option value="Camilo Urdiozola">Camilo Urdiozola</option>
          <option value="Delamar De Souza">Delamar De Souza</option>
          <option value="Javier Martinez">Javier Martinez</option>
          <option value="Juan Carlos Haristoy">Juan Carlos Haristoy</option>
          <option value="Lucas Matias">Lucas Matias</option>
          <option value="Nicolas Gunaris">Nicolas Gunaris</option>
          <option value="Cesar De Brun">Cesar De Brun</option>
          <option value="Leonardo Toloza">Leonardo Toloza</option>
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
      byId.set(String(r.id).trim().split("|")[0], r); // match por primera parte
    });

    poligonosData.forEach(p=>{
      const key = String(p.id).trim().split("|")[0];
      const found = byId.get(key);
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
  // Toggle Números (devuelve true si quedan visibles)
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
    return labelsVisible;
  }

  // ==========================
  // Casas de familias
  // ==========================
function renderHouses(){
  housesLayer.clearLayers();

  HOUSES_POINTS.forEach(h => {
    // Elegís el emoji que quieras mostrar:
    const emoji = h.emoji || "🏠"; 
    // Si querés por familia algo distinto, podés setear h.emoji en el array
    // Ejemplo:
    // { label:"Flia. Pérez", lat:..., lng:..., emoji:"👨‍👩‍👧‍👦" }

    const html = `
      <div class="house-marker">
        <div class="house-marker-emoji">${emoji}</div>
        <div class="house-marker-label">${h.label}</div>
      </div>
    `;


    const icon = L.divIcon({
      className: "",          // sin clase base de Leaflet
      html: html,
      iconSize: [1, 1],       // lo dejamos chico, el contenido define el tamaño real
      iconAnchor: [0, 0]      // esquina superior izquierda "cae" en la coordenada
    });

    const m = L.marker([h.lat, h.lng], {
      icon: icon,
      interactive: true,      // click habilitado
      title: h.label
    });

    m.bindPopup(`<strong>${h.label}</strong>`);
    m.addTo(housesLayer);
  });
}


  function toggleHouses(){
    housesVisible = !housesVisible;
    if (housesVisible){
      // asegurar que estén dibujadas
      renderHouses();
      housesLayer.addTo(map);
    } else {
      housesLayer.remove();
    }
    return housesVisible;
  }

  // ==========================
  // Predicación semanal con puntos
  // ==========================
  function getWeeklyPoints(){
    return WEEKLY_POINTS.slice();
  }

function clearWeeklyPoint(){
  if (weeklyMarker){
    map.removeLayer(weeklyMarker);
    weeklyMarker = null;
  }
  lastWeeklyPoint = null;
}


  function clearRoute(){
    if (routeControl){
      map.removeControl(routeControl);
      routeControl = null;
    }
  }

  async function selectWeeklyPoint(idx){
    const p = WEEKLY_POINTS[idx];
    if (!p) return;

    lastWeeklyPoint = p;

    if (weeklyRoutingEnabled){
      await startGeo();
    }

    clearWeeklyPoint();
    clearRoute();

    weeklyMarker = L.marker([p.lat, p.lng], {
      title: p.label
    }).addTo(map);

    map.setView([p.lat, p.lng], 17, { animate:true });

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

  // ==========================
  // Ruta / indicaciones en español
  // ==========================
  function traducirInstruccion(str){
    if (!str || typeof str !== "string") return str || "";

    let out = str;
    out = out.replace(/Start/g, "Salida");
    out = out.replace(/Destination/g, "Destino");
    out = out.replace(/Turn left/gi, "Girar a la izquierda");
    out = out.replace(/Turn right/gi, "Girar a la derecha");
    out = out.replace(/Bear left/gi, "Mantenerse a la izquierda");
    out = out.replace(/Bear right/gi, "Mantenerse a la derecha");
    out = out.replace(/Slight left/gi, "Leve giro a la izquierda");
    out = out.replace(/Slight right/gi, "Leve giro a la derecha");
    out = out.replace(/Continue straight/gi, "Seguir derecho");
    out = out.replace(/Continue/gi, "Continuar");
    out = out.replace(/Arrive at destination/gi, "Llegar al destino");
    out = out.replace(/Arrive at/gi, "Llegar a");
    out = out.replace(/Drive/gi, "Conducir");
    out = out.replace(/Head/gi, "Ir");
    out = out.replace(/towards/gi, "hacia");

    return out;
  }

  function postProcesarPanelRuta(container){
    const rows = container.querySelectorAll('.leaflet-routing-alt, .leaflet-routing-alt *');
    rows.forEach(el=>{
      if (el.childNodes && el.childNodes.length === 1 && el.childNodes[0].nodeType === 3){
        el.textContent = traducirInstruccion(el.textContent);
      } else if (el.childNodes && el.childNodes.length > 1){
        el.childNodes.forEach(n=>{
          if (n.nodeType === 3){
            n.textContent = traducirInstruccion(n.textContent);
          }
        });
      }
    });
  }

  function drawRoute(fromLatLng, toLatLng){
    clearRoute();

    routeControl = L.Routing.control({
      waypoints: [
        L.latLng(fromLatLng.lat, fromLatLng.lng),
        L.latLng(toLatLng.lat, toLatLng.lng)
      ],
      routeWhileDragging: false,
      show: true,
      collapsible: true,
      language: 'es', // 👈 idioma español
      router: L.Routing.osrmv1({
        language: 'es', // 👈 idioma español
        serviceUrl: 'https://router.project-osrm.org/route/v1' // servicio público OSRM
      }),
      createMarker: function() { return null; } // opcional: no mostrar marcadores grandes
    }).addTo(map);


    const container = routeControl.getContainer();
    container.classList.add('route-panel-minimal');

    postProcesarPanelRuta(container);
    routeControl.on('routesfound', () => {
      postProcesarPanelRuta(container);
    });
  }

  function redrawRouteIfPossible(){
    if (!lastWeeklyPoint) return;
    if (!geoMarker) return;
    const from = geoMarker.getLatLng();
    const to   = L.latLng(lastWeeklyPoint.lat, lastWeeklyPoint.lng);
    drawRoute(from, to);
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

  async function ensureRouteWithGeo() {
  // Queremos tener ruta desde MI posición hasta el punto de predicación actual.

  // Caso 1: ya tengo un punto seleccionado (weeklyMarker/lastWeeklyPoint)
  const target = lastWeeklyPoint;
  if (!target) {
    // No hay destino elegido todavía => no podemos trazar ruta.
    window.showToast?.("Elegí un punto de predicación primero");
    return false;
  }

  // Asegurarnos de tener geolocalización activa
  if (!isGeoActive()) {
    const ok = await startGeo(); // esto ya posiciona geoMarker si funciona
    if (!ok) {
      window.showToast?.("No se pudo activar tu ubicación");
      return false;
    }
  }

  // Ya tengo geoMarker y destino -> trazo ruta
  if (geoMarker) {
    const from = geoMarker.getLatLng();
    const to   = L.latLng(target.lat, target.lng);
    drawRoute(from, to);
    return true;
  }

  window.showToast?.("No se detectó tu ubicación todavía");
  return false;
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
  housesLayer      = L.layerGroup(); // las casas arrancan ocultas
  weeklyLayer      = L.layerGroup(); // las salidas/semanal arrancan ocultas

  // cargar data externa
  await loadWeeklyPoints();
  await loadHousesPoints();

  // cargar polígonos del territorio
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
    if (housesVisible){
      toggleHouses(); // esto las oculta
    }
  }

function showWeeklyLayerWithRoutingOnClick(){
  // limpiar selección individual para que no haya un marcador suelto encima
  clearWeeklyPoint();
  clearRoute();

  renderWeeklyPointsOnMap();

  if (!weeklyLayerVisible){
    weeklyLayer.addTo(map);
    weeklyLayerVisible = true;
  }
}


  // ==========================
  // Exponer API pública
  // ==========================
window.MapApp = {
  init,
  ready: Promise.resolve(),

  // etiquetas en polígonos
  toggleLabels,

  // casas
  toggleHouses,

  // predicación semanal
  getWeeklyPoints,
  selectWeeklyPoint,          // <- esta la podés dejar o reemplazar por showSingleWeeklyPoint si ya no la usás
  clearWeeklyPoint,
  setWeeklyRoutingEnabled,
  clearRoute,
  redrawRouteIfPossible,
  showWeeklyLayerWithRoutingOnClick,
  showSingleWeeklyPoint,      // 👈 agregar ESTA nueva

  // geo
  startGeo,
  stopGeo,
  isGeoActive,
  ensureRouteWithGeo,

  // territorios
  paintPolygonsForSession,
  clearAllPolygonsForLogout
};



})();
