// ===================================================
// CONFIGURACIÓN GOOGLE SHEETS
// Pegá la URL de tu Google Apps Script Web App aquí
// ===================================================
const SHEETS_WEBAPP_URL = '';

// ===================================================
// ESTADO GLOBAL
// ===================================================
let state = {
  currentUser: null,
  personas: [],
  cronogramas: [],
  editingCronogramaId: null,
  previewData: null
};

// ===================================================
// USUARIOS
// ===================================================
const USERS = [
  { username: 'admin', password: 'admin123', role: 'administrador', nombre: 'Administrador' },
  { username: 'vedor', password: 'vedor123', role: 'vedor', nombre: 'Veedor' }
];

const DEPARTAMENTOS = ['Acomodadores', 'Audio y Video', 'Presidencia', 'Conferencia', 'Estudio Atalaya'];

// ===================================================
// LOCAL STORAGE
// ===================================================
function saveLocal() {
  localStorage.setItem('gestion_personas', JSON.stringify(state.personas));
  localStorage.setItem('gestion_cronogramas', JSON.stringify(state.cronogramas));
}

function loadLocal() {
  const p = localStorage.getItem('gestion_personas');
  const c = localStorage.getItem('gestion_cronogramas');
  state.personas = p ? JSON.parse(p) : getSamplePersonas();
  state.cronogramas = c ? JSON.parse(c) : [];
}

function getSamplePersonas() {
  return [
    { id: '1', nombre: 'Juan', apellido: 'Pérez', celular: '5491112345001', departamentos: ['Acomodadores', 'Presidencia'], rolesAcomo: ['Entrada', 'Auditorio'], rolesAV: [], rolesAtalaya: [], ultimaAsignacion: null },
    { id: '2', nombre: 'María', apellido: 'García', celular: '5491112345002', departamentos: ['Acomodadores', 'Estudio Atalaya'], rolesAcomo: ['Micrófono 1', 'Micrófono 2'], rolesAV: [], rolesAtalaya: ['Lector'], ultimaAsignacion: null },
    { id: '3', nombre: 'Carlos', apellido: 'López', celular: '5491112345003', departamentos: ['Audio y Video'], rolesAcomo: [], rolesAV: ['PC', 'Audio'], rolesAtalaya: [], ultimaAsignacion: null },
    { id: '4', nombre: 'Ana', apellido: 'Martínez', celular: '5491112345004', departamentos: ['Acomodadores', 'Audio y Video'], rolesAcomo: ['Entrada'], rolesAV: ['Plataforma'], rolesAtalaya: [], ultimaAsignacion: null },
    { id: '5', nombre: 'Pedro', apellido: 'Rodríguez', celular: '5491112345005', departamentos: ['Presidencia', 'Acomodadores', 'Estudio Atalaya'], rolesAcomo: ['Auditorio'], rolesAV: [], rolesAtalaya: ['Conductor'], ultimaAsignacion: null },
    { id: '6', nombre: 'Laura', apellido: 'Sánchez', celular: '5491112345006', departamentos: ['Audio y Video', 'Conferencia'], rolesAcomo: [], rolesAV: ['PC', 'Plataforma'], rolesAtalaya: [], ultimaAsignacion: null },
    { id: '7', nombre: 'Martín', apellido: 'González', celular: '', departamentos: ['Acomodadores', 'Conferencia'], rolesAcomo: ['Micrófono 1', 'Micrófono 2'], rolesAV: [], rolesAtalaya: [], ultimaAsignacion: null },
    { id: '8', nombre: 'Sofía', apellido: 'Fernández', celular: '5491112345008', departamentos: ['Presidencia', 'Estudio Atalaya'], rolesAcomo: [], rolesAV: [], rolesAtalaya: ['Conductor', 'Lector'], ultimaAsignacion: null },
    { id: '9', nombre: 'Diego', apellido: 'Herrera', celular: '5491112345009', departamentos: ['Audio y Video', 'Estudio Atalaya'], rolesAcomo: [], rolesAV: ['Audio', 'PC'], rolesAtalaya: ['Conductor'], ultimaAsignacion: null },
    { id: '10', nombre: 'Valentina', apellido: 'Torres', celular: '5491112345010', departamentos: ['Acomodadores', 'Estudio Atalaya'], rolesAcomo: ['Entrada', 'Auditorio'], rolesAV: [], rolesAtalaya: ['Lector'], ultimaAsignacion: null },
  ];
}

// ===================================================
// GOOGLE SHEETS
// ===================================================
async function sheetsRequest(action, data = {}) {
  if (!SHEETS_WEBAPP_URL) return null;
  try {
    const res = await fetch(SHEETS_WEBAPP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...data })
    });
    return await res.json();
  } catch (e) {
    console.warn('Sheets no disponible:', e.message);
    return null;
  }
}

async function loadData() {
  const result = await sheetsRequest('getAll');
  if (result && result.personas) {
    state.personas = result.personas;
    state.cronogramas = result.cronogramas || [];
  } else {
    loadLocal();
  }
}

async function saveData() {
  saveLocal();
  await sheetsRequest('saveAll', { personas: state.personas, cronogramas: state.cronogramas });
}

// ===================================================
// AUTH
// ===================================================
function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('loginUser').value.trim();
  const password = document.getElementById('loginPass').value;
  const user = USERS.find(u => u.username === username && u.password === password);
  if (!user) { document.getElementById('loginError').classList.remove('hidden'); return; }
  state.currentUser = user;
  document.getElementById('loginError').classList.add('hidden');
  initApp();
}

function handleLogout() {
  state.currentUser = null;
  document.getElementById('page-login').classList.add('active');
  document.getElementById('page-app').classList.remove('active');
  document.getElementById('loginForm').reset();
}

