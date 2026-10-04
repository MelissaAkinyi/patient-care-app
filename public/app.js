const app = document.querySelector('#app');
const toast = document.querySelector('#toast');
const state = {
  patient: JSON.parse(sessionStorage.getItem('activePatient') || 'null'),
  vital: JSON.parse(sessionStorage.getItem('activeVital') || 'null'),
};

const isoToday = () => new Date().toISOString().slice(0, 10);
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const patientName = () => state.patient ? [state.patient.firstName, state.patient.middleName, state.patient.lastName].filter(Boolean).join(' ') : '';
const initials = (name) => name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase();
const bmiLabel = (bmi) => bmi < 18.5 ? 'Underweight' : bmi < 25 ? 'Normal' : 'Overweight';

document.querySelector('#todayText').textContent = new Intl.DateTimeFormat('en-KE', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
document.querySelector('#viewPatients').addEventListener('click', () => { location.hash = '#/patients'; });

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Something went wrong');
  return result;
}

function notify(message, type = 'success') {
  toast.textContent = message;
  toast.className = `toast ${type} show`;
  clearTimeout(notify.timeout);
  notify.timeout = setTimeout(() => { toast.className = 'toast'; }, 3500);
}

function setBusy(form, busy) {
  const button = form.querySelector('[type="submit"]');
  button.disabled = busy;
  button.textContent = busy ? 'Saving…' : button.dataset.label;
}

function setActiveStep(step) {
  document.querySelectorAll('.step').forEach((item) => item.classList.toggle('active', item.dataset.step === step));
  document.querySelector('[data-step="vitals"]').classList.toggle('disabled', !state.patient);
  document.querySelector('[data-step="assessment"]').classList.toggle('disabled', !state.vital);
}

function heading(kicker, title, copy = '') {
  return `<div class="page-heading"><div><p class="kicker">${kicker}</p><h1>${title}</h1></div>${copy ? `<p>${copy}</p>` : ''}</div>`;
}

function patientChip() {
  return `<div class="patient-chip"><span class="avatar">${initials(patientName())}</span>${escapeHtml(patientName())}</div>`;
}

function requiredRadio(name, legend, values) {
  return `<fieldset class="field radio-field"><legend>${legend}</legend><div class="radio-group">${values.map((value) => `<label class="radio"><input type="radio" name="${name}" value="${value}" required> ${value}</label>`).join('')}</div></fieldset>`;
}

function renderRegistration() {
  setActiveStep('register');
  app.innerHTML = `${heading('New patient', 'Let’s create a patient record.', 'Enter the patient’s personal details below. Fields marked with an asterisk are required.')}
    <form class="form-card" id="registrationForm">
      <div class="card-banner"><strong>Patient Registration Form</strong><span>Personal &amp; identification details</span></div>
      <div class="form-body">
        <div class="form-grid three">
          <div class="field"><label for="firstName">First name *</label><input id="firstName" name="firstName" autocomplete="given-name" required></div>
          <div class="field"><label for="middleName">Middle name <span class="optional">(optional)</span></label><input id="middleName" name="middleName" autocomplete="additional-name"></div>
          <div class="field"><label for="lastName">Last name *</label><input id="lastName" name="lastName" autocomplete="family-name" required></div>
          <div class="field"><label for="patientId">Patient number *</label><input id="patientId" name="patientId" placeholder="e.g. PT-00124" required></div>
          <div class="field"><label for="dateOfBirth">Date of birth *</label><input id="dateOfBirth" name="dateOfBirth" type="date" max="${isoToday()}" required></div>
          <div class="field"><label for="registrationDate">Registration date *</label><input id="registrationDate" name="registrationDate" type="date" max="${isoToday()}" value="${isoToday()}" required></div>
          ${requiredRadio('gender', 'Gender *', ['Male', 'Female', 'Other'])}
        </div>
        <div class="form-actions"><button class="button button-secondary" type="button" id="cancelRegistration">Cancel</button><div><span class="required-note"><b>*</b> Required information</span> <button class="button button-primary" type="submit" data-label="Save & continue">Save &amp; continue</button></div></div>
      </div>
    </form>`;
  document.querySelector('#registrationForm').addEventListener('submit', submitRegistration);
  document.querySelector('#cancelRegistration').addEventListener('click', () => { location.hash = '#/patients'; });
}

