# Publicadores por Grupo — Informe Mensual

Widget autocontenido (`index.html`) que arma la vista por grupo a partir de un
**padrón maestro** (planilla con columnas Grupo/Nombre) y las respuestas de
los 5 formularios mensuales, muestra quién falta registrarse en el mes en
curso y grafica la situación (Precursor Regular / Precursor Auxiliar /
Publicador) por grupo y en total. Pensado para insertarse luego en un portal
más grande (ver comentarios al principio de `index.html`).

El matching de nombres y el armado de todo esto se calcula una sola vez en
`apps-script/Code.gs` y se guarda en una pestaña **"Cache"** dentro de la
planilla padrón — la pantalla normal solo lee esa caché, no reprocesa las 5
planillas en cada carga (ver "Caché de cálculos" más abajo). Además, tocando
el nombre de cualquier persona se abre su ficha: cuántas veces fue Precursor
Auxiliar, sus horas mes a mes como Precursor Regular por año de servicio
(septiembre a agosto, con el avance hacia la meta de 600 horas anuales), y su
estado — Activo / Irregular / Inactivo según su participación reciente.

## Cómo arma los grupos

El **padrón** (columnas `Grupo` y `Nombre`) es la fuente de verdad de a qué
grupo pertenece cada persona — no las 5 planillas de formulario. Las
respuestas de las 5 planillas se juntan todas y cada nombre se empareja
contra el padrón para saber a qué grupo asignarlo. Esto es a propósito:
en la práctica los grupos se reorganizan de vez en cuando y la gente sigue
llenando el mismo formulario de siempre aunque haya cambiado de grupo, así
que agrupar "por planilla" da resultados incorrectos — agrupar "por lo que
dice el padrón" es lo correcto.

## Puesta en marcha (una sola vez)

Las 6 planillas (padrón + 5 formularios) se mantienen **privadas**; los datos
se leen a través de un proxy propio en Google Apps Script que corre con tu
cuenta.

