// Estado de actividad en la predicación (Activo / Irregular / Inactivo),
// compartido por las pantallas que usan la caché de Informes de predicación
// (?action=cache: { roster, rows }).
//
// Regla (la misma de siempre, ver personStatus en index.html y
// calcularEstadoActividad en app-publicadores.js):
//   - Ventana: los últimos 6 meses con informes de alguien.
//   - Un mes cuenta como "no participó" si no informó, si informó "No", o si
//     lo dejó en blanco sin horas.
//   - 6 meses seguidos (desde el más reciente) sin participar -> Inactivo
//   - 2 o más sin participar en la ventana -> Irregular
//   - Si todavía no hay 6 meses suyos -> Falta información.
//
// Un INACTIVO deja de contarse como publicador: EstadoActividad.sinInactivos()
// lo saca del padrón (roster) para que no entre en ningún cálculo (totales,
// faltan registrarse, gráficos, promedios). Si vuelve a informar que
// participó, la racha se corta y vuelve a contarse solo.
(function (global) {
  'use strict';

  function participoEnMes(r) {
    if (!r) return false;
    if (r.participo === true) return true;
    if (r.participo === false) return false;
    return typeof r.horas === 'number' && r.horas > 0;
  }

  function periodos(rows) {
    var set = {};
    (rows || []).forEach(function (r) { if (r.periodKey != null && !isNaN(Number(r.periodKey))) set[Number(r.periodKey)] = true; });
    return Object.keys(set).map(Number).sort(function (a, b) { return b - a; });
  }

  // Map nombre -> { code, label, ventana:[{periodKey, participo}], ultimoParticipo, sinParticipar }
  function calcular(roster, rows) {
    var porNombre = {};
    (rows || []).forEach(function (r) {
      if (!porNombre[r.nombre]) porNombre[r.nombre] = {};
      porNombre[r.nombre][Number(r.periodKey)] = r;
    });
    var todos = periodos(rows);
    var ventana = todos.slice(0, 6);
    var estados = new Map();

    (roster || []).forEach(function (p) {
      var hist = porNombre[p.nombre] || {};
      var keys = Object.keys(hist).map(Number).sort(function (a, b) { return a - b; });
      var ultimoParticipo = null;
      for (var i = keys.length - 1; i >= 0; i--) {
        if (participoEnMes(hist[keys[i]])) { ultimoParticipo = keys[i]; break; }
      }
      var detalle = ventana.map(function (pk) { return { periodKey: pk, informo: !!hist[pk], participo: participoEnMes(hist[pk]) }; });
      var base = { ventana: detalle, ultimoParticipo: ultimoParticipo };

      if (!keys.length || ventana.length < 6 || keys[0] > ventana[5]) {
        estados.set(p.nombre, Object.assign({ code: 'sin-info', label: 'Falta información (menos de 6 meses)', sinParticipar: 0 }, base));
        return;
      }
      var consecutivos = 0, total = 0, cortada = false;
      detalle.forEach(function (d) {
        if (!d.participo) { total++; if (!cortada) consecutivos++; } else { cortada = true; }
      });
      var est = consecutivos >= 6 ? { code: 'inactivo', label: 'Inactivo' }
        : (consecutivos >= 2 || total >= 2) ? { code: 'irregular', label: 'Irregular' }
        : { code: 'activo', label: 'Activo' };
      estados.set(p.nombre, Object.assign(est, { sinParticipar: total, seguidos: consecutivos }, base));
    });
    return estados;
  }

  // Copia de la caché sin los inactivos en el padrón. Agrega:
  //   inactivos:   [{grupo, nombre, estado, ...detalle}]
  //   irregulares: [{grupo, nombre, estado, ...detalle}]
  function sinInactivos(data) {
    if (!data) return data;
    var estados = calcular(data.roster, data.rows);
    var activos = [], inactivos = [], irregulares = [];
    (data.roster || []).forEach(function (p) {
      var e = estados.get(p.nombre);
      var item = Object.assign({}, p, { actividad: e });
      if (e && e.code === 'inactivo') inactivos.push(item);
      else {
        activos.push(p);
        if (e && e.code === 'irregular') irregulares.push(item);
      }
    });
    return Object.assign({}, data, { roster: activos, inactivos: inactivos, irregulares: irregulares, estadosActividad: estados });
  }

  global.EstadoActividad = { participoEnMes: participoEnMes, calcular: calcular, sinInactivos: sinInactivos, periodos: periodos };
})(window);
