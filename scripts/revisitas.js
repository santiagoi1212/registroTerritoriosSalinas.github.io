// scripts/revisitas.js
// Integra: cargar revisitas al mapa y alta de revisita/estudio con pick en el mapa.
// No agrega estilos. Usa los IDs del snippet o cambia los selectores aquí.
(function(w){
  const SEL = {
    btnRevisitas:     "#btnRevisitas",
    btnAgregar:       "#btnAgregarRevisita",
    formSection:      "#revisitasFormSection",
    form:             "#revisitasForm",
    tipo:             "#rv_tipo",
    nombre:           "#rv_nombre",
    telefono:         "#rv_telefono",
    direccion:        "#rv_direccion",
    notas:            "#rv_notas",
    lat:              "#rv_lat",
    lng:              "#rv_lng",
    pickOnMap:        "#revisitasPickOnMap",
    useMyPos:         "#revisitasUseMyPos",
    cancelForm:       "#revisitasCancel"
  };

  const cfg = w.RevisitasConfig || {};
  const CSV_URL = cfg.CSV_URL;
  const GAS_SAVE_URL = cfg.GAS_SAVE_URL;
  const MAP = cfg.MAP || {tipo:"Tipo", nombre:"Nombre", telefono:"Telefono", direccion:"Direccion", notas:"Notas", lat:"Lat", lng:"Lng", fecha:"Fecha"};

  function $(s){ return document.querySelector(s); }
  function $$(s){ return Array.from(document.querySelectorAll(s)); }

  function resolveMap(){
    try{
      if (w.MapApp && typeof w.MapApp.getMap === "function") return w.MapApp.getMap();
      if (w.map) return w.map;
    }catch(e){}
    console.warn("[Revisitas] No se halló mapa global, creando fallback (Leaflet).");
    const fallback = L.map("map").setView([-34.77118, -55.826602], 14);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(fallback);
    return fallback;
  }
  const map = resolveMap();
  const revisitasLayer = L.layerGroup().addTo(map);
  const estudiosLayer  = L.layerGroup().addTo(map);

  function popupHtml(o){
    const tel = o.telefono ? `<br><small>Tel: ${o.telefono}</small>` : "";
    const dir = o.direccion ? `<br><small>Dir: ${o.direccion}</small>` : "";
    const fecha = o.fecha ? `<br><small>Fecha: ${o.fecha}</small>` : "";
    const notas = o.notas ? `<br>${o.notas}` : "";
    return `<strong>${o.nombre||"(sin nombre)"}</strong>${tel}${dir}${fecha}${notas}`;
  }

  function markerIcon(type){
    // Minimal, sin estilos extra: hereda del tema global del mapa
    const html = `<div class="rv-badge ${type==='Estudio'?'est':'rev'}">${type==='Estudio'?'EST':'REV'}</div>`;
    return L.divIcon({ className: "rv-badge-wrap", html, iconSize:[36,20], iconAnchor:[18,10] });
  }

  function addRowAsMarker(o){
    const lat = parseFloat(o.lat), lng = parseFloat(o.lng);
    if (!isFinite(lat) || !isFinite(lng)) return;
    const t = (o.tipo||"").trim();
    const lyr = (t === "Estudio") ? estudiosLayer : revisitasLayer;
    const m = L.marker([lat,lng], { icon: markerIcon(t||"Revisita") })
      .bindPopup(popupHtml(o));
    m.addTo(lyr);
  }

  // CSV parser simple con comillas
  function parseCSV(text){
    const rows = [];
    let i=0, cur='', inQ=false, row=[];
    while(i<text.length){
      const ch = text[i];
      if (inQ){
        if (ch === '"'){
          if (text[i+1] === '"'){ cur+='"'; i+=2; continue; }
          inQ=false; i++; continue;
        } else { cur+=ch; i++; continue; }
      } else {
        if (ch === '"'){ inQ=true; i++; continue; }
        if (ch === ','){ row.push(cur); cur=''; i++; continue; }
        if (ch === '\n' || ch === '\r'){
          if (cur.length>0 || row.length>0){ row.push(cur); rows.push(row); row=[]; cur=''; }
          // manejar \r\n
          if (ch === '\r' && text[i+1] === '\n') i+=2; else i++;
          continue;
        }
        cur+=ch; i++;
      }
    }
    if (cur.length>0 || row.length>0){ row.push(cur); rows.push(row); }
    return rows;
  }

  async function fetchRowsFromCSV(url){
    const txt = await fetch(url, {cache:"no-store"}).then(r=>r.text());
    const rows = parseCSV(txt);
    const headers = rows.shift().map(x=>x.trim());
    const idx = Object.fromEntries(headers.map((h,i)=>[h,i]));
    const out = [];
    for (const r of rows){
      out.push({
        tipo: r[idx[MAP.tipo]]?.trim(),
        nombre: r[idx[MAP.nombre]]?.trim(),
        telefono: r[idx[MAP.telefono]]?.trim(),
        direccion: r[idx[MAP.direccion]]?.trim(),
        notas: r[idx[MAP.notas]]?.trim(),
        lat: r[idx[MAP.lat]]?.trim(),
        lng: r[idx[MAP.lng]]?.trim(),
        fecha: r[idx[MAP.fecha]]?.trim(),
      });
    }
    return out;
  }

  async function loadRevisitas(){
    if (!CSV_URL){ console.warn("[Revisitas] Falta CSV_URL"); return; }
    revisitasLayer.clearLayers();
    estudiosLayer.clearLayers();
    const rows = await fetchRowsFromCSV(CSV_URL);
    rows.forEach(addRowAsMarker);
    const group = L.featureGroup([revisitasLayer, estudiosLayer]);
    try{
      const b = group.getBounds();
      if (b.isValid()) map.fitBounds(b.pad(0.15));
    }catch{}
  }

  // --- Alta revisita/estudio con pick en mapa ---
  let pickMode=false, pickMarker=null;
  function enablePickMode(){
    pickMode=true;
    map.getContainer().classList.add("crosshair");
  }
  function disablePickMode(){
    pickMode=false;
    map.getContainer().classList.remove("crosshair");
  }
  map.on("click", (ev)=>{
    if(!pickMode) return;
    const {lat,lng} = ev.latlng;
    if (pickMarker) pickMarker.remove();
    pickMarker = L.marker([lat,lng]).addTo(map);
    $(SEL.lat).value = lat.toFixed(6);
    $(SEL.lng).value = lng.toFixed(6);
    disablePickMode();
  });

  async function useMyPos(){
    try{
      const pos = await new Promise((res,rej)=>navigator.geolocation.getCurrentPosition(res,rej,{enableHighAccuracy:true, timeout:10000}));
      const {latitude, longitude} = pos.coords;
      if (pickMarker) pickMarker.remove();
      pickMarker = L.marker([latitude,longitude]).addTo(map);
      $(SEL.lat).value = latitude.toFixed(6);
      $(SEL.lng).value = longitude.toFixed(6);
      map.setView([latitude,longitude], Math.max(map.getZoom()||14, 16));
    }catch(e){
      console.warn(e);
      alert("No se pudo obtener tu posición");
    }
  }

  function resetForm(){
    const f = $(SEL.form);
    if (f) f.reset();
    if (pickMarker) { pickMarker.remove(); pickMarker=null; }
  }

  async function submitForm(ev){
    ev.preventDefault();
    if (!GAS_SAVE_URL){ alert("Falta GAS_SAVE_URL"); return; }
    const payload = {
      tipo: $(SEL.tipo).value,
      nombre: $(SEL.nombre).value.trim(),
      telefono: $(SEL.telefono).value.trim(),
      direccion: $(SEL.direccion).value.trim(),
      notas: $(SEL.notas).value.trim(),
      lat: $(SEL.lat).value,
      lng: $(SEL.lng).value
    };
    if (!payload.lat || !payload.lng){ alert("Seleccioná la ubicación en el mapa"); return; }
    try{
      const resp = await fetch(GAS_SAVE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const text = await resp.text();
      let ok = resp.ok;
      try{ const j = JSON.parse(text); ok = ok && (j.ok !== false); }catch{}
      if (ok){
        alert("Guardado ✔");
        resetForm();
        hideForm();
        await loadRevisitas();
      }else{
        console.error(text);
        alert("No se pudo guardar");
      }
    }catch(err){
      console.error(err);
      alert("Error de red al guardar");
    }
  }

  function showForm(){ $(SEL.formSection)?.classList.remove("hidden"); }
  function hideForm(){ $(SEL.formSection)?.classList.add("hidden"); }

  function bindUI(){
    $(SEL.btnRevisitas)?.addEventListener("click", loadRevisitas);
    $(SEL.btnAgregar)?.addEventListener("click", ()=>{ showForm(); enablePickMode(); });

    $(SEL.pickOnMap)?.addEventListener("click", enablePickMode);
    $(SEL.useMyPos)?.addEventListener("click", useMyPos);
    $(SEL.cancelForm)?.addEventListener("click", ()=>{ hideForm(); resetForm(); });

    $(SEL.form)?.addEventListener("submit", submitForm);
  }

  function init(){
    bindUI();
  }

  w.Revisitas = Object.assign(w.Revisitas||{}, { init, loadRevisitas });
  if (document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", init);
  }else{
    init();
  }
})(window);