async function initApp() {
  document.getElementById('page-login').classList.remove('active');
  document.getElementById('page-app').classList.add('active');
  const u = state.currentUser;
  document.getElementById('navAvatar').textContent = u.nombre[0].toUpperCase();
  document.getElementById('topbarAvatar').textContent = u.nombre[0].toUpperCase();
  document.getElementById('navUsername').textContent = u.nombre;
  document.getElementById('navRole').textContent = u.role === 'administrador' ? 'Administrador' : 'Veedor';
  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = u.role === 'administrador' ? '' : 'none';
  });
  await loadData();
  populateMonthFilter();
  navigateTo('cronograma');
  setupNavListeners();
}

// ===================================================
// NAV
// ===================================================
function setupNavListeners() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault();
      navigateTo(item.dataset.view);
      if (window.innerWidth <= 768) toggleSidebar(false);
    });
  });
}

function navigateTo(view) {
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const navItem = document.querySelector(`[data-view="${view}"]`);
  if (navItem) navItem.classList.add('active');
  if (view === 'cronograma') { document.getElementById('view-cronograma').classList.add('active'); renderCronogramaList(); }
  else if (view === 'cronograma-detalle') { document.getElementById('view-cronograma-detalle').classList.add('active'); }
  else if (view === 'personas') { document.getElementById('view-personas').classList.add('active'); renderPersonasList(); }
  else if (view === 'departamentos') { document.getElementById('view-departamentos').classList.add('active'); renderDepartamentos(); }
}

function toggleSidebar(force) {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  const shouldOpen = force !== undefined ? force : !sidebar.classList.contains('open');
  sidebar.classList.toggle('open', shouldOpen);
  overlay.classList.toggle('open', shouldOpen);
}

