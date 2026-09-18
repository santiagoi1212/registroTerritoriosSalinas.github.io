// Reemplazá esta URL por la de tu Web App de Google Apps Script (ver README.md)
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzAG7WB9G1mGscY7CfGvVrJMo6vlQhFNKScSSA5LsFbmekZJS6zqM1sl73odxYwWCTG/exec";

const form = document.getElementById("form-predicacion");
const grupoSelect = document.getElementById("grupo");
const restoFormulario = document.getElementById("resto-formulario");
const nombreSelect = document.getElementById("nombre");
const nombreOtro = document.getElementById("nombre-otro");
const camposParticipacion = document.getElementById("campos-participacion");
const situacion = document.getElementById("situacion");
const mensaje = document.getElementById("mensaje");
const btnEnviar = document.getElementById("btn-enviar");
const cursosInput = document.getElementById("cursos");
const horasInput = document.getElementById("horas");
const campoHoras = document.getElementById("campo-horas");
const mesSelect = document.getElementById("mes");
const anioSelect = document.getElementById("anio");

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

// Deja preseleccionados el mes anterior al actual (el informe siempre es
// sobre el mes que ya terminó) y su año correspondiente, si están entre las
// opciones disponibles del <select>.
function preseleccionarMesAnio() {
  const hoy = new Date();
  // day 1 evita problemas de "día 31 no existe en el mes anterior" al restar.
  const mesPasado = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
  const mesAMostrar = MESES[mesPasado.getMonth()];
  const anioAMostrar = String(mesPasado.getFullYear());

  if ([...mesSelect.options].some((o) => o.value === mesAMostrar)) {
    mesSelect.value = mesAMostrar;
  }
  if ([...anioSelect.options].some((o) => o.value === anioAMostrar)) {
    anioSelect.value = anioAMostrar;
  }
}

// grupo (string) -> [nombres...]
let publicadoresPorGrupo = {};

const TECLAS_PERMITIDAS = [
  "Backspace", "Delete", "Tab", "Escape", "Enter",
  "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End",
];

function soloEnteros(e) {
  if (TECLAS_PERMITIDAS.includes(e.key) || e.ctrlKey || e.metaKey) return;
  if (!/^[0-9]$/.test(e.key)) e.preventDefault();
}

function soloDecimales(e) {
  if (TECLAS_PERMITIDAS.includes(e.key) || e.ctrlKey || e.metaKey) return;
  if (e.key === "." || e.key === ",") {
    if (e.target.value.includes(".") || e.target.value.includes(",")) {
      e.preventDefault();
    }
    return;
  }
  if (!/^[0-9]$/.test(e.key)) e.preventDefault();
}

function sanearInput(e, permitirDecimal) {
  const regex = permitirDecimal ? /[^0-9.,]/g : /[^0-9]/g;
  const limpio = e.target.value.replace(regex, "");
  if (limpio !== e.target.value) e.target.value = limpio;
}

cursosInput.addEventListener("keydown", soloEnteros);
cursosInput.addEventListener("input", (e) => sanearInput(e, false));
cursosInput.addEventListener("paste", (e) => setTimeout(() => sanearInput(e, false)));

horasInput.addEventListener("keydown", soloDecimales);
horasInput.addEventListener("input", (e) => sanearInput(e, true));
horasInput.addEventListener("paste", (e) => setTimeout(() => sanearInput(e, true)));

function urlPublicadores() {
  const separador = SCRIPT_URL.includes("?") ? "&" : "?";
  return SCRIPT_URL + separador + "action=publicadores";
}

async function cargarPublicadores() {
  if (SCRIPT_URL.includes("PEGA_AQUI")) {
    return;
  }

  try {
    const respuesta = await fetch(urlPublicadores());
    const datos = await respuesta.json();

    if (datos.status !== "ok") {
      throw new Error(datos.message || "No se pudo cargar la lista de publicadores");
    }

    publicadoresPorGrupo = {};
    datos.publicadores.forEach(({ grupo, nombre }) => {
      if (!publicadoresPorGrupo[grupo]) {
        publicadoresPorGrupo[grupo] = [];
      }
      publicadoresPorGrupo[grupo].push(nombre);
    });

    const grupos = Object.keys(publicadoresPorGrupo).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true })
    );

    grupoSelect.innerHTML = '<option value="" disabled selected>Elegir</option>';
    grupos.forEach((grupo) => {
      const opcion = document.createElement("option");
      opcion.value = grupo;
      opcion.textContent = "Grupo " + grupo;
      grupoSelect.appendChild(opcion);
    });
  } catch (err) {
    console.error(err);
    mostrarMensaje(
      "No se pudo cargar la lista de grupos/publicadores. Se puede completar igual de forma manual.",
      "error"
    );
  }
}

