window.APP_CONFIG = {
      AUTH_API_URL: 'https://script.google.com/macros/s/AKfycbwXu2ue7iLYsFtOMm8rEj6wEgcwEBYYcoiqlb3qpcYGtq0uanj5F9BXEUSupB-RJVg/exec',
      SHEETS_TERRITORIOS_CSV_URL: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vS-TxyDU1xvaMwDjc5GQxjglSfBUYTUyu2_NDcAsJ_v0ngaD8g_-WcmxsUd9921RF2q5I4bcscjsf6N/pub?gid=0&single=true&output=csv',
      WEBHOOK_URL: 'https://script.google.com/macros/s/AKfycbzroVoGmG6WJ9IONSNYMzfT9D7d381eTjzOOp5QiiRZypDlnVLeXBHSjQeMntbP6A/exec',

      // ===== Portal (nuevo) =====
      // Accesos del portal principal (portal.html).
      MAPA_TERRITORIOS_URL: 'https://registroterritoriossalinas.ngdesignstudio.com/',
      REGISTRO_TRANSPORTE_URL: 'https://registroterritoriossalinas.ngdesignstudio.com/transporte.html',

      // Planilla "Portal Salinas - Publicadores" (DPA / Uso de Datos / Datos Personales).
      // https://docs.google.com/spreadsheets/d/10iAtM2jSdqSOZ6ot0u-OILEm58BrO9dbnK_Lp4ks3qk/edit
      PUBLICADORES_CSV_URL: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRJha4oCj-GTyUJ3Zjxv8z2pmyaRogbq9A5wpG5TjO8doOjmMj2XbH7juSVapquALxWmARt_TAZTGU5/pub?gid=1214544104&single=true&output=csv',

      // URL del Apps Script (ver google-apps-script-publicadores.js) que permite
      // subir/borrar el DPA y el Uso de Datos desde el modal de Publicadores.
      // Dejar vacío si todavía no se desplegó: el modal muestra los datos igual,
      // solo sin la opción de subir/borrar.
      PUBLICADORES_API_URL: 'https://script.google.com/macros/s/AKfycbzAG7WB9G1mGscY7CfGvVrJMo6vlQhFNKScSSA5LsFbmekZJS6zqM1sl73odxYwWCTG/exec',

      // Ya NO hace falta: el backend (google-apps-script-publicadores.js,
      // guardarDatosPersonales) marca sola la columna "DatosPersonales" (y
      // "DatosPersonalesFecha" si existe) en la hoja Publicadores cuando
      // alguien envía datos-personales.html. Dejar SIEMPRE vacío: la hoja
      // "DatosPersonales" tiene datos sensibles (salud, dirección, contacto
      // familiar) y este archivo es público (repo *.github.io) — si se
      // publica esa hoja como CSV y se pega el link acá, queda accesible
      // por internet para cualquiera.
      DATOS_PERSONALES_RESPUESTAS_CSV_URL: ''
};


