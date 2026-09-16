# Formulario de Predicación → Google Sheets

## Archivos
- `index.html`, `style.css`, `script.js`: el formulario web.
- `Code.gs`: script de Google Apps Script que guarda las respuestas y expone la lista de publicadores por grupo.

## Pasos para conectarlo con Google Sheets
//https://script.google.com/macros/s/AKfycbw2JbkSnWsDmsPul0RLLNJiFgRAgQTQMXZspaNdMCePgfPMPjIGrslG0oqiNTumRs6i/exec"
1. **Recomendado:** abrí la planilla de [Publicadores](https://docs.google.com/spreadsheets/d/10iAtM2jSdqSOZ6ot0u-OILEm58BrO9dbnK_Lp4ks3qk) (la misma que ya usás) y desplegá el script desde ahí, así todo queda centralizado. Si preferís guardar las respuestas en otra planilla, cambiá el ID de `ID_PLANILLA_PUBLICADORES` en `Code.gs` por el de esta planilla de Publicadores.
2. Andá a **Extensiones > Apps Script**.
3. Borrá el contenido por defecto y pegá el contenido de `Code.gs`.
4. Guardá el proyecto (ícono de disquete).
5. Hacé clic en **Desplegar > Nueva implementación**.
   - Tipo: **Aplicación web**.
   - Ejecutar como: **Yo (tu cuenta)**.
   - Quién tiene acceso: **Cualquier usuario**.
6. Autorizá los permisos cuando te lo pida (es tu propio script).
7. Copiá la **URL de la aplicación web** que te da (termina en `/exec`).
8. Abrí `script.js` y reemplazá:
   ```js
   const SCRIPT_URL = "PEGA_AQUI_LA_URL_DE_TU_APPS_SCRIPT";
   ```
   por la URL copiada.
9. Abrí `index.html` en el navegador (o subilo a un hosting) y probá el formulario: al elegir un grupo debería aparecer la lista de publicadores de ese grupo.

Cada envío agrega una fila a una hoja llamada **"Respuestas"** en la planilla donde está desplegado el script (la crea sola si no existe, con encabezados), incluyendo el número de grupo.

## De dónde sale la lista de grupos y publicadores
`Code.gs` lee la pestaña **"Publicadores"** de la planilla con ID `10iAtM2jSdqSOZ6ot0u-OILEm58BrO9dbnK_Lp4ks3qk` (la que compartiste), asumiendo:
- Fila 1 = encabezados (se ignora).
- Columna A = número de grupo.
- Columna B = nombre y apellido.

Si esa estructura cambia, hay que ajustar `obtenerPublicadores()` en `Code.gs`.

## Comportamiento del formulario
- El **Número de grupo** es el primer campo y es un desplegable armado con los grupos que existen en la pestaña "Publicadores".
- El resto del formulario está **deshabilitado hasta elegir un grupo**.
- Al elegir el grupo, el campo **Nombre y Apellido** se completa automáticamente con los publicadores de ese grupo (ordenados alfabéticamente). Incluye una opción **"Otro (no está en la lista)"** que habilita un campo de texto libre, por si falta alguien.
- **Mes** y **Año** están en la misma fila.
- Si se responde **"No"** a "¿Participó en alguna faceta de la predicación durante el mes?", se ocultan automáticamente los campos: Situación, Número de cursos bíblicos dirigidos, Horas y Comentarios, y no se envían datos en esos campos.
- Si se responde **"Si"**, esos campos se muestran y **Situación** pasa a ser obligatorio.

## Nota sobre cada vez que cambies `Code.gs`
Si modificás `Code.gs` después de desplegar, tenés que hacer **Desplegar > Gestionar implementaciones > editar (lápiz) > Nueva versión** para que los cambios se apliquen a la URL ya publicada.