// ===================================================
// MONTH FILTER
// ===================================================
function populateMonthFilter() {
  const sel = document.getElementById('filterMonth');
  const prev = sel.value;
  sel.innerHTML = '';
  const months = new Set();
  state.cronogramas.forEach(c => months.add(c.mes));
  const now = new Date();
  for (let i = -1; i <= 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    months.add(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
  }
  const currentKey = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  [...months].sort().forEach(m => {
    const [yr, mo] = m.split('-');
    const label = new Date(yr, mo-1, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = label.charAt(0).toUpperCase() + label.slice(1);
    if (m === (prev || currentKey)) opt.selected = true;
    sel.appendChild(opt);
  });
}

// ===================================================
// CRONOGRAMA LIST
// ===================================================
function renderCronogramaList() {
  const mes = document.getElementById('filterMonth').value;
  const container = document.getElementById('cronograma-list');
  const cronos = state.cronogramas.filter(c => c.mes === mes).sort((a,b) => a.fechaInicio.localeCompare(b.fechaInicio));
  if (cronos.length === 0) {
    container.innerHTML = `<div class="empty-state">No hay cronogramas para este mes.${state.currentUser.role === 'administrador' ? ' Hacé clic en "+ Generar".' : ''}</div>`;
    return;
  }
  container.innerHTML = cronos.map(c => {
    const [yr, mo, dy] = c.fechaInicio.split('-');
    const inicio = new Date(yr, mo-1, parseInt(dy));
    const fin = new Date(yr, mo-1, parseInt(dy)+1);
    const label = `${inicio.toLocaleDateString('es-ES',{day:'numeric',month:'short'})} – ${fin.toLocaleDateString('es-ES',{day:'numeric',month:'short',year:'numeric'})}`;
    const isAdmin = state.currentUser.role === 'administrador';
    return `
      <div class="cronograma-card" onclick="openCronogramaDetalle('${c.id}')">
        <div class="week-label">Fin de semana</div>
        <div class="week-date">${label}</div>
        <div class="dept-pills">
          <span class="dept-pill Acomodadores">Acomodadores</span>
          <span class="dept-pill AudioVideo">Audio y Video</span>
          <span class="dept-pill Presidencia">Presidencia</span>
          <span class="dept-pill Conferencia">Conferencia</span>
          <span class="dept-pill EstudioAtalaya">Atalaya</span>
        </div>
        ${isAdmin ? `<div class="card-footer-actions" onclick="event.stopPropagation()">
          <button class="btn-icon" onclick="openCronogramaDetalle('${c.id}')" title="Ver detalle">👁</button>
          <button class="btn-icon danger" onclick="deleteCronograma('${c.id}')" title="Eliminar">🗑</button>
        </div>` : ''}
      </div>`;
  }).join('');
}

// ===================================================
// DETALLE
// ===================================================
function openCronogramaDetalle(id) {
  state.editingCronogramaId = id;
  const crono = state.cronogramas.find(c => c.id === id);
  if (!crono) return;
  const [yr, mo, dy] = crono.fechaInicio.split('-');
  const inicio = new Date(yr, mo-1, parseInt(dy));
  const fin = new Date(yr, mo-1, parseInt(dy)+1);
  document.getElementById('detalle-titulo').textContent = `Fin de semana`;
  document.getElementById('detalle-fecha').textContent =
    `${inicio.toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long'})} – ${fin.toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}`;
  renderDetalleContent(crono);
  navigateTo('cronograma-detalle');
}

function renderDetalleContent(crono) {
  const container = document.getElementById('detalle-content');
  container.innerHTML = `<div class="detalle-grid">
    ${renderDeptCard('Acomodadores', crono.acomodadores, ['Entrada','Auditorio','Micrófono 1','Micrófono 2'])}
    ${renderDeptCard('Audio y Video', crono.audioVideo, ['PC','Audio','Plataforma'], 'AudioVideo')}
    ${renderDeptCard('Presidencia', crono.presidencia, ['Presidente'])}
    ${renderConferenciaCard(crono.conferencia)}
    ${renderAtalayaCard(crono)}
  </div>`;
}

function renderDeptCard(nombre, asigs, puestos, cssClass) {
  const cls = cssClass || nombre.replace(/ /g,'');
  return `<div class="dept-card ${cls}">
    <div class="dept-card-header"><span class="dot"></span>${nombre}</div>
    <div class="dept-card-body">
      ${puestos.map(p => {
        const id = asigs && asigs[p];
        const persona = id ? getPersonaNombre(id) : '—';
        return `<div class="asig-row"><div><div class="asig-role">${p}</div><div class="asig-name">${persona}</div></div></div>`;
      }).join('')}
    </div>
  </div>`;
}

function renderConferenciaCard(conferencias) {
  const lista = conferencias && conferencias.length
    ? conferencias.map(id => `<div class="asig-row"><div class="asig-name">${getPersonaNombre(id)}</div></div>`).join('')
    : '<div class="asig-row"><div class="asig-name" style="color:var(--text-secondary)">Sin conferenciantes</div></div>';
  return `<div class="dept-card Conferencia">
    <div class="dept-card-header"><span class="dot"></span>Conferencia</div>
    <div class="dept-card-body">${lista}</div>
  </div>`;
}

function renderAtalayaCard(crono) {
  const at = crono.atalaya || {};
  const conductor = at.conductorActivo || at.conductorTitular;
  const isSuplente = conductor && conductor !== at.conductorTitular;
  const lector = at.lector;
  const isAdmin = state.currentUser.role === 'administrador';

  const conductorHTML = conductor
    ? `<div class="asig-name">${getPersonaNombre(conductor)}
        <span class="${isSuplente ? 'badge-suplente' : 'badge-titular'}">${isSuplente ? 'Suplente' : 'Titular'}</span>
        ${isAdmin ? `<button class="btn-icon" style="margin-left:0.4rem;font-size:0.7rem" onclick="openAtalayaModal()" title="Cambiar">✎</button>` : ''}
       </div>`
    : `<div class="asig-name" style="color:var(--text-secondary)">—${isAdmin ? ` <button class="btn-icon" style="margin-left:0.4rem;font-size:0.7rem" onclick="openAtalayaModal()">✎</button>` : ''}</div>`;

  return `<div class="dept-card EstudioAtalaya">
    <div class="dept-card-header"><span class="dot"></span>Estudio Atalaya</div>
    <div class="dept-card-body">
      <div class="asig-row">
        <div><div class="asig-role">Conductor</div>${conductorHTML}</div>
      </div>
      <div class="asig-row">
        <div><div class="asig-role">Lector</div><div class="asig-name">${lector ? getPersonaNombre(lector) : '—'}</div></div>
      </div>
    </div>
  </div>`;
}

function getPersonaNombre(id) {
  const p = state.personas.find(x => x.id === id);
  return p ? `${p.nombre} ${p.apellido}` : '—';
}

// ===================================================
// ATALAYA MODAL — TITULAR Y SUPLENTES
// ===================================================
function openAtalayaModal() {
  const crono = state.cronogramas.find(c => c.id === state.editingCronogramaId);
  if (!crono) return;
  const at = crono.atalaya || {};
  const conductores = state.personas.filter(p => p.departamentos.includes('Estudio Atalaya') && (p.rolesAtalaya || []).includes('Conductor'));
  const activeId = at.conductorActivo || at.conductorTitular || '';

  const content = document.getElementById('atalaya-suplente-content');
  content.innerHTML = conductores.length === 0
    ? '<p class="info-text">No hay personas habilitadas como Conductor en Estudio Atalaya.</p>'
    : conductores.map((p, i) => `
        <label class="atalaya-role-row ${at.conductorTitular === p.id ? '' : ''}" id="atalaya-row-${p.id}">
          <input type="radio" name="atalaya-conductor" value="${p.id}" ${activeId === p.id ? 'checked' : ''} />
          <div style="flex:1">
            <div style="font-weight:600">${p.nombre} ${p.apellido}</div>
          </div>
          ${at.conductorTitular === p.id ? '<span class="atalaya-position-label">Titular asignado</span>' : ''}
          ${at.suplentes && at.suplentes.includes(p.id) ? '<span class="atalaya-position-label">Suplente</span>' : ''}
        </label>`).join('')
    + `<hr style="margin:1rem 0;border:none;border-top:1px solid var(--border)">
      <p class="info-text" style="margin-bottom:0.75rem">¿Querés cambiar el titular para futuras generaciones?</p>
      <select id="atalaya-titular-select" class="select-input" style="width:100%">
        ${conductores.map(p => `<option value="${p.id}" ${at.conductorTitular === p.id ? 'selected' : ''}>${p.nombre} ${p.apellido}</option>`).join('')}
      </select>`;

  document.getElementById('modal-atalaya').classList.remove('hidden');
}

function saveAtalayaSuplente() {
  const crono = state.cronogramas.find(c => c.id === state.editingCronogramaId);
  if (!crono) return;
  const selected = document.querySelector('[name="atalaya-conductor"]:checked');
  const titularSelect = document.getElementById('atalaya-titular-select');
  if (!crono.atalaya) crono.atalaya = {};
  if (selected) crono.atalaya.conductorActivo = selected.value;
  if (titularSelect) crono.atalaya.conductorTitular = titularSelect.value;
  saveData();
  closeModal('modal-atalaya');
  renderDetalleContent(crono);
  showToast('Conductor actualizado', 'success');
}

// ===================================================
// EDITAR CRONOGRAMA
// ===================================================
function editCronograma() {
  const crono = state.cronogramas.find(c => c.id === state.editingCronogramaId);
  if (!crono) return;
  const puestosAcomo = ['Entrada','Auditorio','Micrófono 1','Micrófono 2'];
  const puestosAV = ['PC','Audio','Plataforma'];
  const personasAcomo = state.personas.filter(p => p.departamentos.includes('Acomodadores'));
  const personasAV = state.personas.filter(p => p.departamentos.includes('Audio y Video'));
  const personasPres = state.personas.filter(p => p.departamentos.includes('Presidencia'));
  const personasConf = state.personas.filter(p => p.departamentos.includes('Conferencia'));
  const personasAtCond = state.personas.filter(p => p.departamentos.includes('Estudio Atalaya') && (p.rolesAtalaya||[]).includes('Conductor'));
  const personasAtLect = state.personas.filter(p => p.departamentos.includes('Estudio Atalaya') && (p.rolesAtalaya||[]).includes('Lector'));
  const at = crono.atalaya || {};

  const safeId = s => s.replace(/\s/g,'_').replace(/[áéíóú]/g, c => ({á:'a',é:'e',í:'i',ó:'o',ú:'u'}[c]||c));
  const optionsFor = (list, current) => `<option value="">— Sin asignar —</option>${list.map(x => `<option value="${x.id}" ${current===x.id?'selected':''}>${x.nombre} ${x.apellido}</option>`).join('')}`;

  document.getElementById('editar-asig-content').innerHTML = `
    <div class="edit-asig-section">
      <h4>Acomodadores</h4>
      ${puestosAcomo.map(p => `<div class="edit-asig-row"><label>${p}</label><select id="edit-acomo-${safeId(p)}">${optionsFor(personasAcomo, crono.acomodadores?.[p])}</select></div>`).join('')}
    </div>
    <div class="edit-asig-section">
      <h4>Audio y Video</h4>
      ${puestosAV.map(p => `<div class="edit-asig-row"><label>${p}</label><select id="edit-av-${p}">${optionsFor(personasAV, crono.audioVideo?.[p])}</select></div>`).join('')}
    </div>
    <div class="edit-asig-section">
      <h4>Presidencia</h4>
      <div class="edit-asig-row"><label>Presidente</label><select id="edit-pres">${optionsFor(personasPres, crono.presidencia?.Presidente)}</select></div>
    </div>
    <div class="edit-asig-section">
      <h4>Conferencia</h4>
      <div class="checkbox-group" style="padding:0.25rem 0 0.5rem">
        ${personasConf.map(x => `<label class="checkbox-item"><input type="checkbox" name="editConf" value="${x.id}" ${crono.conferencia?.includes(x.id)?'checked':''}/>${x.nombre} ${x.apellido}</label>`).join('')}
      </div>
    </div>
    <div class="edit-asig-section">
      <h4>Estudio Atalaya</h4>
      <div class="edit-asig-row"><label>Conductor</label><select id="edit-at-conductor">${optionsFor(personasAtCond, at.conductorActivo||at.conductorTitular)}</select></div>
      <div class="edit-asig-row"><label>Lector</label><select id="edit-at-lector">${optionsFor(personasAtLect, at.lector)}</select></div>
      <div class="edit-asig-row" style="margin-top:0.4rem">
        <label style="width:auto;font-size:0.75rem;color:var(--text-secondary)">Suplentes Conductor:</label>
      </div>
      <div class="checkbox-group" style="padding-bottom:0.5rem">
        ${personasAtCond.map(x => `<label class="checkbox-item"><input type="checkbox" name="editAtSup" value="${x.id}" ${at.suplentes?.includes(x.id)?'checked':''}/>${x.nombre} ${x.apellido}</label>`).join('')}
      </div>
    </div>`;

  document.getElementById('modal-editar-asig').classList.remove('hidden');
}

function saveEditedAsignacion() {
  const crono = state.cronogramas.find(c => c.id === state.editingCronogramaId);
  if (!crono) return;
  const safeId = s => s.replace(/\s/g,'_').replace(/[áéíóú]/g, c => ({á:'a',é:'e',í:'i',ó:'o',ú:'u'}[c]||c));
  const puestosAcomo = ['Entrada','Auditorio','Micrófono 1','Micrófono 2'];
  const puestosAV = ['PC','Audio','Plataforma'];

  crono.acomodadores = {};
  puestosAcomo.forEach(p => { const v = document.getElementById(`edit-acomo-${safeId(p)}`)?.value; if(v) crono.acomodadores[p]=v; });
  crono.audioVideo = {};
  puestosAV.forEach(p => { const v = document.getElementById(`edit-av-${p}`)?.value; if(v) crono.audioVideo[p]=v; });
  crono.presidencia = {};
  const pres = document.getElementById('edit-pres')?.value;
  if (pres) crono.presidencia.Presidente = pres;
  crono.conferencia = Array.from(document.querySelectorAll('[name="editConf"]:checked')).map(c => c.value);
  if (!crono.atalaya) crono.atalaya = {};
  const atCond = document.getElementById('edit-at-conductor')?.value;
  const atLect = document.getElementById('edit-at-lector')?.value;
  if (atCond) { crono.atalaya.conductorTitular = atCond; crono.atalaya.conductorActivo = atCond; }
  if (atLect) crono.atalaya.lector = atLect;
  crono.atalaya.suplentes = Array.from(document.querySelectorAll('[name="editAtSup"]:checked')).map(c => c.value);

  saveData();
  closeModal('modal-editar-asig');
  renderDetalleContent(crono);
  showToast('Asignaciones guardadas', 'success');
}

// ===================================================
// GENERAR CRONOGRAMA
// ===================================================
function openGenerarModal() {
  const now = new Date();
  document.getElementById('generar-mes').value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  document.getElementById('modal-generar').classList.remove('hidden');
}

function getWeekends(year, month) {
  const weekends = [], d = new Date(year, month-1, 1);
  while (d.getMonth() === month-1) {
    if (d.getDay() === 6) weekends.push(new Date(d));
    d.setDate(d.getDate()+1);
  }
  return weekends;
}

function sortByLastAssignment(personas) {
  return [...personas].sort((a,b) => {
    if (!a.ultimaAsignacion && !b.ultimaAsignacion) return 0;
    if (!a.ultimaAsignacion) return -1;
    if (!b.ultimaAsignacion) return 1;
    return new Date(a.ultimaAsignacion) - new Date(b.ultimaAsignacion);
  });
}

function generarCronograma() {
  const mesVal = document.getElementById('generar-mes').value;
  if (!mesVal) { showToast('Seleccioná un mes', 'error'); return; }
  const [year, month] = mesVal.split('-').map(Number);
  const weekends = getWeekends(year, month);
  state.cronogramas = state.cronogramas.filter(c => c.mes !== mesVal);

  weekends.forEach(saturday => {
    const fechaStr = saturday.toISOString().split('T')[0];
    const excludeIds = new Set();

    // CONFERENCIA (van primero para excluirlos)
    const confPool = sortByLastAssignment(state.personas.filter(p => p.departamentos.includes('Conferencia')));
    const conferencia = confPool.slice(0, Math.min(2, confPool.length)).map(p => p.id);
    conferencia.forEach(id => excludeIds.add(id));

    // ACOMODADORES
    const acomoPool = sortByLastAssignment(state.personas.filter(p => p.departamentos.includes('Acomodadores') && !excludeIds.has(p.id)));
    const acomodadores = {};
    ['Entrada','Auditorio','Micrófono 1','Micrófono 2'].forEach(puesto => {
      const c = acomoPool.find(p => !excludeIds.has(p.id) && (p.rolesAcomo||[]).includes(puesto))
              || acomoPool.find(p => !excludeIds.has(p.id));
      if (c) { acomodadores[puesto] = c.id; excludeIds.add(c.id); }
    });

    // AUDIO Y VIDEO
    const avPool = sortByLastAssignment(state.personas.filter(p => p.departamentos.includes('Audio y Video') && !excludeIds.has(p.id)));
    const audioVideo = {};
    ['PC','Audio','Plataforma'].forEach(puesto => {
      const c = avPool.find(p => !excludeIds.has(p.id) && (p.rolesAV||[]).includes(puesto))
              || avPool.find(p => !excludeIds.has(p.id));
      if (c) { audioVideo[puesto] = c.id; excludeIds.add(c.id); }
    });

    // PRESIDENCIA
    const presPool = sortByLastAssignment(state.personas.filter(p => p.departamentos.includes('Presidencia') && !excludeIds.has(p.id)));
    const presidencia = {};
    if (presPool.length > 0) { presidencia.Presidente = presPool[0].id; excludeIds.add(presPool[0].id); }

    // ESTUDIO ATALAYA
    const atConductores = sortByLastAssignment(state.personas.filter(p => p.departamentos.includes('Estudio Atalaya') && (p.rolesAtalaya||[]).includes('Conductor') && !excludeIds.has(p.id)));
    const atLectores = sortByLastAssignment(state.personas.filter(p => p.departamentos.includes('Estudio Atalaya') && (p.rolesAtalaya||[]).includes('Lector') && !excludeIds.has(p.id)));
    const atalaya = {};
    if (atConductores.length > 0) {
      atalaya.conductorTitular = atConductores[0].id;
      atalaya.conductorActivo = atConductores[0].id;
      atalaya.suplentes = atConductores.slice(1,3).map(p => p.id);
      excludeIds.add(atConductores[0].id);
    }
    if (atLectores.length > 0) {
      atalaya.lector = atLectores[0].id;
      excludeIds.add(atLectores[0].id);
    }

    // Actualizar ultima asignación
    [...Object.values(acomodadores), ...Object.values(audioVideo), ...Object.values(presidencia), ...conferencia,
     atalaya.conductorTitular, atalaya.lector].filter(Boolean).forEach(id => {
      const p = state.personas.find(x => x.id === id);
      if (p) p.ultimaAsignacion = fechaStr;
    });

    state.cronogramas.push({
      id: `cron-${Date.now()}-${saturday.getDate()}`,
      mes: mesVal, fechaInicio: fechaStr,
      acomodadores, audioVideo, presidencia, conferencia, atalaya
    });
  });

  saveData();
  populateMonthFilter();
  document.getElementById('filterMonth').value = mesVal;
  closeModal('modal-generar');
  renderCronogramaList();
  showToast(`✓ ${weekends.length} cronograma(s) generado(s)`, 'success');
}

// ===================================================
// DELETE CRONOGRAMA
// ===================================================
function deleteCronogramaActual() {
  if (!confirm('¿Eliminar este cronograma?')) return;
  deleteCronograma(state.editingCronogramaId, true);
}

function deleteCronograma(id, goBack = false) {
  if (!confirm('¿Eliminar este cronograma?')) return;
  state.cronogramas = state.cronogramas.filter(c => c.id !== id);
  saveData();
  if (goBack) navigateTo('cronograma');
  else renderCronogramaList();
  showToast('Cronograma eliminado');
}

// ===================================================
// IMPRIMIR Y VISTA PREVIA
// ===================================================
function buildPrintHTML(cronos, titulo) {
  return `
    <div class="preview-header-print">
      <div style="font-size:1.5rem;color:var(--accent);font-family:var(--font-display)">✦</div>
      <h1>${titulo}</h1>
      <p>Generado el ${new Date().toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</p>
    </div>
    ${cronos.map(c => {
      const [yr,mo,dy] = c.fechaInicio.split('-');
      const inicio = new Date(yr,mo-1,parseInt(dy));
      const fin = new Date(yr,mo-1,parseInt(dy)+1);
      const label = `${inicio.toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long'})} – ${fin.toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}`;
      const at = c.atalaya || {};
      const conductorId = at.conductorActivo || at.conductorTitular;
      return `
        <div class="preview-dept-section" style="margin-bottom:1.5rem">
          <div style="font-family:var(--font-display);font-size:1.1rem;margin-bottom:0.75rem;padding-bottom:0.4rem;border-bottom:1.5px solid var(--border)">${label}</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:0.75rem">
            ${buildDeptTable('Acomodadores','Acomodadores',['Entrada','Auditorio','Micrófono 1','Micrófono 2'],c.acomodadores)}
            ${buildDeptTable('AudioVideo','Audio y Video',['PC','Audio','Plataforma'],c.audioVideo)}
            ${buildDeptTable('Presidencia','Presidencia',['Presidente'],c.presidencia)}
            ${buildConfTable(c.conferencia)}
            ${buildAtalayaTable(at,conductorId)}
          </div>
        </div>`;
    }).join('')}`;
}

function buildDeptTable(cls, nombre, puestos, asigs) {
  return `<div class="preview-dept-section">
    <div class="preview-dept-title ${cls}">${nombre}</div>
    <table class="preview-table">
      <thead><tr><th>Puesto</th><th>Persona</th></tr></thead>
      <tbody>${puestos.map(p => `<tr><td>${p}</td><td>${asigs&&asigs[p]?getPersonaNombre(asigs[p]):'—'}</td></tr>`).join('')}</tbody>
    </table>
  </div>`;
}

function buildConfTable(conferencia) {
  return `<div class="preview-dept-section">
    <div class="preview-dept-title Conferencia">Conferencia</div>
    <table class="preview-table">
      <thead><tr><th>Conferenciante</th></tr></thead>
      <tbody>${conferencia&&conferencia.length?conferencia.map(id=>`<tr><td>${getPersonaNombre(id)}</td></tr>`).join(''):'<tr><td>—</td></tr>'}</tbody>
    </table>
  </div>`;
}

function buildAtalayaTable(at, conductorId) {
  const isSup = conductorId && conductorId !== at.conductorTitular;
  return `<div class="preview-dept-section">
    <div class="preview-dept-title EstudioAtalaya">Estudio Atalaya</div>
    <table class="preview-table">
      <thead><tr><th>Puesto</th><th>Persona</th></tr></thead>
      <tbody>
        <tr><td>Conductor${isSup?' <em>(suplente)</em>':''}</td><td>${conductorId?getPersonaNombre(conductorId):'—'}</td></tr>
        <tr><td>Lector</td><td>${at.lector?getPersonaNombre(at.lector):'—'}</td></tr>
      </tbody>
    </table>
  </div>`;
}

function printSemana() {
  const crono = state.cronogramas.find(c => c.id === state.editingCronogramaId);
  if (!crono) return;
  const [yr,mo,dy] = crono.fechaInicio.split('-');
  const inicio = new Date(yr,mo-1,parseInt(dy));
  const fin = new Date(yr,mo-1,parseInt(dy)+1);
  const titulo = `${inicio.toLocaleDateString('es-ES',{day:'numeric',month:'long'})} – ${fin.toLocaleDateString('es-ES',{day:'numeric',month:'long',year:'numeric'})}`;
  showPreview([crono], titulo);
}

function printMes() {
  const mes = document.getElementById('filterMonth').value;
  const cronos = state.cronogramas.filter(c => c.mes === mes).sort((a,b) => a.fechaInicio.localeCompare(b.fechaInicio));
  if (cronos.length === 0) { showToast('No hay cronogramas en este mes', 'error'); return; }
  const [yr,mo] = mes.split('-');
  const titulo = new Date(yr,mo-1,1).toLocaleDateString('es-ES',{month:'long',year:'numeric'});
  showPreview(cronos, titulo.charAt(0).toUpperCase()+titulo.slice(1));
}

function showPreview(cronos, titulo) {
  state.previewData = { cronos, titulo };
  document.getElementById('page-app').classList.remove('active');
  document.getElementById('page-preview').classList.add('active');
  document.getElementById('preview-body').innerHTML = buildPrintHTML(cronos, titulo);
}

function closePrevistaPrevia() {
  document.getElementById('page-preview').classList.remove('active');
  document.getElementById('page-app').classList.add('active');
}

// ===================================================
// COMPARTIR VISTA PREVIA (link con datos en URL hash)
// ===================================================
function shareVistaPrevia() {
  const crono = state.cronogramas.find(c => c.id === state.editingCronogramaId);
  if (!crono) return;
  const data = btoa(encodeURIComponent(JSON.stringify({ cronos: [crono], personas: state.personas })));
  const link = `${location.origin}${location.pathname}#preview=${data}`;
  // Mostrar modal con el link
  showToast('🔗 Link copiado al portapapeles', 'success');
  navigator.clipboard.writeText(link).catch(() => {});
  // Abrir directamente
  openSharedPreview(crono);
}

