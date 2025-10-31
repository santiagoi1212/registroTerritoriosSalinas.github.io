(function(){
  'use strict';

  let _session = null; // { username, role }

  function qs(id){ return document.getElementById(id); }

  function persistSession() {
    if (_session) {
      try {
        localStorage.setItem('territorios_session', JSON.stringify(_session));
      } catch(_) {}
    } else {
      try {
        localStorage.removeItem('territorios_session');
      } catch(_) {}
    }
  }

  function setUILogged(user){
    _session = user;

    // actualizar UI usuario
    const authInfo = qs('auth-info');
    if (authInfo) {
      authInfo.textContent = user.username || '';
      authInfo.classList.remove('auth-hidden');
    }

    // mostrar "Salir", ocultar "Acceder"
    const btnAuthOpen = qs('btnAuthOpen');
    const btnLogout   = qs('btnLogout');
    if (btnAuthOpen) btnAuthOpen.classList.add('auth-hidden');
    if (btnLogout)   btnLogout.classList.remove('auth-hidden');

    // guardar en localStorage
    persistSession();

    // pedirle al mapa que pinte polígonos ahora que hay sesión
    if (window.MapApp && window.MapApp.paintPolygonsForSession){
      window.MapApp.paintPolygonsForSession(_session);
    }
  }

  function setUILoggedOut(){
    _session = null;

    // ocultar info usuario
    const authInfo = qs('auth-info');
    if (authInfo) {
      authInfo.textContent = '';
      authInfo.classList.add('auth-hidden');
    }

    // mostrar "Acceder", ocultar "Salir"
    const btnAuthOpen = qs('btnAuthOpen');
    const btnLogout   = qs('btnLogout');
    if (btnAuthOpen) btnAuthOpen.classList.remove('auth-hidden');
    if (btnLogout)   btnLogout.classList.add('auth-hidden');

    // limpiar localStorage
    persistSession();

    // pedirle al mapa que limpie polígonos y ruta
    if (window.MapApp && window.MapApp.clearAllPolygonsForLogout){
      window.MapApp.clearAllPolygonsForLogout();
    }
  }

  async function doLogin(user, pass){
    // Acá iría tu validación real contra Apps Script.
    // Ahora asumimos OK siempre que venga algo.
    if (!user || !pass){
      window.showToast?.('Credenciales inválidas');
      return;
    }

    // Ejemplo de sesión. Podés reemplazar role según lo que devuelva tu backend.
    const fakeSession = {
      username: user,
      role: "admin"
    };

    window.showToast?.('Sesión iniciada');
    setUILogged(fakeSession);
  }

  function logout(){
    window.showToast?.('Sesión cerrada');
    setUILoggedOut();
  }

  async function restore(){
    // Intentar leer del localStorage
    let stored = null;
    try {
      const raw = localStorage.getItem('territorios_session');
      if (raw) {
        stored = JSON.parse(raw);
      }
    } catch(_) {}

    if (stored && stored.username){
      // tenemos sesión previa válida -> mantener logueado
      setUILogged(stored);
    } else {
      // no había sesión guardada
      setUILoggedOut();
    }
  }

  function isLogged(){
    return !!_session;
  }

  window.AuthApp = {
    doLogin,
    logout,
    restore,
    isLogged,
    _debugGetSession: ()=>_session,
    setUILogged,
    setUILoggedOut,
  };

})();
