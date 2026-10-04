const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp, calculateAge, bmiStatus } = require('../server');

let server;
let baseUrl;
let tempDir;

test.before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'patient-care-'));
  server = createApp({ dataFile: path.join(tempDir, 'store.json') });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tempDir, { recursive: true, force: true });
});

async function request(url, options = {}) {
  const response = await fetch(`${baseUrl}${url}`, {
    ...options,
    headers: { 'Content-Type': 'application/json' },
  });
  return { status: response.status, body: await response.json() };
}

const patient = {
  patientId: 'PT-001', registrationDate: '2026-10-02', firstName: 'Amina',
  middleName: '', lastName: 'Kamau', dateOfBirth: '1995-06-15', gender: 'Female',
};

test('BMI status follows the required categories', () => {
  assert.equal(bmiStatus(17), 'Underweight');
  assert.equal(bmiStatus(22), 'Normal');
  assert.equal(bmiStatus(25), 'Normal');
  assert.equal(bmiStatus(25.1), 'Overweight');
});

test('age calculation accounts for whether the birthday has passed', () => {
  assert.equal(calculateAge('2000-10-03', '2026-10-02'), 25);
  assert.equal(calculateAge('2000-10-02', '2026-10-02'), 26);
});

test('registers a patient and rejects a duplicate patient number', async () => {
  const created = await request('/api/patients', { method: 'POST', body: JSON.stringify(patient) });
  assert.equal(created.status, 201);
  assert.equal(created.body.patient.firstName, 'Amina');
  const duplicate = await request('/api/patients', { method: 'POST', body: JSON.stringify(patient) });
  assert.equal(duplicate.status, 409);
});

test('records vitals, calculates BMI, and selects overweight assessment', async () => {
  const result = await request('/api/patients/PT-001/vitals', {
    method: 'POST', body: JSON.stringify({ visitDate: '2026-10-02', height: 160, weight: 80 }),
  });
  assert.equal(result.status, 201);
  assert.equal(result.body.vital.bmi, 31.2);
  assert.equal(result.body.nextAssessment, 'overweight');
  const duplicate = await request('/api/patients/PT-001/vitals', {
    method: 'POST', body: JSON.stringify({ visitDate: '2026-10-02', height: 160, weight: 81 }),
  });
  assert.equal(duplicate.status, 409);
});

test('enforces the BMI-specific assessment and stores the valid form', async () => {
  const wrong = await request('/api/patients/PT-001/assessments', {
    method: 'POST', body: JSON.stringify({ visitDate: '2026-10-02', type: 'general', generalHealth: 'Good', usingDrugs: 'No', comments: 'Well' }),
  });
  assert.equal(wrong.status, 400);
  const correct = await request('/api/patients/PT-001/assessments', {
    method: 'POST', body: JSON.stringify({ visitDate: '2026-10-02', type: 'overweight', generalHealth: 'Good', everDieted: 'Yes', comments: 'Discussed nutrition plan' }),
  });
  assert.equal(correct.status, 201);
});

test('routes BMI at or below 25 to the general assessment', async () => {
  const vitals = await request('/api/patients/PT-001/vitals', {
    method: 'POST', body: JSON.stringify({ visitDate: '2026-10-01', height: 170, weight: 65 }),
  });
  assert.equal(vitals.status, 201);
  assert.equal(vitals.body.nextAssessment, 'general');
  const assessment = await request('/api/patients/PT-001/assessments', {
    method: 'POST', body: JSON.stringify({ visitDate: '2026-10-01', type: 'general', generalHealth: 'Good', usingDrugs: 'No', comments: 'No concerns reported' }),
  });
  assert.equal(assessment.status, 201);
  assert.equal(assessment.body.assessment.usingDrugs, 'No');
});

test('patient listing returns the latest BMI status', async () => {
  const result = await request('/api/patients');
  assert.equal(result.status, 200);
  assert.equal(result.body.patients[0].name, 'Amina Kamau');
  assert.equal(result.body.patients[0].lastBmiStatus, 'Overweight');
});