function openSharedPreview() {
  const crono = state.cronogramas.find(c => c.id === state.editingCronogramaId);
  if (!crono) return;
  const [yr,mo,dy] = crono.fechaInicio.split('-');
  const inicio = new Date(yr,mo-1,parseInt(dy));
  const fin = new Date(yr,mo-1,parseInt(dy)+1);
  const titulo = `${inicio.toLocaleDateString('es-ES',{day:'numeric',month:'long'})} – ${fin.toLocaleDateString('es-ES',{day:'numeric',month:'long',year:'numeric'})}`;
  showPreview([crono], titulo);
}

// ===================================================
// WHATSAPP
// ===================================================
function enviarWhatsApp() {
  const crono = state.cronogramas.find(c => c.id === state.editingCronogramaId);
  if (!crono) return;
  const at = crono.atalaya || {};

  // Armar lista de asignaciones por persona
  const asignaciones = {};
  const addAsig = (personaId, dept, puesto) => {
    if (!personaId) return;
    if (!asignaciones[personaId]) asignaciones[personaId] = [];
    asignaciones[personaId].push({ dept, puesto });
  };

  Object.entries(crono.acomodadores || {}).forEach(([puesto, id]) => addAsig(id, 'Acomodadores', puesto));
  Object.entries(crono.audioVideo || {}).forEach(([puesto, id]) => addAsig(id, 'Audio y Video', puesto));
  if (crono.presidencia?.Presidente) addAsig(crono.presidencia.Presidente, 'Presidencia', 'Presidente');
  (crono.conferencia || []).forEach(id => addAsig(id, 'Conferencia', 'Conferenciante'));
  const conductorId = at.conductorActivo || at.conductorTitular;
  if (conductorId) addAsig(conductorId, 'Estudio Atalaya', 'Conductor');
  if (at.lector) addAsig(at.lector, 'Estudio Atalaya', 'Lector');

  const [yr,mo,dy] = crono.fechaInicio.split('-');
  const inicio = new Date(yr,mo-1,parseInt(dy));
  const fin = new Date(yr,mo-1,parseInt(dy)+1);
  const fechaLabel = `${inicio.toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long'})} – ${fin.toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long'})}`;

  const container = document.getElementById('whatsapp-list');
  container.innerHTML = Object.entries(asignaciones).map(([id, roles]) => {
    const p = state.personas.find(x => x.id === id);
    if (!p) return '';
    const rolesLabel = roles.map(r => `${r.dept} — ${r.puesto}`).join(', ');
    return `<div class="wa-person-row">
      <div class="avatar small">${p.nombre[0]}</div>
      <div class="wa-role-info">
        <strong>${p.nombre} ${p.apellido}</strong>
        <small>${rolesLabel}</small>
        ${!p.celular ? '<span class="wa-no-phone">⚠ Sin número de celular</span>' : `<small>${p.celular}</small>`}
      </div>
      <input type="checkbox" ${p.celular ? 'checked' : 'disabled'} data-personid="${id}" data-fecha="${fechaLabel}" data-roles="${encodeURIComponent(rolesLabel)}" style="accent-color:var(--success);width:18px;height:18px" />
    </div>`;
  }).join('');

  document.getElementById('modal-whatsapp').classList.remove('hidden');
}

