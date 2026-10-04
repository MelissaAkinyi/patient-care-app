CREATE TABLE IF NOT EXISTS patients (
  patient_id VARCHAR(80) PRIMARY KEY,
  registration_date DATE NOT NULL,
  first_name VARCHAR(120) NOT NULL,
  middle_name VARCHAR(120),
  last_name VARCHAR(120) NOT NULL,
  date_of_birth DATE NOT NULL,
  gender VARCHAR(20) NOT NULL CHECK (gender IN ('Male', 'Female', 'Other')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vitals (
  id UUID PRIMARY KEY,
  patient_id VARCHAR(80) NOT NULL REFERENCES patients(patient_id) ON DELETE CASCADE,
  visit_date DATE NOT NULL,
  height_cm NUMERIC(5, 1) NOT NULL CHECK (height_cm > 0),
  weight_kg NUMERIC(6, 1) NOT NULL CHECK (weight_kg > 0),
  bmi NUMERIC(4, 1) NOT NULL CHECK (bmi > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (patient_id, visit_date)
);

CREATE TABLE IF NOT EXISTS assessments (
  id UUID PRIMARY KEY,
  patient_id VARCHAR(80) NOT NULL,
  visit_date DATE NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('general', 'overweight')),
  general_health VARCHAR(10) NOT NULL CHECK (general_health IN ('Good', 'Poor')),
  ever_dieted VARCHAR(3) CHECK (ever_dieted IN ('Yes', 'No')),
  using_drugs VARCHAR(3) CHECK (using_drugs IN ('Yes', 'No')),
  comments TEXT NOT NULL CHECK (LENGTH(TRIM(comments)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (patient_id, visit_date),
  FOREIGN KEY (patient_id, visit_date) REFERENCES vitals(patient_id, visit_date) ON DELETE CASCADE,
  CHECK (
    (type = 'overweight' AND ever_dieted IS NOT NULL AND using_drugs IS NULL)
    OR (type = 'general' AND using_drugs IS NOT NULL AND ever_dieted IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_vitals_visit_date ON vitals(visit_date);
CREATE INDEX IF NOT EXISTS idx_assessments_patient_date ON assessments(patient_id, visit_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_patients_patient_id_lower ON patients(LOWER(patient_id));