async function submitRegistration(event) {
  event.preventDefault();
  const form = event.currentTarget;
  setBusy(form, true);
  try {
    const body = Object.fromEntries(new FormData(form));
    const { patient } = await api('/api/patients', { method: 'POST', body: JSON.stringify(body) });
    state.patient = patient;
    state.vital = null;
    sessionStorage.setItem('activePatient', JSON.stringify(patient));
    sessionStorage.removeItem('activeVital');
    notify('Patient registered successfully');
    location.hash = '#/vitals';
  } catch (error) { notify(error.message, 'error'); }
  finally { setBusy(form, false); }
}

function renderVitals() {
  if (!state.patient) return guardToRegistration();
  setActiveStep('vitals');
  app.innerHTML = `${heading('Step 2 of 3', 'Record patient vitals.', 'Height and weight are used to calculate BMI automatically and select the correct health assessment.')}
    <div class="summary-strip"><div><span>Patient</span><strong>${escapeHtml(patientName())}</strong></div><div><span>Patient number</span><strong>${escapeHtml(state.patient.patientId)}</strong></div><div><span>Registered</span><strong>${formatDate(state.patient.registrationDate)}</strong></div></div>
    <form class="form-card" id="vitalsForm">
      <div class="card-banner"><strong>Patient Vitals</strong>${patientChip()}</div>
      <div class="form-body">
        <div class="form-grid">
          <div class="field"><label for="visitDate">Visit date *</label><input id="visitDate" name="visitDate" type="date" max="${isoToday()}" value="${isoToday()}" required></div>
          <div class="field"><label for="patientName">Patient name</label><input id="patientName" value="${escapeHtml(patientName())}" readonly></div>
          <div class="field"><label for="height">Height *</label><div class="metric-wrap"><input id="height" name="height" type="number" min="30" max="260" step="0.1" placeholder="0.0" required><span>CM</span></div></div>
          <div class="field"><label for="weight">Weight *</label><div class="metric-wrap"><input id="weight" name="weight" type="number" min="1" max="500" step="0.1" placeholder="0.0" required><span>KG</span></div></div>
          <div class="field full"><div class="bmi-panel"><div><small>Calculated BMI</small><strong id="bmiValue">—</strong></div><span class="bmi-status" id="bmiStatus">Enter measurements</span></div></div>
        </div>
        <div class="form-actions"><button class="button button-secondary" type="button" id="cancelVitals">Cancel</button><button class="button button-primary" type="submit" data-label="Save & continue">Save &amp; continue</button></div>
      </div>
    </form>`;
  const form = document.querySelector('#vitalsForm');
  form.addEventListener('input', updateBmi);
  form.addEventListener('submit', submitVitals);
  document.querySelector('#cancelVitals').addEventListener('click', () => { location.hash = '#/patients'; });
}

function updateBmi() {
  const height = Number(document.querySelector('#height').value);
  const weight = Number(document.querySelector('#weight').value);
  const value = document.querySelector('#bmiValue');
  const status = document.querySelector('#bmiStatus');
  if (!height || !weight) { value.textContent = '—'; status.textContent = 'Enter measurements'; return; }
  const bmi = weight / ((height / 100) ** 2);
  value.textContent = bmi.toFixed(1);
  status.textContent = bmiLabel(bmi);
}

async function submitVitals(event) {
  event.preventDefault();
  const form = event.currentTarget;
  setBusy(form, true);
  try {
    const body = Object.fromEntries(new FormData(form));
    const result = await api(`/api/patients/${encodeURIComponent(state.patient.patientId)}/vitals`, { method: 'POST', body: JSON.stringify(body) });
    state.vital = result.vital;
    sessionStorage.setItem('activeVital', JSON.stringify(result.vital));
    notify(`BMI ${result.vital.bmi} · ${result.status}`);
    location.hash = `#/assessment/${result.nextAssessment}`;
  } catch (error) { notify(error.message, 'error'); }
  finally { setBusy(form, false); }
}