function sendWhatsAppMessages() {
  const checks = document.querySelectorAll('#whatsapp-list input[type="checkbox"]:checked:not(:disabled)');
  if (checks.length === 0) { showToast('No hay personas para notificar', 'error'); return; }

  checks.forEach((cb, i) => {
    const p = state.personas.find(x => x.id === cb.dataset.personid);
    if (!p || !p.celular) return;
    const roles = decodeURIComponent(cb.dataset.roles);
    const fecha = cb.dataset.fecha;
    const msg = `Hola ${p.nombre}! 👋 Te escribimos para avisarte que el fin de semana *${fecha}* tenés asignado: *${roles}*. Muchas gracias!`;
    setTimeout(() => {
      window.open(`https://wa.me/${p.celular}?text=${encodeURIComponent(msg)}`, '_blank');
    }, i * 800);
  });

  closeModal('modal-whatsapp');
  showToast(`✓ Abriendo ${checks.length} conversación(es) de WhatsApp`, 'success');
}

// ===================================================
// PERSONAS
// ===================================================
function renderPersonasList() {
  const q = document.getElementById('searchPersona').value.toLowerCase();
  const container = document.getElementById('personas-list');
  const filtered = state.personas.filter(p => `${p.nombre} ${p.apellido}`.toLowerCase().includes(q));
  if (filtered.length === 0) { container.innerHTML = '<div class="empty-state">No se encontraron personas.</div>'; return; }
  container.innerHTML = filtered.map(p => {
    const deptClass = d => d === 'Audio y Video' ? 'AudioVideo' : d === 'Estudio Atalaya' ? 'EstudioAtalaya' : d.replace(/ /g,'');
    return `<div class="persona-card">
      <div class="avatar">${p.nombre[0]}${p.apellido[0]}</div>
      <div class="persona-info">
        <div class="persona-name">${p.nombre} ${p.apellido}</div>
        ${p.celular ? `<div class="persona-phone">📱 ${p.celular}</div>` : ''}
        <div class="persona-depts">${p.departamentos.map(d => `<span class="dept-pill ${deptClass(d)}">${d}</span>`).join('')}</div>
      </div>
      <div class="persona-actions">
        <button class="btn-icon" onclick="openPersonaModal('${p.id}')" title="Editar">✎</button>
        <button class="btn-icon danger" onclick="deletePersona('${p.id}')" title="Eliminar">✕</button>
      </div>
    </div>`;
  }).join('');
}

