// scripts/revisitas.wireup.js
// Inicializa panel y módulos manteniendo el orden y estilo del sitio
(function(global){
  const $ = (s)=>document.querySelector(s);
  const $$ = (s)=>Array.from(document.querySelectorAll(s));

  function resolveMap(){
    try{
      if (global.MapApp && typeof global.MapApp.getMap === "function") return global.MapApp.getMap();
      if (global.map) return global.map;
    }catch(e){}
    // fallback: crea uno si no existe (para pruebas locales)
    const fallback = L.map("map").setView([-34.77118, -55.826602], 14);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(fallback);
    return fallback;
  }

  function tabsInit(){
    $$("#topTabs .tab-btn").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        $$("#topTabs .tab-btn").forEach(b=>b.classList.remove("active"));
        btn.classList.add("active");
        // acá podrías mostrar/ocultar secciones por tab si fuese necesario
      });
    });
  }

  function panelInit(){
    const panel = $("#panel");
    $("#btnTogglePanel")?.addEventListener("click", ()=>panel.classList.toggle("hidden"));
    $("#closePanel")?.addEventListener("click", ()=>panel.classList.add("hidden"));
  }

  function init(){
    resolveMap(); // asegura un mapa
    panelInit();
    tabsInit();
    // Inicializar módulos
    try{ global.Revisitas?.Ingreso?.init?.(); }catch(e){ console.warn("Ingreso.init error", e); }
    try{ global.Revisitas?.Viewer?.init?.(); }catch(e){ console.warn("Viewer.init error", e); }
  }

  if (document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", init);
  }else{
    init();
  }
})(window);
