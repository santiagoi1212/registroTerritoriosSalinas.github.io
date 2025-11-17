// revisitas.app.js
// Módulo central para Revisitas / Estudios: lista + mapa + alta/edición/eliminación
(function (global) {
  const $ = (s) => document.querySelector(s);

  const APP = {};
  let map = null;
  let layer = null;
  let data = [];
  let picking = false;
  let pickMarker = null;
  let pickMode = null; // "form" | "new"


  function resolveMap() {
    try {
      if (global.MapApp && typeof global.MapApp.getMap === "function") return global.MapApp.getMap();
      if (global.map) return global.map;
    } catch (e) {}
    return null;
  }

  function ensureLayer() {
    if (!map) map = resolveMap();
    if (!map) return null;

    if (!layer) {
      if (global.MapApp && typeof global.MapApp.getRevisitasLayer === "function") {
        layer = global.MapApp.getRevisitasLayer();
      }
      if (!layer) {
        layer = L.layerGroup();
      }
    }

    if (layer && map && !map.hasLayer(layer)) {
      layer.addTo(map);
    }

    return layer;
  }

  function clearMarkers() {
    const lyr = ensureLayer();
    if (!lyr) return;
    lyr.clearLayers();
  }

  function buildPopupHtml(rv) {
    const partes = [];
    partes.push("<strong>" + (rv.nombre || "(sin nombre)") + "</strong>");
    if (rv.fecha) partes.push("<br><small>Fecha: " + rv.fecha + "</small>");
    if (rv.direccion) partes.push("<br><small>Dir: " + rv.direccion + "</small>");
    if (rv.tema) partes.push("<br><small>Tema: " + rv.tema + "</small>");
    if (rv.prox) partes.push("<br><small>Próxima: " + rv.prox + "</small>");
    if (rv.tipo) partes.push("<br><small>Tipo: " + rv.tipo + "</small>");
    return partes.join("");
  }

  function buildMarkerIcon(rv) {
    const tipo = (rv.tipo || "").toLowerCase();
    const emoji = tipo === "estudio" ? "📘" : "📰";

    const bgVar = tipo === "estudio" ? "var(--success)" : "var(--primary)";
    const fg = "#0b1220";

    const html =
      '<div style="' +
      "display:inline-flex;" +
      "align-items:center;" +
      "justify-content:center;" +
      "width:32px;" +
      "height:32px;" +
      "border-radius:50%;" +
      "background:" + bgVar + ";" +
      "color:" + fg + ";" +
      "border:2px solid var(--border);" +
      "box-shadow:var(--shadow);" +
      "font-size:18px;" +
      '">' +
      emoji +
      "</div>";

    return L.divIcon({
      className: "",
      html: html,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });
  }

  function addMarker(rv) {
    const lyr = ensureLayer();
    if (!lyr) return;
    const lat = parseFloat(rv.lat);
    const lng = parseFloat(rv.lng);
    if (!isFinite(lat) || !isFinite(lng)) return;
    const marker = L.marker([lat, lng], { icon: buildMarkerIcon(rv) });
    marker.bindPopup(buildPopupHtml(rv));
    marker.addTo(lyr);
  }

  function renderMarkers() {
    clearMarkers();
    data.forEach(addMarker);
  }

  function toDateInputValue(dateIsoString){
  const d = new Date(dateIsoString);
  if (isNaN(d)) return "";
  return d.toISOString().split("T")[0]; // → "2025-11-17"
}



  function renderList() {
    const listEl = $("#revisita-list");
    if (!listEl) return;
    listEl.innerHTML = "";

    if (!data.length) {
      listEl.innerHTML = '<div class="empty-state">No hay revisitas todavía.</div>';
      return;
    }

    data.forEach((rv, idx) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "revisita-item";

      const tipoEmoji = (rv.tipo || "").toLowerCase() === "estudio" ? "📘" : "📒";
      const proxTxt = rv.prox ? " · Próx: " + rv.prox : "";
      const fechaTxt = rv.fecha ? rv.fecha : "";

      if ((rv.tipo || "").toLowerCase() === "estudio"){
         item.innerHTML =
        '<div class="revisita-item revisita">' +
        '<div class="rev-icon">E</div>' +
        '<div class="rev-main">' +
        '<div class="rev-title">' + (rv.nombre || "(sin nombre)") + '</div>' +
        '<div class="rev-meta"> Tema: ' + rv.tema + "</div>" +
        '<div class="rev-meta"> Próx: ' + toDateInputValue(rv.prox) + "</div>" +
        '</div>' +
        '</div>';

      }else{
         item.innerHTML =
        '<div class="revisita-item revisita">' +
        '<div class="rev-icon">R</div>' +
        '<div class="rev-main">' +
         '<div class="rev-title">' + (rv.nombre || "(sin nombre)") + '</div>' +
        '<div class="rev-meta"> Tema: ' + rv.tema + "</div>" +
        '<div class="rev-meta"> Próx: ' + rv.prox + "</div>" +
        '</div>' +
        '</div>';
      }

      item.addEventListener("click", function () {
        focusOnMap(rv);
        openFormModal(rv, idx);
      });

      listEl.appendChild(item);
    });
  }

  function focusOnMap(rv) {
    const lat = parseFloat(rv.lat);
    const lng = parseFloat(rv.lng);
    if (!map || !isFinite(lat) || !isFinite(lng)) return;
    map.setView([lat, lng], Math.max(map.getZoom() || 14, 17));
  }

  async function loadFromServer() {
    const user = global.AuthApp && global.AuthApp.getUsername && global.AuthApp.getUsername();
    if (!user) {
      global.showToast && global.showToast("Primero iniciá sesión");
      return;
    }
    if (!global.RevisitasApi || typeof global.RevisitasApi.listByUser !== "function") {
      console.warn("[Revisitas] RevisitasApi.listByUser no disponible");
      global.showToast && global.showToast("RevisitasApi no está inicializado");
      return;
    }
    try {
      const arr = await global.RevisitasApi.listByUser(user);
      data = Array.isArray(arr) ? arr : [];
      APP._data = data;
      renderList();
      renderMarkers();
    } catch (err) {
      console.error(err);
      global.showToast && global.showToast("Error cargando revisitas");
    }
  }

  function todayISO() {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + mm + "-" + dd;
  }

    function buildFormHTML(rv) {
    const isEdit = !!rv.id; // true si estamos editando una revisita existente

    // Siempre usamos inputs hidden para lat/lng (no se muestran visualmente)
    const latLngSection =
      '<input type="hidden" id="rvf-lat" value="' + (rv.lat || "") + '">' +
      '<input type="hidden" id="rvf-lng" value="' + (rv.lng || "") + '">';

    // Normalizar fechas para <input type="date">
    const valFecha = rv.fecha ? toDateInputValue(rv.fecha) : todayISO();
    const valProx  = rv.prox  ? toDateInputValue(rv.prox)  : todayISO();

    return (
      '<form id="rv-form" class="rv-form">' +
        // ID + índice en la lista
        '<input type="hidden" id="rv-id" value="' + (rv.id || "") + '">' +
        '<input type="hidden" id="rv-idx" value="' + (rv._idx != null ? rv._idx : "") + '">' +

        // Nombre
        '<div class="row">' +
          '<label for="rvf-nombre">Nombre</label>' +
          '<input id="rvf-nombre" value="' + (rv.nombre || "") + '">' +
        '</div>' +

        // Fecha
        '<div class="row">' +
          '<label for="rvf-fecha">Fecha</label>' +
          '<input id="rvf-fecha" type="date" value="' + valFecha + '">' +
        '</div>' +

        // Dirección
        '<div class="row">' +
          '<label for="rvf-direccion">Dirección</label>' +
          '<input id="rvf-direccion" value="' + (rv.direccion || "") + '">' +
        '</div>' +

        // Tema
        '<div class="row">' +
          '<label for="rvf-tema">Tema</label>' +
          '<input id="rvf-tema" value="' + (rv.tema || "") + '">' +
        '</div>' +

        // Próxima
        '<div class="row">' +
          '<label for="rvf-prox">Próxima</label>' +
          '<input id="rvf-prox" type="date" value="' + valProx + '">' +
        '</div>' +

        // Tipo
        '<div class="row">' +
          '<label for="rvf-tipo">Tipo</label>' +
          '<select id="rvf-tipo">' +
            '<option value="revisita"' + ((rv.tipo || "").toLowerCase() === "revisita" ? " selected" : "") + '>Revisita</option>' +
            '<option value="estudio"'  + ((rv.tipo || "").toLowerCase() === "estudio"  ? " selected" : "") + '>Estudio</option>' +
            '<option value="visita"'   + ((rv.tipo || "").toLowerCase() === "visita"   ? " selected" : "") + '>Visita</option>' +
            '<option value="otro"'     + ((rv.tipo || "").toLowerCase() === "otro"     ? " selected" : "") + '>Otro</option>' +
          '</select>' +
        '</div>' +

        // Notas
        '<div class="row">' +
          '<label for="rvf-notas">Notas</label>' +
          '<textarea id="rvf-notas" rows="3">' + (rv.notas || "") + '</textarea>' +
        '</div>' +

        // Lat/Lng (hidden)
        latLngSection +

        // Acciones
        '<div class="row actions">' +
          '<button type="button" id="rvf-cancel" class="btn-cancel">Cancelar</button>' +
          '<div style="flex:1"></div>' +
          '<button type="button" id="rvf-delete" class="btn-danger"' + (rv.id ? '' : ' style="display:none"') + '>Eliminar</button>' +
          '<button type="submit" id="rvf-save" class="btn-primary">Guardar</button>' +
        '</div>' +
      '</form>'
    );
  }




  function openFormModal(rv, idx) {
    const overlay = $("#revisita-overlay");
    const body = $("#revisita-body");
    if (!overlay || !body) return;

    const model = {};
    for (var k in rv) if (Object.prototype.hasOwnProperty.call(rv, k)) model[k] = rv[k];
    model._idx = typeof idx === "number" ? idx : "";

    body.innerHTML = buildFormHTML(model);
    overlay.style.display = "flex";

    const form = $("#rv-form");
    const btnCancel = $("#rvf-cancel");
    const btnDelete = $("#rvf-delete");
    const btnPick = $("#rvf-pick");
    const btnPos = $("#rvf-pos");

    form.addEventListener("submit", onFormSubmit);
    if (btnCancel) btnCancel.addEventListener("click", closeFormModal);
    overlay.addEventListener("click", function (ev) {
      if (ev.target === overlay) closeFormModal();
    });

    if (btnPick) btnPick.addEventListener("click", enablePickMode);
    if (btnPos) btnPos.addEventListener("click", useMyPos);
    if (btnDelete) btnDelete.addEventListener("click", onDeleteClick);
  }

  function closeFormModal() {
    const overlay = $("#revisita-overlay");
    if (overlay) overlay.style.display = "none";
    disablePickMode();
  }

  function getFormModel() {
    return {
      id: $("#rv-id") && $("#rv-id").value || "",
      idx: $("#rv-idx") && $("#rv-idx").value || "",
      nombre: $("#rvf-nombre") && $("#rvf-nombre").value.trim() || "",
      fecha: $("#rvf-fecha") && $("#rvf-fecha").value || "",
      direccion: $("#rvf-direccion") && $("#rvf-direccion").value.trim() || "",
      tema: $("#rvf-tema") && $("#rvf-tema").value.trim() || "",
      prox: $("#rvf-prox") && $("#rvf-prox").value || "",
      tipo: $("#rvf-tipo") && $("#rvf-tipo").value || "",
      notas: $("#rvf-notas") && $("#rvf-notas").value.trim() || "",
      lat: $("#rvf-lat") && $("#rvf-lat").value || "",
      lng: $("#rvf-lng") && $("#rvf-lng").value || ""
    };
  }

  async function onFormSubmit(ev) {
    ev.preventDefault();

    if (!global.RevisitasApi || typeof global.RevisitasApi.save !== "function") {
      global.showToast && global.showToast("RevisitasApi.save no está disponible");
      return;
    }

    const user = global.AuthApp && global.AuthApp.getUsername && global.AuthApp.getUsername();
    if (!user) {
      global.showToast && global.showToast("Primero iniciá sesión");
      return;
    }

    const model = getFormModel();
    if (!model.lat || !model.lng) {
      global.showToast && global.showToast("Seleccioná la ubicación en el mapa");
      return;
    }

    const isNew = !model.id;
    const payload = {
      _mode: isNew ? "add" : "edit",
      id: model.id,
      user: user,
      nombre: model.nombre,
      fecha: model.fecha,
      direccion: model.direccion,
      tema: model.tema,
      prox: model.prox,
      tipo: model.tipo || "revisita",
      lat: model.lat,
      lng: model.lng
    };

    try {
      await global.RevisitasApi.save(payload);
      global.showToast && global.showToast("Revisita guardada");
      closeFormModal();
      await loadFromServer();
    } catch (err) {
      console.error(err);
      console.log("No se pudo guardar: " + (err.message || err));
      global.showToast && global.showToast("No se pudo guardar: " + (err.message || err));
    }
  }

  async function onDeleteClick() {
    if (!global.RevisitasApi || typeof global.RevisitasApi.remove !== "function") {
      global.showToast && global.showToast("Eliminar todavía no está disponible");
      return;
    }

    const user = global.AuthApp && global.AuthApp.getUsername && global.AuthApp.getUsername();
    if (!user) {
      global.showToast && global.showToast("Primero iniciá sesión");
      return;
    }

    const model = getFormModel();
    if (!model.id) return;
    if (!confirm("¿Eliminar esta revisita?")) return;

    try {
      await global.RevisitasApi.remove(model.id);
      global.showToast && global.showToast("Revisita eliminada");
      closeFormModal();
      await loadFromServer();
    } catch (err) {
      console.error(err);
      var msg = String(err && err.message || err);
      if (msg.indexOf("429") >= 0) {
        global.showToast && global.showToast("Google Apps Script devolvió 429 (Too Many Requests). Probá de nuevo en unos segundos.");
      } else {
        global.showToast && global.showToast("No se pudo eliminar: " + msg);
      }
    }
  }

  function enablePickMode() {
    if (!map) map = resolveMap();
    if (!map) return;
    picking = true;
    pickMode = "form";
    map.getContainer().classList.add("crosshair");
    map.once("click", onPickClick);
    global.showToast && global.showToast("Hacé click en el mapa para elegir ubicación");
  }

  function enablePickNewRevisita() {
    if (!map) map = resolveMap();
    if (!map) return;
    picking = true;
    pickMode = "new";
    map.getContainer().classList.add("crosshair");
    map.once("click", onPickClick);
    global.showToast && global.showToast("Hacé click en el mapa para crear una revisita");
  }

  function disablePickMode() {
    picking = false;
    pickMode = null;
    if (map) {
      map.getContainer().classList.remove("crosshair");
    }
  }



  function onPickClick(ev) {
    if (!picking) return;
    if (!map) map = resolveMap();

    const lat = ev.latlng.lat;
    const lng = ev.latlng.lng;

    if (pickMarker) pickMarker.remove();
    if (map) {
      pickMarker = L.marker([lat, lng], { title: "Ubicación revisita" }).addTo(map);
      map.setView([lat, lng], Math.max(map.getZoom() || 14, 17));
    }

    const latFixed = lat.toFixed(6);
    const lngFixed = lng.toFixed(6);

    if (pickMode === "form") {
      // Modo original: solo actualizar campos del formulario abierto
      const latEl = $("#rvf-lat");
      const lngEl = $("#rvf-lng");
      if (latEl) latEl.value = latFixed;
      if (lngEl) lngEl.value = lngFixed;
    } else if (pickMode === "new") {
      // Nuevo modo: crear una revisita NUEVA con estos coords
      openFormModal(
        {
          fecha: todayISO(),
          lat: latFixed,
          lng: lngFixed,
          tipo: "revisita"
        },
        -1
      );
    }

    disablePickMode();
  }

  function bindNewFromMapButton() {
    const btn = $("#btn-revisitas-new-map");
    if (!btn) return;
    btn.addEventListener("click", () => {
      enablePickNewRevisita();
    });
  }



  async function useMyPos() {
    if (!map) map = resolveMap();
    try {
      const pos = await new Promise(function (res, rej) {
        navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 10000 });
      });
      const latitude = pos.coords.latitude;
      const longitude = pos.coords.longitude;
      if (pickMarker) pickMarker.remove();
      pickMarker = L.marker([latitude, longitude], { title: "Mi posición" }).addTo(map);
      const latEl = $("#rvf-lat");
      const lngEl = $("#rvf-lng");
      if (latEl) latEl.value = latitude.toFixed(6);
      if (lngEl) lngEl.value = longitude.toFixed(6);
      if (map) {
        map.setView([latitude, longitude], Math.max(map.getZoom() || 14, 17));
      }
      global.showToast && global.showToast("Usando tu posición actual");
    } catch (e) {
      console.warn(e);
      global.showToast && global.showToast("No se pudo obtener tu posición");
    }
  }

  function bindToggleButton() {
    const btn = $("#btn-revisitas");
    const icon = $("#icon-revisitas");
    const panel = $("#revisita-panel");
    if (!btn) return;

    btn.addEventListener("click", async function () {
      const isOn = btn.dataset.active === "on";
      if (isOn) {
        btn.dataset.active = "off";
        if (icon) icon.textContent = "📒";
        if (panel) panel.hidden = true;
        clearMarkers();
      } else {
        btn.dataset.active = "on";
        if (icon) icon.textContent = "✅";
        if (panel) panel.hidden = false;
        await loadFromServer();
      }
    });
  }

  function bindOverlayClose() {
    const overlay = $("#revisita-overlay");
    const btnClose = $("#revisita-close");
    if (!overlay) return;
    if (btnClose) btnClose.addEventListener("click", closeFormModal);
  }

  function init() {
    map = resolveMap();
    ensureLayer();
    bindToggleButton();
    bindOverlayClose();
    bindNewFromMapButton();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  APP.reload = loadFromServer;
  APP.openNew = function () { openFormModal({ fecha: todayISO() }, -1); };
  APP.getData = function () { return data.slice(); };
  global.RevisitasApp = APP;
})(window);
