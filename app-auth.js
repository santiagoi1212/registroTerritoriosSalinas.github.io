(function(){
  "use strict";

  const SESSION_COOKIE      = "salinas_auth";
  const SESSION_TIMEOUT_MIN = 30;
  const ACTIVITY_THROTTLE_MS = 60 * 1000; // no reescribir la cookie más de 1 vez por minuto
  const WATCHER_INTERVAL_MS  = 15 * 1000;

  let _state = {
    logged: false,
    username: null,
    role: null, // "admin" | "capitan" | "publicador" | etc.
    nombreCompleto: null // "Nombre Apellido", si el backend lo mandó al loguear
  };

  let _lastActivityTouch = 0;
  let _expiryWatcher = null;
  let _listeners = [];

  // ===== Cookies =====
  function setCookie(name, value, minutes){
    const d = new Date();
    d.setTime(d.getTime() + minutes * 60 * 1000);
    document.cookie = name + "=" + encodeURIComponent(value) + ";expires=" + d.toUTCString() + ";path=/;SameSite=Lax";
  }
  function getCookie(name){
    const safe = name.replace(/([.$?*|{}()\[\]\\\/+^])/g, "\\$1");
    const match = document.cookie.match(new RegExp("(?:^|; )" + safe + "=([^;]*)"));
    return match ? decodeURIComponent(match[1]) : null;
  }
  function deleteCookie(name){
    document.cookie = name + "=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;SameSite=Lax";
  }

  // ===== Suscripción a cambios de sesión (login/logout/expiración) =====
  function onChange(cb){
    if (typeof cb === "function") _listeners.push(cb);
  }
  function notify(){
    _listeners.forEach(cb => { try{ cb(); }catch(_){} });
  }

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
    if (_state.logged){
      setCookie(SESSION_COOKIE, JSON.stringify({ u: _state.username, r: _state.role, n: _state.nombreCompleto }), SESSION_TIMEOUT_MIN);
    } else {
      deleteCookie(SESSION_COOKIE);
    }
  }

  function loadSessionFromStorage(){
    const raw = getCookie(SESSION_COOKIE);
    if (!raw){
      _state = { logged:false, username:null, role:null, nombreCompleto:null };
      return;
    }
    try{
      const data = JSON.parse(raw);
      _state = { logged:true, username: data.u || null, role: data.r || null, nombreCompleto: data.n || null };
    }catch(_){
      _state = { logged:false, username:null, role:null, nombreCompleto:null };
    }
  }

  // Renueva la expiración de la cookie mientras haya actividad del usuario
  // (máximo una vez por minuto), implementando el timeout por inactividad.
  function touchSession(){
    if (!_state.logged) return;
    const now = Date.now();
    if (now - _lastActivityTouch < ACTIVITY_THROTTLE_MS) return;
    _lastActivityTouch = now;
    setCookie(SESSION_COOKIE, JSON.stringify({ u: _state.username, r: _state.role, n: _state.nombreCompleto }), SESSION_TIMEOUT_MIN);
  }

  function startExpiryWatcher(){
    if (_expiryWatcher) return;
    _expiryWatcher = setInterval(() => {
      if (_state.logged && !getCookie(SESSION_COOKIE)){
        logout(true);
      }
    }, WATCHER_INTERVAL_MS);
  }

  ["click","keydown","mousemove","scroll","touchstart"].forEach(evt => {
    document.addEventListener(evt, touchSession, { passive:true });
  });

  async function doLogin(user, pass){
    const cfg = window.APP_CONFIG || {};
    const url = cfg.AUTH_API_URL;
    if (!url){
      window.showToast?.("No hay AUTH_API_URL configurada");
      return { ok:false, message:"No hay AUTH_API_URL configurada" };
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
      return { ok:false, message:"Error de red al iniciar sesión" };
    }

    if (!data || !data.ok){
      window.showToast?.("Usuario o contraseña inválidos");
      return { ok:false, message:"Usuario o contraseña inválidos" };
    }

    _state.logged   = true;
    _state.username = data.user || user;
    _state.role     = data.role  || "publicador"; // default si no viene
    _state.nombreCompleto = [data.nombre, data.apellido].filter(Boolean).join(" ").trim() || null;

    _lastActivityTouch = Date.now();
    persistSession();
    applyAuthHeaderUI();
    applyRoleUI();
    startExpiryWatcher();

    window.showToast?.("Sesión iniciada");
    notify();
    return { ok:true };
  }

  async function restore(){
    loadSessionFromStorage();
    applyAuthHeaderUI();
    applyRoleUI();
    if (_state.logged){
      _lastActivityTouch = Date.now();
      startExpiryWatcher();
    }
    notify();
  }

  function logout(byTimeout){
    _state = { logged:false, username:null, role:null, nombreCompleto:null };
    persistSession();
    applyAuthHeaderUI();
    applyRoleUI();

    if (window.MapApp){
      window.MapApp.clearAllPolygonsForLogout();
    }

    window.showToast?.(byTimeout ? "Tu sesión expiró por inactividad (30 min)" : "Sesión cerrada");
    notify();
  }

  function isLogged(){ return _state.logged; }
  function getUsername(){ return _state.username; }
  function getRole(){ return _state.role; }
  // Nombre y apellido si el backend los mandó al loguear; si no, el usuario.
  function getDisplayName(){ return _state.nombreCompleto || _state.username; }

  window.AuthApp = {
    doLogin,
    restore,
    logout,
    isLogged,
    getUsername,
    getRole,
    getDisplayName,
    onChange
  };
})();