function renderAssessment(type) {
  if (!state.patient || !state.vital) return guardToRegistration();
  const requiredType = state.vital.bmi > 25 ? 'overweight' : 'general';
  if (type !== requiredType) { location.hash = `#/assessment/${requiredType}`; return; }
  setActiveStep('assessment');
  const overweight = type === 'overweight';
  const title = overweight ? 'Overweight Assessment Form' : 'General Assessment Form';
  const question = overweight ? 'Have you ever been on a diet to lose weight? *' : 'Are you currently using any drugs? *';
  const answerName = overweight ? 'everDieted' : 'usingDrugs';
  app.innerHTML = `${heading('Final step', overweight ? 'Complete the weight assessment.' : 'Complete the general assessment.', 'This assessment is selected automatically from the patient’s latest BMI result.')}
    <div class="summary-strip"><div><span>Patient</span><strong>${escapeHtml(patientName())}</strong></div><div><span>Visit date</span><strong>${formatDate(state.vital.visitDate)}</strong></div><div><span>BMI result</span><strong>${state.vital.bmi} · ${bmiLabel(state.vital.bmi)}</strong></div></div>
    <form class="form-card" id="assessmentForm">
      <div class="card-banner"><strong>${title}</strong>${patientChip()}</div>
      <div class="form-body">
        <input type="hidden" name="type" value="${type}"><input type="hidden" name="visitDate" value="${state.vital.visitDate}">
        <div class="form-grid">
          <div class="field"><label for="displayVisitDate">Visit date</label><input id="displayVisitDate" type="date" value="${state.vital.visitDate}" readonly></div>
          <div class="field"><label for="displayPatient">Patient name</label><input id="displayPatient" value="${escapeHtml(patientName())}" readonly></div>
          ${requiredRadio('generalHealth', 'General health *', ['Good', 'Poor'])}
          ${requiredRadio(answerName, question, ['Yes', 'No'])}
          <div class="field full"><label for="comments">Comments *</label><textarea id="comments" name="comments" placeholder="Add relevant notes about the patient’s health…" required></textarea></div>
        </div>
        <div class="form-actions"><button class="button button-secondary" type="button" id="backToVitals">Back</button><button class="button button-primary" type="submit" data-label="Complete visit">Complete visit</button></div>
      </div>
    </form>`;
  document.querySelector('#assessmentForm').addEventListener('submit', submitAssessment);
  document.querySelector('#backToVitals').addEventListener('click', () => { location.hash = '#/vitals'; });
}

async function submitAssessment(event) {
  event.preventDefault();
  const form = event.currentTarget;
  setBusy(form, true);
  try {
    const body = Object.fromEntries(new FormData(form));
    await api(`/api/patients/${encodeURIComponent(state.patient.patientId)}/assessments`, { method: 'POST', body: JSON.stringify(body) });
    state.patient = null;
    state.vital = null;
    sessionStorage.removeItem('activePatient');
    sessionStorage.removeItem('activeVital');
    notify('Visit completed and saved');
    location.hash = '#/patients';
  } catch (error) { notify(error.message, 'error'); }
  finally { setBusy(form, false); }
}

