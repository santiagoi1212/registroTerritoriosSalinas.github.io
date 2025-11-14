// scripts/revisitas.ingreso.module.js
// Usa window.IngresoConfig.GAS_SAVE_URL para guardar
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

  let map, pickMode=false, pickMarker=null, toastEl;
  function toast(msg, ms=1600){
    try{
      toastEl = toastEl || $("#toast");
      if (!toastEl) return;
      toastEl.textContent = msg;
      toastEl.classList.remove("hidden");
      setTimeout(()=>toastEl.classList.add("hidden"), ms);
    }catch{}
  }

  function bindUI(){
    $("#btnPickOnMap")?.addEventListener("click", enablePickMode);
    $("#btnUseMyPos")?.addEventListener("click", useMyPos);
    $("#btnReset")?.addEventListener("click", resetForm);
    $("#formAdd")?.addEventListener("submit", onSubmit);
  }

  function enablePickMode(){
    if (!map) return;
    pickMode = true;
    map.getContainer().classList.add("crosshair");
    toast("Hacé click en el mapa para elegir ubicación");
  }

  function disablePickMode(){
    pickMode = false;
    if (map) map.getContainer().classList.remove("crosshair");
  }

  function attachMapHandlers(){
    map.on("click", (ev)=>{
      if(!pickMode) return;
      const {lat, lng} = ev.latlng;
      if (pickMarker) pickMarker.remove();
      pickMarker = L.marker([lat,lng], {title:"Nueva ubicación"}).addTo(map);
      $("#lat").value = lat.toFixed(6);
      $("#lng").value = lng.toFixed(6);
      disablePickMode();
      toast("Ubicación seleccionada");
    });
  }

  async function useMyPos(){
    try{
      const pos = await new Promise((res,rej)=>navigator.geolocation.getCurrentPosition(res,rej,{enableHighAccuracy:true, timeout:10000}));
      const {latitude, longitude} = pos.coords;
      if (pickMarker) pickMarker.remove();
      pickMarker = L.marker([latitude,longitude], {title:"Mi posición"}).addTo(map);
      $("#lat").value = latitude.toFixed(6);
      $("#lng").value = longitude.toFixed(6);
      map && map.setView([latitude,longitude], Math.max(map.getZoom()||14, 16));
      toast("Usando tu posición actual");
    }catch(e){
      console.warn(e);
      toast("No se pudo obtener tu posición");
    }
  }

  function resetForm(){
    $("#formAdd")?.reset();
    if (pickMarker) { pickMarker.remove(); pickMarker=null; }
  }

  async function onSubmit(e){
    e.preventDefault();
    const cfg = global.IngresoConfig || {};
    const url = cfg.GAS_SAVE_URL;
    if (!url){
      toast("Falta IngresoConfig.GAS_SAVE_URL");
      return;
    }
    const payload = {
      tipo: $("#tipo").value,
      nombre: $("#nombre").value.trim(),
      telefono: $("#telefono").value.trim(),
      direccion: $("#direccion").value.trim(),
      notas: $("#notas").value.trim(),
      lat: $("#lat").value, lng: $("#lng").value
    };
    if (!payload.lat || !payload.lng){
      toast("Seleccioná la ubicación en el mapa primero");
      return;
    }
    try{
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const text = await resp.text();
      let ok = resp.ok;
      try{ const j = JSON.parse(text); ok = ok && (j.ok !== false); }catch{}
      if(ok){
        toast("Guardado ✔");
        resetForm();
        global.Revisitas?.Viewer?.reload?.();
      }else{
        console.error("Respuesta:", text);
        toast("No se pudo guardar");
      }
    }catch(err){
      console.error(err);
      toast("Error de red al guardar");
    }
  }

  function init(){
    map = resolveMap();
    if (!map){
      console.warn("[Ingreso] No se encontró mapa global. Se inicializará al wireup.");
      return;
    }
    bindUI();
    attachMapHandlers();
  }

  MOD.init = init;
  MOD._resolveMap = resolveMap;

  global.Revisitas = global.Revisitas || {};
  global.Revisitas.Ingreso = MOD;
})(window);
