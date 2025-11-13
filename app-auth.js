(function(){
  "use strict";

  let _state = {
    logged: false,
    username: null,
    role: null // "admin" | "capitan" | "publicador" | etc.
  };

  function applyRoleUI(){
    const btnTerritorios = document.getElementById('btn-territorios-toggle');
    const btnLabels      = document.getElementById('btnToggleLabels');
    const btnInfo        = document.getElementById('btn-info-toggle');
    const btnRevisitas   = document.getElementById('btn-revisitas');
    const btnNoVisitarSugerir = document.getElementById('btn-novistar-sugerir');


    if (!_state.logged){
       if (btnNoVisitarSugerir) btnNoVisitarSugerir.classList.add("auth-hidden");
      if (btnTerritorios) btnTerritorios.style.display = "none";
      if (btnLabels)      btnLabels.style.display      = "none";
      if (btnInfo)        btnInfo.style.display        = "none";
      if (btnRevisitas)   btnRevisitas.style.display   = "none";
      return;
    }

    // está logueado:
    if (btnRevisitas) btnRevisitas.style.display = "flex";

    if (_state.role === "publicador"){
      // publicador NO ve territorios / números / info
      if (btnNoVisitarSugerir) btnNoVisitarSugerir.classList.remove("auth-hidden");
      if (btnTerritorios) btnTerritorios.style.display = "none";
      if (btnLabels)      btnLabels.style.display      = "none";
      if (btnInfo)        btnInfo.style.display        = "none";

      if (window.MapApp){
        window.MapApp.setUserRole("publicador");
        window.MapApp.clearAllPolygonsForLogout(); // no polígonos
      }
    } else {
      // capitan / admin / lo que tengas
      if (btnTerritorios) btnTerritorios.style.display = "flex";
      if (btnLabels)      btnLabels.style.display      = "flex";
      if (btnInfo)        btnInfo.style.display        = "flex";
      if (btnNoVisitarSugerir) btnNoVisitarSugerir.classList.add("auth-hidden");

      if (window.MapApp){
        window.MapApp.setUserRole(_state.role || "");
        window.MapApp.paintPolygonsForSession();
      }
    }
  }

  function applyAuthHeaderUI(){
    const lblUser    = document.getElementById('auth-info');
    const btnAuth    = document.getElementById('btnAuthOpen');
    const btnLogout  = document.getElementById('btnLogout');

    if (_state.logged){
      if (lblUser){
        lblUser.classList.remove("auth-hidden");
        lblUser.textContent = _state.username + " (" + _state.role + ")";
      }
      if (btnLogout){
        btnLogout.classList.remove("auth-hidden");
      }
      if (btnAuth){
        btnAuth.classList.add("auth-hidden");
      }
    } else {
      if (lblUser){
        lblUser.classList.add("auth-hidden");
        lblUser.textContent = "";
      }
      if (btnLogout){
        btnLogout.classList.add("auth-hidden");
      }
      if (btnAuth){
        btnAuth.classList.remove("auth-hidden");
      }
    }
  }

  function persistSession(){
    localStorage.setItem("auth.username", _state.username || "");
    localStorage.setItem("auth.role", _state.role || "");
    localStorage.setItem("auth.logged", _state.logged ? "1" : "0");
  }

  function loadSessionFromStorage(){
    const logged = localStorage.getItem("auth.logged") === "1";
    const username = localStorage.getItem("auth.username") || null;
    const role     = localStorage.getItem("auth.role") || null;
    _state = { logged, username, role };
  }

  async function doLogin(user, pass){
    const cfg = window.APP_CONFIG || {};
    const url = cfg.AUTH_API_URL;
    if (!url){
      window.showToast?.("No hay AUTH_API_URL configurada");
      return;
    }

    // tu backend actual de login con ?op=login...
    const fullUrl = url
      + "?op=login"
      + "&username=" + encodeURIComponent(user)
      + "&password=" + encodeURIComponent(pass);

    let data;
    try{
      const r = await fetch(fullUrl, { method:"GET", cache:"no-store" });
      data = await r.json();
    } catch(err){
      console.error("login error", err);
      window.showToast?.("Error de red al iniciar sesión");
      return;
    }

    if (!data || !data.ok){
      window.showToast?.("Usuario o contraseña inválidos");
      return;
    }

    _state.logged   = true;
    _state.username = data.user || user;
    _state.role     = data.role  || "publicador"; // default si no viene

    persistSession();
    applyAuthHeaderUI();
    applyRoleUI();

    window.showToast?.("Sesión iniciada");
  }

  async function restore(){
    loadSessionFromStorage();
    applyAuthHeaderUI();
    applyRoleUI();
  }

  function logout(){
    _state = { logged:false, username:null, role:null };
    persistSession();
    applyAuthHeaderUI();
    applyRoleUI();

    if (window.MapApp){
      window.MapApp.clearAllPolygonsForLogout();
    }

    window.showToast?.("Sesión cerrada");
  }

  function isLogged(){ return _state.logged; }
  function getUsername(){ return _state.username; }
  function getRole(){ return _state.role; }

  window.AuthApp = {
    doLogin,
    restore,
    logout,
    isLogged,
    getUsername,
    getRole
  };
})();