function poblarNombres(grupo) {
  const nombres = (publicadoresPorGrupo[grupo] || []).slice().sort((a, b) =>
    a.localeCompare(b, "es")
  );

  nombreSelect.innerHTML = '<option value="" disabled selected>Elegir</option>';
  nombres.forEach((nombre) => {
    const opcion = document.createElement("option");
    opcion.value = nombre;
    opcion.textContent = nombre;
    nombreSelect.appendChild(opcion);
  });

  const opcionOtro = document.createElement("option");
  opcionOtro.value = "__otro__";
  opcionOtro.textContent = "Otro (no está en la lista)";
  nombreSelect.appendChild(opcionOtro);
}

function actualizarPorGrupo() {
  const grupo = grupoSelect.value;

  if (grupo) {
    restoFormulario.disabled = false;
    poblarNombres(grupo);
  } else {
    restoFormulario.disabled = true;
    form.reset();
    nombreOtro.classList.add("hidden");
    nombreOtro.required = false;
    camposParticipacion.classList.add("hidden");
    campoHoras.classList.remove("hidden");
  }
}

grupoSelect.addEventListener("change", actualizarPorGrupo);

nombreSelect.addEventListener("change", () => {
  if (nombreSelect.value === "__otro__") {
    nombreOtro.classList.remove("hidden");
    nombreOtro.required = true;
    nombreOtro.focus();
  } else {
    nombreOtro.classList.add("hidden");
    nombreOtro.required = false;
    nombreOtro.value = "";
  }
});

function actualizarVisibilidadHoras() {
  if (situacion.value === "Publicador") {
    campoHoras.classList.add("hidden");
    horasInput.value = "";
  } else {
    campoHoras.classList.remove("hidden");
  }
}

function actualizarVisibilidadParticipacion() {
  const seleccion = form.querySelector('input[name="participo"]:checked');
  const participo = seleccion ? seleccion.value : null;

  if (participo === "Si") {
    camposParticipacion.classList.remove("hidden");
  } else {
    camposParticipacion.classList.add("hidden");
    document.getElementById("cursos").value = "";
    document.getElementById("horas").value = "";
    document.getElementById("comentarios").value = "";
  }
}

form.querySelectorAll('input[name="participo"]').forEach((radio) => {
  radio.addEventListener("change", actualizarVisibilidadParticipacion);
});

situacion.addEventListener("change", actualizarVisibilidadHoras);

function mostrarMensaje(texto, tipo) {
  mensaje.textContent = texto;
  mensaje.className = "mensaje " + tipo;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }

  if (SCRIPT_URL.includes("PEGA_AQUI")) {
    mostrarMensaje(
      "Falta configurar la URL de Google Apps Script en script.js",
      "error"
    );
    return;
  }

  const seleccion = form.querySelector('input[name="participo"]:checked');
  const participo = seleccion ? seleccion.value : "";
  const nombre =
    nombreSelect.value === "__otro__" ? nombreOtro.value.trim() : nombreSelect.value;

  const datos = new FormData();
  datos.append("grupo", grupoSelect.value);
  datos.append("nombre", nombre);
  datos.append("mes", document.getElementById("mes").value);
  datos.append("anio", document.getElementById("anio").value);
  datos.append("participo", participo);
  datos.append("situacion", situacion.value);
  datos.append(
    "cursos",
    participo === "Si" ? document.getElementById("cursos").value : ""
  );
  datos.append(
    "horas",
    participo === "Si" ? document.getElementById("horas").value : ""
  );
  datos.append(
    "comentarios",
    participo === "Si" ? document.getElementById("comentarios").value : ""
  );

  btnEnviar.disabled = true;
  mostrarMensaje("Enviando...", "");

  try {
    const respuesta = await fetch(SCRIPT_URL, {
      method: "POST",
      body: datos,
    });

    const resultado = await respuesta.json();

    if (resultado.status === "ok") {
      mostrarMensaje("¡Datos guardados correctamente!", "ok");
      form.reset();
      restoFormulario.disabled = true;
      nombreOtro.classList.add("hidden");
      camposParticipacion.classList.add("hidden");
      campoHoras.classList.remove("hidden");
      preseleccionarMesAnio();
    } else {
      throw new Error(resultado.message || "Error desconocido");
    }
  } catch (err) {
    mostrarMensaje("Hubo un error al guardar. Intentá de nuevo.", "error");
    console.error(err);
  } finally {
    btnEnviar.disabled = false;
  }
});

cargarPublicadores();
preseleccionarMesAnio();
