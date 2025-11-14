
// --- Utils del visor CSV (adaptados) ---
function _escapeHtml(s){return String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");}

function _parseCSV(text, delimiter = ","){
  const rows=[]; let row=[], cur="", inQ=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(inQ){
      if(ch=='"'){ if(text[i+1]=='"'){cur+='"'; i++;} else inQ=false; }
      else cur+=ch;
    }else{
      if(ch=='"') inQ=true;
      else if(ch==delimiter){ row.push(cur); cur=""; }
      else if(ch=='\n'){ row.push(cur); rows.push(row); row=[]; cur=""; }
      else if(ch=='\r'){ if(text[i+1]=='\n') i++; row.push(cur); rows.push(row); row=[]; cur=""; }
      else cur+=ch;
    }
  }
  row.push(cur); rows.push(row);
  return rows;
}

function _rowsToObjects(rows){
  if(!rows.length) return {columns:[],rows:[]};
  const header = rows[0].map(x => (x ?? "col").trim());
  const body = rows.slice(1).map(r=>{
    const o={};
    for(let i=0;i<header.length;i++) o[header[i]] = r[i] ?? "";
    return o;
  });
  return {columns:header, rows:body};
}

// --- Normalizadores de coordenadas ---
function _normNum(v, maxAbs){
  let s = String(v ?? "").trim().replace(",",".");
  const m = s.match(/^(-?\d+)\.(\d{3})\.(\d{3})$/); // ej: -34.776.710
  if(m) s = `${m[1]}.${m[2]}${m[3]}`;
  const n = parseFloat(s);
  return Number.isFinite(n) && (!maxAbs || Math.abs(n)<=maxAbs) ? n : 0;
}
function _normLat(v){ return _normNum(v, 90); }
function _normLng(v){ return _normNum(v, 180); }

// --- Mapeo flexible de columnas ---
function _pick(obj, keys, def=""){
  for(const k of keys){
    if (k in obj && String(obj[k]).trim() !== "") return String(obj[k]).trim();
  }
  return def;
}

// --- Capa y pintado ---
const RevisitasCsv = (function(){
  let _layer = null;   // L.layerGroup
  let _data  = [];     // cache último CSV mapeado

  function ensureLayer(map){
    if (_layer) return _layer;
    _layer = L.layerGroup().addTo(map);
    return _layer;
  }

  function clearLayer(){
    if (_layer && _layer.clearLayers) _layer.clearLayers();
  }

  function markerFor(rv){
    // ícono simple con emoji por tipo
    const emoji = rv.tipo === "estudio" ? "📘" : "📄";
    const html = `
      <div class="house-marker">
        <div class="house-marker-emoji">${emoji}</div>
        <div class="house-marker-label">${_escapeHtml(rv.nombre || rv.direccion || "Revisita")}</div>
      </div>`;
    const icon = L.divIcon({className:"", html, iconSize:[1,1], iconAnchor:[0,0]});
    return L.marker([rv.lat, rv.lng], { icon });
  }

  function renderMarkers(map){
    ensureLayer(map);
    clearLayer();
    _data.forEach((rv, idx)=>{
      if (!rv.lat || !rv.lng) return;
      const mk = markerFor(rv);
      mk.on("click", ()=> {
        // aquí podés abrir modal de edición si querés:
        // openEditRevisitaModal(idx);
        const info = `
          <b>${_escapeHtml(rv.nombre || "(sin nombre)")}</b><br/>
          ${_escapeHtml(rv.fecha || "")}<br/>
          ${_escapeHtml(rv.direccion || "")}<br/>
          ${_escapeHtml(rv.tema || "")}
        `;
        mk.bindPopup(info).openPopup();
      });
      _layer.addLayer(mk);
    });
  }

  async function loadFromCsvUrl(csvUrl, usernameFilter){
    const res = await fetch(csvUrl, {cache:"no-store"});
    if (!res.ok) throw new Error("HTTP " + res.status);
    const text = await res.text();
    const delim = (text.split(/\r?\n/)[0]||"").includes(";") ? ";" : ",";
    const rows  = _parseCSV(text, delim);
    const {columns, rows: body} = _rowsToObjects(rows);

    // normalizar a objeto estándar
    const mapped = body.map(x=>{
      const user = _pick(x, ["user","usuario","username","mail","email"], "");
      const id   = _pick(x, ["id","codigo","cod","id_revisita","idrev"], "");
      const nombre = _pick(x, ["nombre","name","persona","familia"], "");
      const fecha  = _pick(x, ["fecha","date","fch"], "");
      const direccion = _pick(x, ["direccion","dirección","address","addr","dir"], "");
      const tema   = _pick(x, ["tema","notas","nota","obs","observaciones","comentarios","comentario"], "");
      const prox   = _pick(x, ["prox","proxima","próxima","next","proximo","próximo","fch_prox"], "1semana");
      const tipo   = (_pick(x, ["tipo","clase","categoria","categoría"], "revisita")||"revisita").toLowerCase();
      const lat    = _normLat(_pick(x, ["lat","latitud","latitude"], "0"));
      const lng    = _normLng(_pick(x, ["lng","long","lon","longitud","longitude"], "0"));
      return { id, user, nombre, fecha, direccion, tema, prox, tipo, lat, lng };
    }).filter(Boolean);

    _data = usernameFilter
      ? mapped.filter(r => !r.user || r.user === usernameFilter) // si la planilla no guarda user, se dejan visibles
      : mapped;

    return _data;
  }

  function show(map){ if (_layer) map.addLayer(_layer); }
  function hide(map){ if (_layer) map.removeLayer(_layer); }

  return { loadFromCsvUrl, renderMarkers, show, hide, clear: clearLayer, get data(){ return _data; } };
})();

window.RevisitasCsv = RevisitasCsv;
