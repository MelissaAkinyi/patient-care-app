# Afya Patient Care

A responsive full-stack application for registering patients, recording height and weight, calculating BMI, completing BMI-specific assessments, and reviewing patient visit records.

## Approach

This submission implements its **own Node.js backend and PostgreSQL database**. It does not consume the external Postman APIs. The browser submits registration, vitals, and assessment data to the API endpoints provided by this repository.

## Features

- Unique, case-insensitive patient number
- Registration followed automatically by vitals entry
- Live BMI calculation from height in centimetres and weight in kilograms
- One vitals record and one assessment per patient per visit date
- Automatic General or Overweight assessment routing
- Backend enforcement of the correct assessment
- Patient listing with name, age, latest visit, BMI, and BMI status
- Patient search and visit-date filtering
- Repeat visits for existing patients
- Responsive desktop and mobile interface
- PostgreSQL constraints, relationships, and indexes
- Unit/API tests and a real PostgreSQL integration test

## Technology stack

- **Frontend:** HTML5, CSS3, and vanilla JavaScript
- **Backend:** Node.js HTTP server and REST-style JSON endpoints
- **Database:** PostgreSQL 16
- **Database client:** pg
- **Configuration:** dotenv
- **Testing:** Node.js built-in test runner
- **Local database:** Docker Compose

## Prerequisites

- Node.js 18 or newer
- npm
- Docker Desktop or another running PostgreSQL instance

## Setup

1. Clone the repository and enter it:

   ~~~bash
   git clone https://github.com/MelissaAkinyi/patient-care-app.git
   cd patient-care-app
   ~~~

2. Install dependencies:

   ~~~bash
   npm install
   ~~~

3. Create the local environment file:

   ~~~bash
   cp .env.example .env
   ~~~

4. Start PostgreSQL:

   ~~~bash
   npm run db:up
   ~~~

5. Start the application:

   ~~~bash
   npm start
   ~~~

6. Open [http://localhost:3000](http://localhost:3000).

The application applies the idempotent schema in **db/schema.sql** when the server starts. Existing tables and records are preserved.

To use an existing PostgreSQL server, replace DATABASE_URL in **.env** with its connection string instead of running Docker Compose.

## Commands

| Command | Purpose |
| --- | --- |
| npm start | Start the API and frontend |
| npm run dev | Start with Node.js watch mode |
| npm test | Run unit and API tests |
| npm run db:up | Start local PostgreSQL |
| npm run db:down | Stop PostgreSQL without deleting its data volume |

Run every test, including the real PostgreSQL integration test:

~~~bash
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/patient_care npm test
~~~

Use a dedicated test database when running the integration test against anything other than the included local Docker service.

## API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | /api/patients | List patients with their latest BMI |
| GET | /api/patients?visitDate=YYYY-MM-DD | List patients who visited on a selected date |
| POST | /api/patients | Register a patient |
| GET | /api/patients/:patientId | Get one patient and their vitals history |
| POST | /api/patients/:patientId/vitals | Record dated vitals |
| POST | /api/patients/:patientId/assessments | Submit the BMI-appropriate assessment |

## Data model

- **patients.patient_id** is the patient-facing unique identifier.
- **vitals** has a unique constraint on patient and visit date.
- **assessments** has a unique constraint on patient and visit date.
- Assessments reference an existing vitals visit through a composite foreign key.
- Deleting a patient cascades to associated visits and assessments.

## BMI rules and assumptions

BMI is rounded to one decimal place:

~~~text
BMI = weight in kilograms / (height in metres × height in metres)
~~~

Listing status follows the supplied thresholds:

- **Underweight:** BMI below 18.5
- **Normal:** BMI from 18.5 to below 25
- **Overweight:** BMI of 25 or above

Assessment routing follows the separate assignment rule:

- **General Assessment:** BMI of 25 or below
- **Overweight Assessment:** BMI above 25

Consequently, a BMI of exactly 25 is displayed as Overweight in the listing but routes to the General Assessment. Visit-date filtering displays the BMI recorded on the selected date; with no filter, the newest dated BMI is displayed.

Age is calculated from date of birth at request time. Dates are stored as PostgreSQL DATE values and cannot be in the future through the application.

## Demonstration flow

1. Register a patient.
2. Enter visit date, height, and weight and observe the live BMI.
3. Save vitals and confirm that the correct assessment opens.
4. Complete all assessment fields.
5. Confirm the patient appears in the listing with age and BMI status.
6. Start another visit on a different date.
7. Filter the listing by that visit date.

## Production note

This is an interview assignment, not a production medical-record system. A production deployment should add authentication, authorization, audit logging, encrypted transport, backups, secrets management, and applicable health-data compliance controls.