1. Andá a [script.google.com](https://script.google.com/) → **Proyecto nuevo**.
2. Reemplazá el contenido de `Code.gs` por el de [apps-script/Code.gs](apps-script/Code.gs) de esta carpeta.
3. **Configuración del proyecto** (ícono de tuerca, izquierda) → **Propiedades
   del script** → agregá una propiedad `RECOMPUTE_TOKEN` con un valor secreto
   inventado por vos (una cadena larga cualquiera). Este token protege el
   botón "Recalcular ahora" para que no lo pueda disparar cualquiera con la
   URL pública.
4. **Implementar → Nueva implementación → Aplicación web**.
   - Ejecutar como: **Yo** (tu cuenta, la que ya tiene acceso de LECTURA Y
     ESCRITURA al padrón — necesita escritura para poder crear/actualizar la
     pestaña "Cache" — y de lectura a las 5 planillas de formulario).
   - Quién tiene acceso: **Cualquier usuario** (para que `index.html` pueda
     leerlo sin pedirle login a quien lo abra). Si tu cuenta es de Google
     Workspace y preferís restringirlo a tu organización, podés probar esa
     opción, pero el navegador que abra `index.html` va a necesitar sesión
     iniciada con una cuenta de esa organización.
5. Copiá la URL que termina en `/exec`.
6. Abrí `index.html`, buscá la constante `API_URL` (o definí
   `window.PUBLICADORES_API_URL` antes de cargar el script si lo estás
   embebiendo en otro portal) y pegá ahí tu URL. Hacé lo mismo con
   `RECOMPUTE_TOKEN` → `PUBLICADORES_RECOMPUTE_TOKEN` (mismo valor que
   configuraste en el paso 3).
7. En el editor de Apps Script, elegí la función `createDailyTrigger` en el
   desplegable de funciones (arriba) y apretá **Ejecutar** una vez — instala
   un trigger diario que mantiene la caché al día solo.
7bis. (Opcional, una sola vez) Si tenés historial previo a este sistema en
   otra planilla de "resumen mensual" (columnas Persona / Mes Año /
   Situación / Participó / Horas — el número de grupo no importa, se
   resuelve contra el padrón), elegí la función `importHistoricalSummary_`
   en el desplegable y apretá **Ejecutar**. Queda guardado para siempre en
   la pestaña "Historico" del padrón; revisá el log de la ejecución (Ver →
   Registros) por si quedó algún nombre sin coincidencia. `recomputeCache`
   lo fusiona con las 5 planillas en vivo cada vez que corre (sin pisarlo:
   las planillas en vivo mandan cuando hay dato para el mismo mes).
8. Corré un primer recálculo manual: abrí `index.html` y apretá
   "⟳ Recalcular ahora" (o pegá la URL `/exec` con
   `?action=recompute&token=TU_TOKEN` directo en el navegador) para que la
   pestaña "Cache" se cree y llene por primera vez.
9. Abrí `index.html` en el navegador. Si algo no carga, mirá el aviso que
   aparece arriba de las tarjetas — indica si falló el padrón, la caché
   todavía no se generó, alguna planilla de formulario no cargó en el
   último recálculo, o si hay nombres sin coincidencia.

Cada vez que edites `Code.gs`, tenés que crear una nueva implementación (o
"Administrar implementaciones" → editar) para que el cambio se publique.

## Caché de cálculos (no se recalcula todo en cada carga de pantalla)

- **"↻ Actualizar datos"**: relee la pestaña "Cache" ya calculada + el
  padrón (rápido). Es lo que corre solo al abrir la pantalla.
- **"⟳ Recalcular ahora"**: le pide al proxy que relea las 5 planillas de
  formulario, rematchee los nombres contra el padrón y reescriba la pestaña
  "Cache" (tarda unos segundos). Además corre solo, una vez por día, por el
  trigger instalado con `createDailyTrigger`.
- La barra de estado muestra "cálculos del …" con la fecha del último
  recálculo, para saber qué tan fresca está la información.

## Ficha por persona (click en un nombre)

Cada nombre en las tarjetas (falten, sin actividad, o en la lista completa
de "Integrantes del grupo") es clicable y abre su ficha con:

- **Estado** — Activo / Irregular / Inactivo, según los últimos 6 meses con
  datos: 6 meses seguidos sin participar → Inactivo; 2 o más meses sin
  participar en esa ventana (seguidos o alternados con meses sí) →
  Irregular. Con menos de 2 meses de historial propio no se marca ningún
  estado.
- **Precursor Auxiliar** — cuántas veces (meses) figuró en esa situación.
- **Precursor Regular** — desde cuándo y cuántos meses en total, más una
  tabla de horas mes a mes por año de servicio (septiembre a agosto). Si el
  año de servicio en curso tiene datos, se muestra cuántas horas lleva y
  cuántas le faltan para la meta de 600 horas anuales.
- **Historial completo** — tabla cronológica de todos los meses informados.

## Qué asume la lógica

- **Grupos y quién pertenece a cada uno**: salen 100% del padrón (columna
  `Grupo`). Si el padrón no carga, no se puede armar ninguna tarjeta.
- **Coincidencia de nombres** entre las planillas de formulario y el padrón:
  primero exacta (ignorando acentos/mayúsculas), después por "nombre
  acortado" (p. ej. "Teresa Zulueta" contra "Teresa Zulueta de Cabrera", o
  "Carlos Fernández" contra "Carlos Esteban Fernández Zamora" — con un único
  candidato posible), y por último tolerancia a 1-4 letras de diferencia por
  tipeo. Si ninguna estrategia encuentra una coincidencia razonable, el
  nombre queda en la lista de "sin coincidencia" (se muestra como aviso en la
  pantalla) — no se arriesga a asignarlo a un grupo por las dudas.
  **Los apodos no se resuelven solos** (por ejemplo "Bety" vs "Beatriz"): si
  aparecen en el aviso de "sin coincidencia", lo más simple es escribir el
  padrón con el mismo nombre que la persona usa al llenar el formulario.
- **Situación**: se agrupan "Precursor Auxiliar 15 horas" y "... 30 horas" en
  un solo bucket "Precursor Auxiliar" para el gráfico.
- Filas del padrón como "No publicadora" se ignoran (no son una persona a
  trackear); un nombre con un sufijo tipo "- menor" se matchea solo por la
  parte antes del guion pero se muestra completo.
- Los nombres mostrados en cada tarjeta ("Grupo 1"…"Grupo 5" por defecto, uno
  por cada número de grupo que aparezca en el padrón) son editables haciendo
  clic y se guardan en el navegador (localStorage).

## Archivos

- `index.html` — la app completa (HTML + CSS + JS), lista para embeber.
- `apps-script/Code.gs` — el proxy de Apps Script, con instrucciones de
  despliegue en su propio encabezado.
