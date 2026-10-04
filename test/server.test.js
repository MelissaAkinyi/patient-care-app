const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp, calculateAge, bmiStatus, assessmentType, isDate } = require('../server');
const { ConflictError } = require('../database');

class MemoryStore {
  constructor() {
    this.patients = [];
    this.vitals = [];
    this.assessments = [];
  }

  async listPatients(visitDate) {
    return this.patients.flatMap((patient) => {
      const matches = this.vitals
        .filter((vital) => vital.patientId === patient.patientId && (!visitDate || vital.visitDate === visitDate))
        .sort((a, b) => b.visitDate.localeCompare(a.visitDate));
      if (visitDate && !matches.length) return [];
      return [{ ...patient, lastVisitDate: matches[0]?.visitDate || null, lastBmi: matches[0]?.bmi ?? null }];
    });
  }

  async createPatient(patient) {
    if (this.patients.some((item) => item.patientId.toLowerCase() === patient.patientId.toLowerCase())) {
      throw new ConflictError('A patient with this patient number is already registered');
    }
    const created = { ...patient, createdAt: new Date().toISOString() };
    this.patients.push(created);
    return created;
  }

  async getPatient(patientId) {
    return this.patients.find((item) => item.patientId.toLowerCase() === patientId.toLowerCase()) || null;
  }

  async getVitals(patientId) {
    return this.vitals.filter((item) => item.patientId === patientId);
  }

  async createVital(vital) {
    if (this.vitals.some((item) => item.patientId === vital.patientId && item.visitDate === vital.visitDate)) {
      throw new ConflictError('Vitals have already been recorded for this patient on this date');
    }
    const created = { ...vital, createdAt: new Date().toISOString() };
    this.vitals.push(created);
    return created;
  }

  async getVital(patientId, visitDate) {
    return this.vitals.find((item) => item.patientId === patientId && item.visitDate === visitDate) || null;
  }

  async createAssessment(assessment) {
    if (this.assessments.some((item) => item.patientId === assessment.patientId && item.visitDate === assessment.visitDate)) {
      throw new ConflictError('An assessment has already been submitted for this visit date');
    }
    const created = { ...assessment, createdAt: new Date().toISOString() };
    this.assessments.push(created);
    return created;
  }
}

let server;
let baseUrl;

test.before(async () => {
  server = createApp({ store: new MemoryStore() });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
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

test('BMI status and routing use their distinct boundary rules', () => {
  assert.equal(bmiStatus(17), 'Underweight');
  assert.equal(bmiStatus(24.9), 'Normal');
  assert.equal(bmiStatus(25), 'Overweight');
  assert.equal(assessmentType(25), 'general');
  assert.equal(assessmentType(25.1), 'overweight');
});

test('date validation rejects impossible calendar dates', () => {
  assert.equal(isDate('2026-02-28'), true);
  assert.equal(isDate('2026-02-30'), false);
});

test('age calculation accounts for whether the birthday has passed', () => {
  assert.equal(calculateAge('2000-10-03', '2026-10-02'), 25);
  assert.equal(calculateAge('2000-10-02', '2026-10-02'), 26);
});

test('registers a patient and rejects a case-insensitive duplicate ID', async () => {
  const created = await request('/api/patients', { method: 'POST', body: JSON.stringify(patient) });
  assert.equal(created.status, 201);
  assert.equal(created.body.patient.firstName, 'Amina');
  const duplicate = await request('/api/patients', {
    method: 'POST', body: JSON.stringify({ ...patient, patientId: 'pt-001' }),
  });
  assert.equal(duplicate.status, 409);
});

test('records vitals, calculates BMI, and rejects a duplicate visit date', async () => {
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

test('enforces the BMI-specific assessment and one form per date', async () => {
  const wrong = await request('/api/patients/PT-001/assessments', {
    method: 'POST', body: JSON.stringify({ visitDate: '2026-10-02', type: 'general', generalHealth: 'Good', usingDrugs: 'No', comments: 'Well' }),
  });
  assert.equal(wrong.status, 400);
  const correct = await request('/api/patients/PT-001/assessments', {
    method: 'POST', body: JSON.stringify({ visitDate: '2026-10-02', type: 'overweight', generalHealth: 'Good', everDieted: 'Yes', comments: 'Discussed nutrition plan' }),
  });
  assert.equal(correct.status, 201);
  const duplicate = await request('/api/patients/PT-001/assessments', {
    method: 'POST', body: JSON.stringify({ visitDate: '2026-10-02', type: 'overweight', generalHealth: 'Good', everDieted: 'No', comments: 'Duplicate' }),
  });
  assert.equal(duplicate.status, 409);
});

test('routes BMI below 25 to the general assessment', async () => {
  const vitals = await request('/api/patients/PT-001/vitals', {
    method: 'POST', body: JSON.stringify({ visitDate: '2026-10-01', height: 170, weight: 65 }),
  });
  assert.equal(vitals.status, 201);
  assert.equal(vitals.body.nextAssessment, 'general');
  const assessment = await request('/api/patients/PT-001/assessments', {
    method: 'POST', body: JSON.stringify({ visitDate: '2026-10-01', type: 'general', generalHealth: 'Good', usingDrugs: 'No', comments: 'No concerns reported' }),
  });
  assert.equal(assessment.status, 201);
});

test('BMI exactly 25 displays Overweight but routes to general assessment', async () => {
  const result = await request('/api/patients/PT-001/vitals', {
    method: 'POST', body: JSON.stringify({ visitDate: '2026-09-30', height: 200, weight: 100 }),
  });
  assert.equal(result.status, 201);
  assert.equal(result.body.vital.bmi, 25);
  assert.equal(result.body.status, 'Overweight');
  assert.equal(result.body.nextAssessment, 'general');
});

test('patient listing returns the latest BMI and filters by visit date', async () => {
  const latest = await request('/api/patients');
  assert.equal(latest.status, 200);
  assert.equal(latest.body.patients[0].name, 'Amina Kamau');
  assert.equal(latest.body.patients[0].lastBmiStatus, 'Overweight');
  assert.equal(latest.body.patients[0].lastVisitDate, '2026-10-02');

  const filtered = await request('/api/patients?visitDate=2026-09-30');
  assert.equal(filtered.status, 200);
  assert.equal(filtered.body.patients.length, 1);
  assert.equal(filtered.body.patients[0].lastBmi, 25);
  assert.equal(filtered.body.patients[0].lastVisitDate, '2026-09-30');
});