function openPersonaModal(id) {
  document.getElementById('personaForm').reset();
  document.getElementById('roles-acomodadores').style.display = 'none';
  document.getElementById('roles-av').style.display = 'none';
  document.getElementById('roles-atalaya').style.display = 'none';

  if (id) {
    const p = state.personas.find(x => x.id === id);
    if (!p) return;
    document.getElementById('modal-persona-titulo').textContent = 'Editar Persona';
    document.getElementById('persona-id').value = p.id;
    document.getElementById('persona-nombre').value = p.nombre;
    document.getElementById('persona-apellido').value = p.apellido;
    document.getElementById('persona-celular').value = p.celular || '';
    document.querySelectorAll('[name="dept"]').forEach(cb => { cb.checked = p.departamentos.includes(cb.value); });
    document.querySelectorAll('[name="roleAcomo"]').forEach(cb => { cb.checked = (p.rolesAcomo||[]).includes(cb.value); });
    document.querySelectorAll('[name="roleAV"]').forEach(cb => { cb.checked = (p.rolesAV||[]).includes(cb.value); });
    document.querySelectorAll('[name="roleAtalaya"]').forEach(cb => { cb.checked = (p.rolesAtalaya||[]).includes(cb.value); });
    if (p.departamentos.includes('Acomodadores')) document.getElementById('roles-acomodadores').style.display = '';
    if (p.departamentos.includes('Audio y Video')) document.getElementById('roles-av').style.display = '';
    if (p.departamentos.includes('Estudio Atalaya')) document.getElementById('roles-atalaya').style.display = '';
  } else {
    document.getElementById('modal-persona-titulo').textContent = 'Nueva Persona';
    document.getElementById('persona-id').value = '';
  }

  document.querySelectorAll('[name="dept"]').forEach(cb => {
    cb.onchange = () => {
      document.getElementById('roles-acomodadores').style.display = document.querySelector('[name="dept"][value="Acomodadores"]').checked ? '' : 'none';
      document.getElementById('roles-av').style.display = document.querySelector('[name="dept"][value="Audio y Video"]').checked ? '' : 'none';
      document.getElementById('roles-atalaya').style.display = document.querySelector('[name="dept"][value="Estudio Atalaya"]').checked ? '' : 'none';
    };
  });
  document.getElementById('modal-persona').classList.remove('hidden');
}

