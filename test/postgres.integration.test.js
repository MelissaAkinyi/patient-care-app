const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { PostgresStore, ConflictError } = require('../database');

test('PostgreSQL persists the complete visit workflow', {
  skip: !process.env.TEST_DATABASE_URL && 'Set TEST_DATABASE_URL to run the PostgreSQL integration test',
}, async () => {
  const store = new PostgresStore({ connectionString: process.env.TEST_DATABASE_URL });
  const patientId = `TEST-${crypto.randomUUID()}`;
  await store.init();
  try {
    const patient = {
      patientId, registrationDate: '2026-10-02', firstName: 'Test', middleName: '',
      lastName: 'Patient', dateOfBirth: '1990-01-01', gender: 'Other',
    };
    await store.createPatient(patient);
    await assert.rejects(
      () => store.createPatient({ ...patient, patientId: patientId.toLowerCase() }),
      ConflictError,
    );

    await store.createVital({
      id: crypto.randomUUID(), patientId, visitDate: '2026-10-02',
      height: 180, weight: 81, bmi: 25,
    });
    const filtered = await store.listPatients('2026-10-02');
    assert.equal(filtered.some((item) => item.patientId === patientId && item.lastBmi === 25), true);

    await store.createAssessment({
      id: crypto.randomUUID(), patientId, visitDate: '2026-10-02', type: 'general',
      generalHealth: 'Good', usingDrugs: 'No', comments: 'Integration test',
    });
  } finally {
    await store.pool.query('DELETE FROM patients WHERE patient_id = $1', [patientId]);
    await store.close();
  }
});
