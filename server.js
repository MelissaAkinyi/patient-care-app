require('dotenv').config();

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { PostgresStore, ConflictError } = require('./database');

const PUBLIC_DIR = path.join(__dirname, 'public');

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

function isDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

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
  if (bmi < 25) return 'Normal';
  return 'Overweight';
}

function assessmentType(bmi) {
  return bmi > 25 ? 'overweight' : 'general';
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
  if (patient.registrationDate > today()) return { error: 'Registration date cannot be in the future' };
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
      if (!path.extname(requested)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return fs.createReadStream(path.join(PUBLIC_DIR, 'index.html')).pipe(res);
      }
      return json(res, 404, { error: 'Not found' });
    }
    const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
    res.writeHead(200, { 'Content-Type': `${types[path.extname(filePath)] || 'application/octet-stream'}; charset=utf-8` });
    res.end(file);
  });
}

function createApp({ store }) {
  if (!store) throw new Error('A data store is required');
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean);

    try {
      if (req.method === 'GET' && url.pathname === '/api/patients') {
        const visitDate = clean(url.searchParams.get('visitDate'));
        if (visitDate && !isDate(visitDate)) return json(res, 400, { error: 'Enter a valid visit date' });
        const records = await store.listPatients(visitDate || null);
        const patients = records.map((patient) => ({
          ...patient,
          name: [patient.firstName, patient.middleName, patient.lastName].filter(Boolean).join(' '),
          age: calculateAge(patient.dateOfBirth),
          lastBmiStatus: patient.lastBmi === null ? 'Not recorded' : bmiStatus(patient.lastBmi),
        }));
        return json(res, 200, { patients, visitDate: visitDate || null });
      }

      if (req.method === 'POST' && url.pathname === '/api/patients') {
        const body = await readBody(req);
        const validated = validatePatient(body);
        if (validated.error) return json(res, 400, { error: validated.error });
        const patient = await store.createPatient(validated.patient);
        return json(res, 201, { patient });
      }

      if (parts[0] === 'api' && parts[1] === 'patients' && parts[2] && req.method === 'GET' && parts.length === 3) {
        const patient = await store.getPatient(decodeURIComponent(parts[2]));
        if (!patient) return json(res, 404, { error: 'Patient not found' });
        const vitals = await store.getVitals(patient.patientId);
        return json(res, 200, { patient, vitals });
      }

      if (parts[0] === 'api' && parts[1] === 'patients' && parts[2] && parts[3] === 'vitals' && req.method === 'POST') {
        const patient = await store.getPatient(decodeURIComponent(parts[2]));
        if (!patient) return json(res, 404, { error: 'Patient not found' });
        const body = await readBody(req);
        const visitDate = clean(body.visitDate);
        const height = Number(body.height);
        const weight = Number(body.weight);
        if (!isDate(visitDate) || !Number.isFinite(height) || height <= 0 || !Number.isFinite(weight) || weight <= 0) {
          return json(res, 400, { error: 'Visit date, height, and weight are required and must be valid' });
        }
        if (visitDate > today()) return json(res, 400, { error: 'Visit date cannot be in the future' });
        const bmi = Number((weight / ((height / 100) ** 2)).toFixed(1));
        const vital = await store.createVital({
          id: crypto.randomUUID(), patientId: patient.patientId, visitDate, height, weight, bmi,
        });
        return json(res, 201, { vital, status: bmiStatus(bmi), nextAssessment: assessmentType(bmi) });
      }

      if (parts[0] === 'api' && parts[1] === 'patients' && parts[2] && parts[3] === 'assessments' && req.method === 'POST') {
        const patient = await store.getPatient(decodeURIComponent(parts[2]));
        if (!patient) return json(res, 404, { error: 'Patient not found' });
        const body = await readBody(req);
        const visitDate = clean(body.visitDate);
        const type = clean(body.type);
        const generalHealth = clean(body.generalHealth);
        const answer = clean(type === 'overweight' ? body.everDieted : body.usingDrugs);
        const comments = clean(body.comments);
        if (!isDate(visitDate) || !['general', 'overweight'].includes(type) || !['Good', 'Poor'].includes(generalHealth) || !['Yes', 'No'].includes(answer) || !comments) {
          return json(res, 400, { error: 'All assessment fields are required' });
        }
        const vital = await store.getVital(patient.patientId, visitDate);
        if (!vital) return json(res, 400, { error: 'Record vitals for this visit before submitting an assessment' });
        const requiredType = assessmentType(vital.bmi);
        if (type !== requiredType) return json(res, 400, { error: `BMI ${vital.bmi} requires the ${requiredType} assessment` });
        const assessment = await store.createAssessment({
          id: crypto.randomUUID(), patientId: patient.patientId, visitDate, type, generalHealth, comments,
          ...(type === 'overweight' ? { everDieted: answer } : { usingDrugs: answer }),
        });
        return json(res, 201, { assessment });
      }

      if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'API endpoint not found' });
      return serveStatic(req, res);
    } catch (error) {
      if (error instanceof ConflictError) return json(res, 409, { error: error.message });
      console.error(error);
      return json(res, error.message === 'Invalid JSON body' ? 400 : 500, { error: error.message || 'Unexpected server error' });
    }
  });
}

async function main() {
  const connectionString = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/patient_care';
  const store = new PostgresStore({ connectionString });
  await store.init();
  const port = Number(process.env.PORT) || 3000;
  const server = createApp({ store });
  server.listen(port, () => console.log(`Patient Care is running at http://localhost:${port}`));

  const shutdown = () => server.close(async () => {
    await store.close();
    process.exit(0);
  });
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Unable to start Patient Care:', error.message);
    process.exit(1);
  });
}

module.exports = { createApp, calculateAge, bmiStatus, assessmentType, isDate };
