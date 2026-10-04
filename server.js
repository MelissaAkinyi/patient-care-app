const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PUBLIC_DIR = path.join(__dirname, 'public');
const DEFAULT_DATA_FILE = path.join(__dirname, 'data', 'store.json');

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};

const readBody = (req) => new Promise((resolve, reject) => {
  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
    if (raw.length > 1_000_000) reject(new Error('Request is too large'));
  });
  req.on('end', () => {
    try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('Invalid JSON body')); }
  });
  req.on('error', reject);
});

const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const clean = (value) => typeof value === 'string' ? value.trim() : '';
const today = () => new Date().toISOString().slice(0, 10);

function calculateAge(dateOfBirth, onDate = today()) {
  const birth = new Date(`${dateOfBirth}T00:00:00Z`);
  const current = new Date(`${onDate}T00:00:00Z`);
  let age = current.getUTCFullYear() - birth.getUTCFullYear();
  const beforeBirthday = current.getUTCMonth() < birth.getUTCMonth()
    || (current.getUTCMonth() === birth.getUTCMonth() && current.getUTCDate() < birth.getUTCDate());
  return age - (beforeBirthday ? 1 : 0);
}

function bmiStatus(bmi) {
  if (bmi < 18.5) return 'Underweight';
  if (bmi <= 25) return 'Normal';
  return 'Overweight';
}

function createStore(dataFile) {
  const read = () => {
    if (!fs.existsSync(dataFile)) return { patients: [], vitals: [], assessments: [] };
    return JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  };
  const write = (data) => {
    fs.mkdirSync(path.dirname(dataFile), { recursive: true });
    fs.writeFileSync(dataFile, `${JSON.stringify(data, null, 2)}\n`);
  };
  return { read, write };
}

