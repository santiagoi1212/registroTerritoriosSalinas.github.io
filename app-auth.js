(function () {
  "use strict";

  let _session = null; // { username, role }

  function qs(id) {
    return document.getElementById(id);
  }

  // =========================
  // Persistencia de sesión
  // =========================
  function persistSession() {
    if (_session) {
      try {
        localStorage.setItem(
          "territorios_session",
          JSON.stringify(_session)
        );
      } catch (_) {}
    } else {
      try {
        localStorage.removeItem("territorios_session");
      } catch (_) {}
    }
  }

  // =========================
  // UI helpers de login
  // =========================
  function setUILogged(user) {
  _session = user;

  // Mostrar nombre usuario
  const authInfo = qs("auth-info");
  if (authInfo) {
    authInfo.textContent = user.username || "";
    authInfo.classList.remove("auth-hidden");
  }

  // Mostrar "Salir", ocultar "Acceder"
  const btnAuthOpen = qs("btnAuthOpen");
  const btnLogout = qs("btnLogout");
  if (btnAuthOpen) btnAuthOpen.classList.add("auth-hidden");
  if (btnLogout) btnLogout.classList.remove("auth-hidden");

  // 👉 Mostrar los botones restringidos (Números e Info)
  const btnLabels = qs("btnToggleLabels");
  const btnInfo   = qs("btn-info-toggle");
  if (btnLabels) btnLabels.style.display = "flex";
  if (btnInfo)   btnInfo.style.display = "flex";

  // Guardar sesión
  persistSession();

  // Avisar al mapa que hay sesión
  if (window.MapApp && window.MapApp.paintPolygonsForSession) {
    window.MapApp.paintPolygonsForSession(_session);
  }
}

function setUILoggedOut() {
  _session = null;

  // Limpiar nombre usuario
  const authInfo = qs("auth-info");
  if (authInfo) {
    authInfo.textContent = "";
    authInfo.classList.add("auth-hidden");
  }

  // Mostrar "Acceder", ocultar "Salir"
  const btnAuthOpen = qs("btnAuthOpen");
  const btnLogout = qs("btnLogout");
  if (btnAuthOpen) btnAuthOpen.classList.remove("auth-hidden");
  if (btnLogout) btnLogout.classList.add("auth-hidden");

  // 👉 Ocultar los botones restringidos
  const btnLabels = qs("btnToggleLabels");
  const btnInfo   = qs("btn-info-toggle");
  if (btnLabels) btnLabels.style.display = "none";
  if (btnInfo)   btnInfo.style.display = "none";

  // Borrar sesión local
  persistSession();

  // Limpiar polígonos / capas
  if (window.MapApp && window.MapApp.clearAllPolygonsForLogout) {
    window.MapApp.clearAllPolygonsForLogout();
  }
}


  // =========================
  // Utilidades de CSV / crypto
  // =========================

  // Parsea CSV muy simple -> devuelve array de objetos:
  // [
  //   { username:"laviles", email:"...", role:"publicador", salt:"...", passwordHash:"..." },
  //   { ... }
  // ]
  function parseUsersCsv(text) {
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length < 2) return [];

    const header = lines[0].split(",");
    const idxUsername = header.indexOf("username");
    const idxEmail = header.indexOf("email");
    const idxRole = header.indexOf("role");
    const idxSalt = header.indexOf("salt");
    const idxHash = header.indexOf("passwordHash");

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = splitCsvLine(lines[i]);
      rows.push({
        username: cols[idxUsername]?.trim() || "",
        email: cols[idxEmail]?.trim() || "",
        role: cols[idxRole]?.trim() || "",
        salt: cols[idxSalt]?.trim() || "",
        passwordHash: cols[idxHash]?.trim() || "",
      });
    }
    return rows;
  }

  // Soporta comas dentro de comillas si algún día las hubiera
  function splitCsvLine(line) {
    const out = [];
    let cur = "";
    let insideQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];

      if (ch === '"') {
        // toggle o escapar ""
        if (insideQuotes && line[i + 1] === '"') {
          // comilla escapada
          cur += '"';
          i++;
        } else {
          insideQuotes = !insideQuotes;
        }
      } else if (ch === "," && !insideQuotes) {
        out.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out;
  }

  // Calcula SHA-256(salt_bin || password_text) y devuelve base64
  async function sha256SaltedBase64(saltBase64, passwordText) {
    // decode salt (base64 -> Uint8Array)
    const saltBytes = base64ToBytes(saltBase64);
    const passBytes = new TextEncoder().encode(passwordText);

    // concat salt + pass
    const merged = new Uint8Array(saltBytes.length + passBytes.length);
    merged.set(saltBytes, 0);
    merged.set(passBytes, saltBytes.length);

    // hash
    const digest = await crypto.subtle.digest("SHA-256", merged);
    return bytesToBase64(new Uint8Array(digest));
  }

  // base64 -> Uint8Array
  function base64ToBytes(b64) {
    // atob devuelve string binario (cada char code 0-255)
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      arr[i] = bin.charCodeAt(i);
    }
    return arr;
  }

  // Uint8Array -> base64
  function bytesToBase64(bytes) {
    let bin = "";
    for (let i = 0; i < bytes.length; i++) {
      bin += String.fromCharCode(bytes[i]);
    }
    return btoa(bin);
  }

  // =========================
  // VALIDACIÓN DE LOGIN REAL
  // =========================
  async function doLogin(user, pass) {
    if (!user || !pass) {
      window.showToast?.("Credenciales inválidas");
      return;
    }

    let csvText = "";
    try {
      const resp = await fetch("users.csv", {
        cache: "no-store",
      });
      if (!resp.ok) {
        console.error("No pude leer users.csv", resp.status);
        window.showToast?.("Error interno (lectura de usuarios)");
        return;
      }
      csvText = await resp.text();
    } catch (err) {
      console.error("Error fetch users.csv:", err);
      window.showToast?.("Error interno (fetch usuarios)");
      return;
    }

    const users = parseUsersCsv(csvText);

    // Buscamos el registro con username exacto
    const record = users.find(
      (u) => u.username.toLowerCase() === user.toLowerCase()
    );

    if (!record) {
      window.showToast?.("Credenciales inválidas");
      return;
    }

    // Calculamos hash = SHA256(salt || passIngresada) en base64
    let computedHashB64 = "";
    try {
      computedHashB64 = await sha256SaltedBase64(
        record.salt,
        pass
      );
    } catch (err) {
      console.error("Error calculando hash:", err);
      window.showToast?.("Error interno (hash)");
      return;
    }

    // Comparamos con el hash guardado en CSV
    if (computedHashB64 !== record.passwordHash) {
      window.showToast?.("Credenciales inválidas");
      return;
    }

    // ---> Login OK
    const sessionObj = {
      username: record.username,
      role: record.role || "publicador",
    };

    window.showToast?.("Sesión iniciada");
    setUILogged(sessionObj);
  }

  // =========================
  // Logout
  // =========================
  function logout() {
    window.showToast?.("Sesión cerrada");
    setUILoggedOut();
  }

  // =========================
  // Restaurar sesión al cargar
  // =========================
  async function restore() {
    // Intentar leer del localStorage
    let stored = null;
    try {
      const raw = localStorage.getItem(
        "territorios_session"
      );
      if (raw) {
        stored = JSON.parse(raw);
      }
    } catch (_) {}

    if (stored && stored.username) {
      // tenemos sesión previa -> mantener logueado sin revalidar
      setUILogged(stored);
    } else {
      // no había sesión guardada
      setUILoggedOut();
    }
  }

  // =========================
  // Helper público
  // =========================
  function isLogged() {
    return !!_session;
  }

  // Exponer API global
  window.AuthApp = {
    doLogin,
    logout,
    restore,
    isLogged,
    _debugGetSession: () => _session,
    setUILogged,
    setUILoggedOut,
  };
})();
