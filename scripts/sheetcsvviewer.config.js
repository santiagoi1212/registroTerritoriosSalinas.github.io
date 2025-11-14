// scripts/sheetcsvviewer.config.js
// Config para cargar y mostrar revisitas/estudios desde CSV publicado
window.SheetCSVViewerConfig = {
  DATA_SOURCE_TYPE: "csv", // "csv" | "json"
  DATA_URL: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTSvBzDVAWYEzWy73reop1_EtUdkXyGNq5KhpIMzbQLredIkKnJxTgstyHzPfZKhLI_23iggIlYXqUR/pub?gid=1217453780&single=true&output=csv",
  // Ajustá estos nombres a las columnas reales de tu sheet
  MAP: {
    tipo: "Tipo",
    nombre: "Nombre",
    telefono: "Telefono",     // o "Teléfono"
    direccion: "Direccion",
    notas: "Notas",
    lat: "Lat",
    lng: "Lng",
    fecha: "Fecha"
  }
};