function savePersona(e) {
  e.preventDefault();
  const id = document.getElementById('persona-id').value;
  const nombre = document.getElementById('persona-nombre').value.trim();
  const apellido = document.getElementById('persona-apellido').value.trim();
  const celular = document.getElementById('persona-celular').value.trim().replace(/\D/g,'');
  const departamentos = Array.from(document.querySelectorAll('[name="dept"]:checked')).map(c => c.value);
  const rolesAcomo = Array.from(document.querySelectorAll('[name="roleAcomo"]:checked')).map(c => c.value);
  const rolesAV = Array.from(document.querySelectorAll('[name="roleAV"]:checked')).map(c => c.value);
  const rolesAtalaya = Array.from(document.querySelectorAll('[name="roleAtalaya"]:checked')).map(c => c.value);
  if (id) {
    Object.assign(state.personas.find(x => x.id === id), { nombre, apellido, celular, departamentos, rolesAcomo, rolesAV, rolesAtalaya });
  } else {
    state.personas.push({ id: `p-${Date.now()}`, nombre, apellido, celular, departamentos, rolesAcomo, rolesAV, rolesAtalaya, ultimaAsignacion: null });
  }
  saveData(); closeModal('modal-persona'); renderPersonasList(); showToast('Persona guardada', 'success');
}

