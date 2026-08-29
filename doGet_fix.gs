// =============================================
// REEMPLAZÁ tu función doGet() con esta versión
// Agrega: si llega ?callback=... sin op ni read,
// devuelve stats_rt por defecto (JSONP fallback)
// =============================================

function doGet(e) {
  try {
    const p = (e && e.parameter) || {};

    // ✅ ADMIN: op=last&id=...
    if (String(p.op || '') === 'last') {
      const id = canonId_(p.id);
      if (!id) {
        const out = { ok: false, error: 'Falta id' };
        return p.callback ? jsonpOut_(p.callback, out) : jsonOut_(out);
      }

      const hit = findLastRegistroRowById_(id);
      if (!hit.exists) {
        const out = { ok: true, exists: false, id };
        return p.callback ? jsonpOut_(p.callback, out) : jsonOut_(out);
      }

      const record = getRegistroRecord_(hit.row);
      const out = { ok: true, exists: true, id, record };
      return p.callback ? jsonpOut_(p.callback, out) : jsonOut_(out);
    }

    // ✅ Registrar por GET si viene payload
    if (p.payload) {
      const d = parsePayload_(e);
      writeToRegistroColB_(d);
      const cantidad = countIdInRegistroColB_(d.id);
      return jsonOut_({ ok: true, id: d.id, cantidad });
    }

    // ✅ stats_rt explícito O bien llega solo callback (JSONP fallback de redirección)
    if (p.read === 'stats_rt' || p.callback) {
      const items = getStatsFromRegistroColB_();
      const out = { ok: true, items };
      return p.callback ? jsonpOut_(p.callback, out) : jsonOut_(out);
    }

    return jsonOut_({ ok: false, error: 'Parámetros inválidos' });

  } catch (err) {
    return jsonOut_({ ok: false, error: String(err && err.message || err) });
  }
}