async function renderPatients() {
  setActiveStep('patients');
  app.innerHTML = `${heading('Patient records', 'Everyone in your care.', 'View each patient’s age and latest BMI status, or start a new visit from their record.')}
    <div class="list-card"><div class="list-tools"><div class="search"><input id="patientSearch" type="search" placeholder="Search name or patient number…" aria-label="Search patients"></div><div class="date-filter"><label for="visitDateFilter">Visit date</label><input id="visitDateFilter" type="date" max="${isoToday()}"><button id="clearVisitDate" type="button" aria-label="Clear visit date filter">Clear</button></div><span class="patient-count">Loading records…</span><button class="button button-primary" id="newPatient" type="button">+ New patient</button></div><div id="patientTable"><div class="empty"><p>Loading patient records…</p></div></div></div>`;
  document.querySelector('#newPatient').addEventListener('click', newRegistration);
  const search = document.querySelector('#patientSearch');
  const visitDate = document.querySelector('#visitDateFilter');
  let patients = [];
  const applySearch = () => {
    const query = search.value.trim().toLowerCase();
    drawPatientTable(patients.filter((patient) => patient.name.toLowerCase().includes(query) || patient.patientId.toLowerCase().includes(query)));
  };
  const loadPatients = async () => {
    try {
      document.querySelector('.patient-count').textContent = 'Loading records…';
      const query = visitDate.value ? `?visitDate=${encodeURIComponent(visitDate.value)}` : '';
      ({ patients } = await api(`/api/patients${query}`));
      applySearch();
    } catch (error) { notify(error.message, 'error'); }
  };
  search.addEventListener('input', applySearch);
  visitDate.addEventListener('change', loadPatients);
  document.querySelector('#clearVisitDate').addEventListener('click', () => {
    visitDate.value = '';
    loadPatients();
  });
  await loadPatients();
}

function drawPatientTable(patients) {
  document.querySelector('.patient-count').textContent = `${patients.length} patient${patients.length === 1 ? '' : 's'}`;
  const target = document.querySelector('#patientTable');
  if (!patients.length) {
    target.innerHTML = `<div class="empty"><div class="empty-icon">+</div><h3>No patients found</h3><p>Register a patient to begin their care journey.</p><button class="button button-primary" type="button" id="emptyNewPatient">Register patient</button></div>`;
    document.querySelector('#emptyNewPatient').addEventListener('click', newRegistration);
    return;
  }
  target.innerHTML = `<table><thead><tr><th>Patient</th><th>Age</th><th>Last visit</th><th>Last BMI</th><th>Status</th><th></th></tr></thead><tbody>${patients.map((patient) => `<tr><td><div class="patient-name"><span class="avatar">${initials(patient.name)}</span><div><strong>${escapeHtml(patient.name)}</strong><small>${escapeHtml(patient.patientId)}</small></div></div></td><td>${patient.age} years</td><td>${patient.lastVisitDate ? formatDate(patient.lastVisitDate) : '—'}</td><td>${patient.lastBmi ?? '—'}</td><td><span class="status ${patient.lastBmiStatus.toLowerCase().replace(' ', '-')}">${patient.lastBmiStatus}</span></td><td><button class="table-action" type="button" data-patient="${escapeHtml(patient.patientId)}">New visit →</button></td></tr>`).join('')}</tbody></table>`;
  target.querySelectorAll('[data-patient]').forEach((button) => button.addEventListener('click', () => startVisit(button.dataset.patient)));
}

async function startVisit(patientId) {
  try {
    const { patient } = await api(`/api/patients/${encodeURIComponent(patientId)}`);
    state.patient = patient;
    state.vital = null;
    sessionStorage.setItem('activePatient', JSON.stringify(patient));
    sessionStorage.removeItem('activeVital');
    location.hash = '#/vitals';
  } catch (error) { notify(error.message, 'error'); }
}

function newRegistration() {
  state.patient = null;
  state.vital = null;
  sessionStorage.clear();
  location.hash = '#/register';
}

function guardToRegistration() {
  notify('Register or select a patient first', 'error');
  location.hash = '#/register';
}

function formatDate(date) {
  return new Intl.DateTimeFormat('en-KE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
}

function router() {
  const route = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (route[0] === 'vitals') return renderVitals();
  if (route[0] === 'assessment') return renderAssessment(route[1] || (state.vital?.bmi > 25 ? 'overweight' : 'general'));
  if (route[0] === 'patients') return renderPatients();
  return renderRegistration();
}

window.addEventListener('hashchange', router);
router();
