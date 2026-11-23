# Fixtures

Synthetic, PHI-free FHIR resources that `compose.yaml` loads into fhir-candle at start
(`fixtures/r4` and `fixtures/r5`, one file per resource, fixed ids). Data is in memory:
restart the container to reset it.

- Patient: `patient-1`, `patient-2`, `patient-3`
- Practitioner: `practitioner-1`
- Encounter: `encounter-1`, `encounter-2`, `encounter-3` (all for `patient-1`)
- `eid/`: invented eID cards for the eID check (see `eid/README.md`). Not loaded into fhir-candle.
  `patient-1` carries an invented national number (SSIN identifier) that one of them matches.

The R5 files use the R5 shape (`actualPeriod`, `class` as a CodeableConcept list,
`participant.actor`, status `completed`).

## fhir-candle is more permissive than the Tiro FHIR facade

Checked against fhir-candle 0.2026.708.1349. Code that works here can still fail against the real EHR.

| Aspect                        | Facade                                                                                       | fhir-candle                                    | Match                   |
| ----------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------- | ----------------------- |
| FHIR version                  | R4 4.0.1 and R5 5.0.0                                                                        | R4 4.0.1 and R5 5.0.0 as separate tenants      | yes                     |
| Patient                       | rs: `_id`, `family`, `given`, `gender`, `identifier`                                         | full CRUD, declares all of these               | yes (superset)          |
| Encounter                     | rscud: `_id`, `class`, `date`, `date-start`, `patient`, `status`, `subject`                  | full CRUD; R4 lacks `date-start`               | R4 `date-start` missing |
| Practitioner                  | rs: `_id`, `family`, `given`, `identifier`                                                   | full CRUD, declares all of these               | yes (superset)          |
| Basic (App State)             | rscud: `_id`, `code`, `subject`                                                              | create and search by `code` and `subject` work | happy path only         |
| `_include`, `_sort`, `_count` | supported                                                                                    | work                                           | yes                     |
| Other types                   | Claim, ClaimResponse, Coverage, DocumentReference, Binary, Task, MedicationRequest (R4 only) | all base types                                 | superset                |
| Auth and scopes               | SMART token, scope-checked                                                                   | none                                           | by design               |

Where it differs:

1. `Basic` is not checked against SMART App State rules: one coding, a Practitioner subject,
   `valueString` extensions only, 256 KB. A version is not required on delete either.
2. Unknown search parameters are ignored and return everything; the facade does not serve them.
3. R5 Encounter status uses R5 codes here (`completed`); the facade stores R4 codes on both
   bases, so `status=finished` works there and finds nothing here.
4. R4 Encounter has no `date-start` search parameter.
5. EHR profiles (EHRPatient and the rest) are not loaded, so writes are not validated.
6. Update with If-Match and SMART-required mode were not tested.

## Bundle links

candle starts with `--url http://fhir-candle:5826`, the address the sidecar dev mode uses on the
compose network. Bundle links (`self`, `next`, `fullUrl`) therefore read `fhir-candle:5826` when
you fetch them from the host. Requests to `localhost:5826` still work; only the links differ.