function deletePersona(id) {
  if (!confirm('¿Eliminar esta persona?')) return;
  state.personas = state.personas.filter(p => p.id !== id);
  saveData(); renderPersonasList(); showToast('Persona eliminada');
}

// ===================================================
// DEPARTAMENTOS
// ===================================================
function renderDepartamentos() {
  const container = document.getElementById('departamentos-content');
  const deptClass = d => d === 'Audio y Video' ? 'AudioVideo' : d === 'Estudio Atalaya' ? 'EstudioAtalaya' : d.replace(/ /g,'');
  container.innerHTML = DEPARTAMENTOS.map(dept => {
    const miembros = state.personas.filter(p => p.departamentos.includes(dept));
    const cls = deptClass(dept);
    return `<div class="dept-admin-card">
      <div class="dept-admin-header ${cls}">${dept} <small style="font-weight:400;font-size:0.8rem">(${miembros.length})</small></div>
      <div class="dept-admin-body">
        ${miembros.length === 0 ? '<div class="dept-member-row" style="color:var(--text-secondary);font-size:0.85rem">Sin miembros</div>' :
          miembros.map(p => {
            let roles = [];
            if (dept === 'Acomodadores') roles = p.rolesAcomo || [];
            else if (dept === 'Audio y Video') roles = p.rolesAV || [];
            else if (dept === 'Estudio Atalaya') roles = p.rolesAtalaya || [];
            return `<div class="dept-member-row">
              <div class="avatar small">${p.nombre[0]}</div>
              <div class="dept-member-name">${p.nombre} ${p.apellido}</div>
              ${roles.length ? `<div class="dept-member-roles">${roles.join(', ')}</div>` : ''}
            </div>`;
          }).join('')}
      </div>
    </div>`;
  }).join('');
}

// ===================================================
// MODALS
// ===================================================
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.add('hidden'); });
});

// ===================================================
// TOAST
// ===================================================
let toastTimer;
function showToast(msg, type = '') {
  const toast = document.getElementById('toast');
  toast.textContent = msg; toast.className = `toast ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 3000);
}

// ===================================================
// CHECK URL para vista previa compartida
// ===================================================
document.addEventListener('DOMContentLoaded', () => {
  const hash = location.hash;
  if (hash.startsWith('#preview=')) {
    try {
      const data = JSON.parse(decodeURIComponent(atob(hash.replace('#preview=',''))));
      state.personas = data.personas;
      const cronos = data.cronos;
      const [yr,mo,dy] = cronos[0].fechaInicio.split('-');
      const inicio = new Date(yr,mo-1,parseInt(dy));
      const fin = new Date(yr,mo-1,parseInt(dy)+1);
      const titulo = `${inicio.toLocaleDateString('es-ES',{day:'numeric',month:'long'})} – ${fin.toLocaleDateString('es-ES',{day:'numeric',month:'long',year:'numeric'})}`;
      document.getElementById('page-preview').classList.add('active');
      document.getElementById('preview-body').innerHTML = buildPrintHTML(cronos, titulo);
    } catch(e) { console.error('Preview error', e); }
  }
});
