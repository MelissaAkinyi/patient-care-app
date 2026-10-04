# Afya Patient Care

A full-stack patient registration and visit workflow built for the Intellisoft practical assignment. It uses a dependency-free Node.js backend and a responsive HTML/CSS/JavaScript frontend.

## Included features

- Unique patient registration with required-field and date validation
- Vitals entry with automatic BMI calculation
- BMI-based routing to General Assessment (`BMI <= 25`) or Overweight Assessment (`BMI > 25`)
- One vitals and assessment submission per patient per visit date
- Patient listing with age, latest BMI, latest visit, and BMI status
- Repeat visits for existing patients
- Persistent JSON storage and automated API tests

## Run locally

Node.js 18 or newer is required. No package installation is needed.

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000).

Run the automated tests with:

```bash
npm test
```

## API approach

This implementation uses its own backend endpoints rather than the external Postman collection:

- `GET /api/patients`
- `POST /api/patients`
- `GET /api/patients/:patientId`
- `POST /api/patients/:patientId/vitals`
- `POST /api/patients/:patientId/assessments`

Data is stored in `data/store.json`. For production, this storage layer should be replaced with a transactional database and authentication should be added before handling real patient data.