function validatePatient(body) {
  const patient = {
    patientId: clean(body.patientId),
    registrationDate: clean(body.registrationDate),
    firstName: clean(body.firstName),
    middleName: clean(body.middleName),
    lastName: clean(body.lastName),
    dateOfBirth: clean(body.dateOfBirth),
    gender: clean(body.gender),
  };
  const missing = ['patientId', 'registrationDate', 'firstName', 'lastName', 'dateOfBirth', 'gender'].filter((key) => !patient[key]);
  if (missing.length) return { error: `Missing required fields: ${missing.join(', ')}` };
  if (!isDate(patient.registrationDate) || !isDate(patient.dateOfBirth)) return { error: 'Enter valid dates' };
  if (patient.dateOfBirth > today()) return { error: 'Date of birth cannot be in the future' };
  if (!['Male', 'Female', 'Other'].includes(patient.gender)) return { error: 'Select a valid gender' };
  return { patient };
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const requested = urlPath === '/' ? 'index.html' : urlPath.replace(/^\//, '');
  const filePath = path.resolve(PUBLIC_DIR, requested);
  if (!filePath.startsWith(`${PUBLIC_DIR}${path.sep}`) && filePath !== path.join(PUBLIC_DIR, 'index.html')) {
    json(res, 403, { error: 'Forbidden' });
    return;
  }
  fs.readFile(filePath, (error, file) => {
    if (error) {
      if (!path.extname(requested)) return fs.createReadStream(path.join(PUBLIC_DIR, 'index.html')).pipe(res);
      return json(res, 404, { error: 'Not found' });
    }
    const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
    res.writeHead(200, { 'Content-Type': `${types[path.extname(filePath)] || 'application/octet-stream'}; charset=utf-8` });
    res.end(file);
  });
}

function createApp({ dataFile = DEFAULT_DATA_FILE } = {}) {
  const store = createStore(dataFile);
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean);

    try {
      if (req.method === 'GET' && url.pathname === '/api/patients') {
        const data = store.read();
        const patients = data.patients.map((patient) => {
          const vitals = data.vitals
            .filter((entry) => entry.patientId === patient.patientId)
            .sort((a, b) => b.visitDate.localeCompare(a.visitDate));
          const latest = vitals[0];
          return {
            ...patient,
            name: [patient.firstName, patient.middleName, patient.lastName].filter(Boolean).join(' '),
            age: calculateAge(patient.dateOfBirth),
            lastBmi: latest?.bmi ?? null,
            lastBmiStatus: latest ? bmiStatus(latest.bmi) : 'Not recorded',
            lastVisitDate: latest?.visitDate ?? null,
          };
        });
        return json(res, 200, { patients });
      }

      if (req.method === 'POST' && url.pathname === '/api/patients') {
        const body = await readBody(req);
        const validated = validatePatient(body);
        if (validated.error) return json(res, 400, { error: validated.error });
        const data = store.read();
        if (data.patients.some((item) => item.patientId.toLowerCase() === validated.patient.patientId.toLowerCase())) {
          return json(res, 409, { error: 'A patient with this patient number is already registered' });
        }
        const patient = { ...validated.patient, createdAt: new Date().toISOString() };
        data.patients.push(patient);
        store.write(data);
        return json(res, 201, { patient });
      }

      if (parts[0] === 'api' && parts[1] === 'patients' && parts[2] && req.method === 'GET' && parts.length === 3) {
        const data = store.read();
        const patient = data.patients.find((item) => item.patientId === decodeURIComponent(parts[2]));
        if (!patient) return json(res, 404, { error: 'Patient not found' });
        return json(res, 200, { patient, vitals: data.vitals.filter((item) => item.patientId === patient.patientId) });
      }

      if (parts[0] === 'api' && parts[1] === 'patients' && parts[2] && parts[3] === 'vitals' && req.method === 'POST') {
        const patientId = decodeURIComponent(parts[2]);
        const body = await readBody(req);
        const visitDate = clean(body.visitDate);
        const height = Number(body.height);
        const weight = Number(body.weight);
        const data = store.read();
        if (!data.patients.some((item) => item.patientId === patientId)) return json(res, 404, { error: 'Patient not found' });
        if (!isDate(visitDate) || !Number.isFinite(height) || height <= 0 || !Number.isFinite(weight) || weight <= 0) {
          return json(res, 400, { error: 'Visit date, height, and weight are required and must be valid' });
        }
        if (visitDate > today()) return json(res, 400, { error: 'Visit date cannot be in the future' });
        if (data.vitals.some((item) => item.patientId === patientId && item.visitDate === visitDate)) {
          return json(res, 409, { error: 'Vitals have already been recorded for this patient on this date' });
        }
        const bmi = Number((weight / ((height / 100) ** 2)).toFixed(1));
        const vital = { id: crypto.randomUUID(), patientId, visitDate, height, weight, bmi, createdAt: new Date().toISOString() };
        data.vitals.push(vital);
        store.write(data);
        return json(res, 201, { vital, status: bmiStatus(bmi), nextAssessment: bmi > 25 ? 'overweight' : 'general' });
      }

      if (parts[0] === 'api' && parts[1] === 'patients' && parts[2] && parts[3] === 'assessments' && req.method === 'POST') {
        const patientId = decodeURIComponent(parts[2]);
        const body = await readBody(req);
        const visitDate = clean(body.visitDate);
        const type = clean(body.type);
        const generalHealth = clean(body.generalHealth);
        const answer = clean(type === 'overweight' ? body.everDieted : body.usingDrugs);
        const comments = clean(body.comments);
        const data = store.read();
        if (!data.patients.some((item) => item.patientId === patientId)) return json(res, 404, { error: 'Patient not found' });
        if (!isDate(visitDate) || !['general', 'overweight'].includes(type) || !['Good', 'Poor'].includes(generalHealth) || !['Yes', 'No'].includes(answer) || !comments) {
          return json(res, 400, { error: 'All assessment fields are required' });
        }
        const vital = data.vitals.find((item) => item.patientId === patientId && item.visitDate === visitDate);
        if (!vital) return json(res, 400, { error: 'Record vitals for this visit before submitting an assessment' });
        const requiredType = vital.bmi > 25 ? 'overweight' : 'general';
        if (type !== requiredType) return json(res, 400, { error: `BMI ${vital.bmi} requires the ${requiredType} assessment` });
        if (data.assessments.some((item) => item.patientId === patientId && item.visitDate === visitDate && item.type === type)) {
          return json(res, 409, { error: 'This assessment has already been submitted for this visit date' });
        }
        const assessment = {
          id: crypto.randomUUID(), patientId, visitDate, type, generalHealth, comments,
          ...(type === 'overweight' ? { everDieted: answer } : { usingDrugs: answer }),
          createdAt: new Date().toISOString(),
        };
        data.assessments.push(assessment);
        store.write(data);
        return json(res, 201, { assessment });
      }

      if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'API endpoint not found' });
      return serveStatic(req, res);
    } catch (error) {
      return json(res, error.message === 'Invalid JSON body' ? 400 : 500, { error: error.message || 'Unexpected server error' });
    }
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  createApp().listen(port, () => console.log(`Patient Care is running at http://localhost:${port}`));
}

module.exports = { createApp, calculateAge, bmiStatus };
