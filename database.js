const fs = require('node:fs');
const path = require('node:path');
const { Pool, types } = require('pg');

types.setTypeParser(1082, (value) => value);

class ConflictError extends Error {}

const mapPatient = (row) => ({
  patientId: row.patient_id,
  registrationDate: row.registration_date,
  firstName: row.first_name,
  middleName: row.middle_name || '',
  lastName: row.last_name,
  dateOfBirth: row.date_of_birth,
  gender: row.gender,
  createdAt: row.created_at,
});

const mapVital = (row) => ({
  id: row.id,
  patientId: row.patient_id,
  visitDate: row.visit_date,
  height: Number(row.height_cm),
  weight: Number(row.weight_kg),
  bmi: Number(row.bmi),
  createdAt: row.created_at,
});

class PostgresStore {
  constructor({ connectionString, pool } = {}) {
    if (!pool && !connectionString) throw new Error('DATABASE_URL is required');
    this.pool = pool || new Pool({ connectionString });
    this.ownsPool = !pool;
  }

  async init() {
    const schema = fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf8');
    await this.pool.query(schema);
  }

  async close() {
    if (this.ownsPool) await this.pool.end();
  }

  async listPatients(visitDate) {
    const params = visitDate ? [visitDate] : [];
    const dateCondition = visitDate ? 'AND candidate.visit_date = $1::date' : '';
    const onlyMatchingVisits = visitDate ? 'WHERE latest.visit_date IS NOT NULL' : '';
    const result = await this.pool.query(`
      SELECT patient.*, latest.visit_date, latest.bmi
      FROM patients AS patient
      LEFT JOIN LATERAL (
        SELECT candidate.visit_date, candidate.bmi
        FROM vitals AS candidate
        WHERE candidate.patient_id = patient.patient_id ${dateCondition}
        ORDER BY candidate.visit_date DESC, candidate.created_at DESC
        LIMIT 1
      ) AS latest ON TRUE
      ${onlyMatchingVisits}
      ORDER BY patient.created_at DESC
    `, params);
    return result.rows.map((row) => ({
      ...mapPatient(row),
      lastVisitDate: row.visit_date || null,
      lastBmi: row.bmi === null ? null : Number(row.bmi),
    }));
  }

  async createPatient(patient) {
    try {
      const result = await this.pool.query(`
        INSERT INTO patients (patient_id, registration_date, first_name, middle_name, last_name, date_of_birth, gender)
        VALUES ($1, $2, $3, NULLIF($4, ''), $5, $6, $7)
        RETURNING *
      `, [patient.patientId, patient.registrationDate, patient.firstName, patient.middleName, patient.lastName, patient.dateOfBirth, patient.gender]);
      return mapPatient(result.rows[0]);
    } catch (error) {
      if (error.code === '23505') throw new ConflictError('A patient with this patient number is already registered');
      throw error;
    }
  }

  async getPatient(patientId) {
    const result = await this.pool.query('SELECT * FROM patients WHERE LOWER(patient_id) = LOWER($1)', [patientId]);
    return result.rows[0] ? mapPatient(result.rows[0]) : null;
  }

  async getVitals(patientId) {
    const result = await this.pool.query('SELECT * FROM vitals WHERE patient_id = $1 ORDER BY visit_date DESC', [patientId]);
    return result.rows.map(mapVital);
  }

  async createVital(vital) {
    try {
      const result = await this.pool.query(`
        INSERT INTO vitals (id, patient_id, visit_date, height_cm, weight_kg, bmi)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `, [vital.id, vital.patientId, vital.visitDate, vital.height, vital.weight, vital.bmi]);
      return mapVital(result.rows[0]);
    } catch (error) {
      if (error.code === '23505') throw new ConflictError('Vitals have already been recorded for this patient on this date');
      throw error;
    }
  }

  async getVital(patientId, visitDate) {
    const result = await this.pool.query('SELECT * FROM vitals WHERE patient_id = $1 AND visit_date = $2', [patientId, visitDate]);
    return result.rows[0] ? mapVital(result.rows[0]) : null;
  }

  async createAssessment(assessment) {
    try {
      const result = await this.pool.query(`
        INSERT INTO assessments (id, patient_id, visit_date, type, general_health, ever_dieted, using_drugs, comments)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `, [assessment.id, assessment.patientId, assessment.visitDate, assessment.type, assessment.generalHealth,
        assessment.everDieted || null, assessment.usingDrugs || null, assessment.comments]);
      const row = result.rows[0];
      return {
        id: row.id, patientId: row.patient_id, visitDate: row.visit_date, type: row.type,
        generalHealth: row.general_health, everDieted: row.ever_dieted,
        usingDrugs: row.using_drugs, comments: row.comments, createdAt: row.created_at,
      };
    } catch (error) {
      if (error.code === '23505') throw new ConflictError('An assessment has already been submitted for this visit date');
      throw error;
    }
  }
}

module.exports = { PostgresStore, ConflictError };
