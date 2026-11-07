# Patient Registration — Specification

> **Stage:** specification only — no code yet.
> **Stack:** React 18 + TypeScript (custom components, no UI library), FastAPI, PostgreSQL, a separate email worker, MailHog (local SMTP catcher), Docker Compose.

---

## 1  Requirements & Acceptance Criteria

Each requirement has an ID (`R-xx`) and a category:

- **must** — mandatory per the challenge statement.
- **pref** — stated in the challenge as a preference ("ideally", "nice to have"); implemented, but not a blocker.
- **decision** — not in the challenge; a project decision needed to make the behavior testable (see §3).

### 1.1  Patient List

| ID | Cat. | Requirement | Acceptance Criteria |
|----|------|-------------|---------------------|
| R-01 | must | The home page lists registered patients as cards. | With N patients in the database, `GET /patients` returns N items and the page renders N cards, newest first. |
| R-02 | must | A closed card shows only the patient's full name and photo. | A collapsed card contains the `full_name` text and an `<img>` loaded from `photo_url`; email and phone are not in the DOM. |
| R-03 | must | Expanding a card reveals email and phone. | Clicking (or pressing Enter/Space on) a closed card shows email and `phone_prefix` + `phone_number`; clicking again hides them. Cards expand independently. |
| R-04 | must | An **Add Patient** button is always visible. | The button is present during loading, in the empty state, and with a populated list. |
| R-05 | must | Loading state while the list is fetched. | While `GET /patients` is pending, a loading indicator is shown and no empty-state message appears. *(decision)* If the request fails, an error message with a **Retry** button replaces the indicator. |
| R-06 | must | Empty state when there are no patients. | With an empty database, the page shows "No patients yet" and the Add Patient button. |

### 1.2  Registration Form

| ID | Cat. | Requirement | Acceptance Criteria |
|----|------|-------------|---------------------|
| R-07 | must | **Add Patient** opens the registration form. | The form (in a modal) has: full name, email, phone prefix, phone number, and photo. |
| R-08 | must | Frontend validation before sending. | Submitting with any invalid field sends **no** request (verifiable in the Network tab or by a mocked `fetch` in tests). Rules are D-01 to D-06. |
| R-09 | must | Validation errors appear below their fields **after the first submit attempt**. | Before the first submit, no error is shown even if fields are invalid. After it, each invalid field shows its message directly below the input; messages stay visible and update while typing (disappear when fixed, reappear if broken again). |
| R-10 | pref | Field error messages animate in. | The error element enters with a CSS transition/keyframe (≈150–250 ms). Not a blocker. |
| R-11 | must | Photo input accepts **drag & drop** and **file selection**. | Dropping a `.jpg` on the zone or choosing it via the file dialog selects it and shows its file name (or a preview); a new drop/selection replaces it. Non-`.jpg` files are rejected with an error under the photo field. |
| R-12 | must | Backend validates every field independently of the frontend. | A direct `curl` with invalid data returns `422` with one error per invalid field (format in §2.4). Covers D-01 to D-06. |
| R-13 | must | A duplicate email is shown below the email field. | Registering an email that already exists (case-insensitive, D-03) returns `422` with `field: "email"`; the UI shows the message under the email input, not in a modal. |
| R-14 | must | Success shows an **animated** success modal and refreshes the list. | After `201`, the form closes, an animated success modal appears (enter transition ≈200 ms, opacity + scale/translate), and the list re-fetches and shows the new card without a page reload. |
| R-15 | must | A general failure shows an **animated** error modal. | On network error, any `5xx`, or an unexpected response, an animated error modal appears (same enter transition). After closing it, the form is still open with all entered data (including the photo) so the user can retry. |

### 1.3  Data and Email

| ID | Cat. | Requirement | Acceptance Criteria |
|----|------|-------------|---------------------|
| R-16 | must | Patients are stored in PostgreSQL. | `\dt` shows `patients` and `email_jobs`; a restarted stack (`docker compose restart`) still lists previous patients. |
| R-17 | decision | Email uniqueness is enforced by the database. | A unique index on `lower(email)` exists (`\d patients`); two concurrent inserts of the same email produce exactly one row. |
| R-18 | must | The photo is accessible through the API. | `GET /patients/{id}/photo` returns `200` with `Content-Type: image/jpeg` and the stored bytes; unknown id → `404`. |
| R-19 | must | The confirmation email is sent asynchronously. | With the worker stopped, `POST /patients` still returns `201` and a `pending` job exists; MailHog has no message. After starting the worker, the email arrives in MailHog (see §4.5). |
| R-20 | must | Email jobs are persisted with the patient, atomically. | Patient and job are inserted in one transaction: there is never a patient without a job nor a job without a patient. Jobs survive worker/API restarts. |
| R-21 | must | SMTP failures never affect registration. | With MailHog stopped, registration returns `201`; the job records the error and is retried; once MailHog is back the email is delivered. |

### 1.4  Infrastructure and Delivery

| ID | Cat. | Requirement | Acceptance Criteria |
|----|------|-------------|---------------------|
| R-22 | must | The whole system starts with Docker Compose. | From a clean checkout, `docker compose up --build` starts `db`, `api`, `worker`, `web`, `mailhog`; the UI is at `http://localhost:3000`, the API at `http://localhost:8000`, MailHog at `http://localhost:8025`. No other host tooling required. |
| R-23 | must | Anonymous delivery as a ZIP for the People team. | The ZIP extracts to `challenge/`; no file **name or content** contains personal identifiers (name, email, usernames, local paths), and it includes no `.git` directory (§5.3). |
| R-24 | pref | README with run instructions. | `README.md` explains prerequisites, startup command, URLs, how to see emails in MailHog, and the decisions in §3. |
| R-25 | decision | SMS is documented as a future extension, not implemented. | §4.6 describes the extension path; no SMS code exists. |

---

## 2  API Contract

Base URL: `http://localhost:8000`. All JSON uses UTF-8. CORS allows `http://localhost:3000`.

### 2.1  Create Patient — `POST /patients`

`Content-Type: multipart/form-data`

| Part | Type | Rules |
|------|------|-------|
| `full_name` | text | Required. D-01. |
| `email` | text | Required. Valid email with domain exactly `gmail.com` (D-02). Unique after normalization (D-03). |
| `phone_prefix` | text | Required. `+` followed by 1–4 digits, first digit not `0` (e.g. `+54`, `+1`). D-04. |
| `phone_number` | text | Required. 6–15 digits only. D-04. |
| `photo` | file | Required. `.jpg` extension, ≤ 5 MB, verified JPEG, fully decodable (D-05, D-06). |

**201 Created**

```json
{
  "id": 1,
  "full_name": "María José Pérez",
  "email": "maria.perez@gmail.com",
  "phone_prefix": "+54",
  "phone_number": "1155667788",
  "photo_url": "/patients/1/photo",
  "created_at": "2026-11-07T14:30:00Z"
}
```

`email` is returned normalized (trimmed, lowercase). `full_name` is returned trimmed.

### 2.2  List Patients — `GET /patients`

**200 OK** — array of the same object as in §2.1, ordered by `created_at` descending. Empty database → `[]`. No pagination in this version.

### 2.3  Patient Photo — `GET /patients/{id}/photo`

**200 OK** with `Content-Type: image/jpeg` and the original uploaded bytes. **404** with the general error format if the patient does not exist. `photo_url` in responses is relative to the API base URL; the frontend prefixes it.

### 2.4  Error Format

**Field validation — 422** (used for every field error, including duplicate email and photo errors):

```json
{
  "errors": [
    { "field": "full_name", "message": "Use letters and single spaces only." },
    { "field": "email", "message": "A patient with this email already exists." }
  ]
}
```

- `field` is one of the five part names above. At most one message per field.
- FastAPI's default 422 body (`detail` with `loc`) is replaced by this format via a custom exception handler, so missing parts also come back as `{ "field": "<part>", "message": "Required." }`.

**General errors — 4xx/5xx other than 422**:

```json
{ "message": "Something went wrong. Please try again." }
```

### 2.5  How the UI Handles Responses

| Response | UI behavior |
|----------|-------------|
| `201` | Close form, open animated success modal, re-fetch list (R-14). |
| `422` with `errors` | Show each message under its field; form stays open (R-09, R-13). A server error on a field is cleared when the user edits that field; client rules then apply. |
| `422` with an unknown `field`, any other status, malformed body, or network error | Animated error modal; form data preserved (R-15). |

---

## 3  Project Decisions on Open Points

The challenge leaves these points open. Each rule below is a **project decision** and applies identically in React and FastAPI.

### 3.1  D-01 — Full name

Defined by behavior, not by a specific regex engine (JavaScript and Python regex differ on Unicode classes):

1. Normalize to Unicode NFC (so `é` typed as `e` + combining accent equals `é`).
2. Remove leading and trailing whitespace.
3. The result must be one or more **words** separated by **exactly one regular space** (U+0020).
4. A word is one or more Unicode **letters** (general category L). No digits, hyphens, apostrophes, dots, underscores, tabs, or other symbols.
5. Length after steps 1–2: 1 to 100 characters (Unicode code points).
6. The stored and returned value is the result of steps 1–2. No other changes (no case changes, no space collapsing).

*Implementation hints:* React — `[...s].length` for length, `/^\p{L}+(?: \p{L}+)*$/u`. FastAPI — `s.split(" ")` and `word.isalpha()` per word (Python's `isalpha` matches category L).

**Shared examples** — both test suites (Vitest and pytest) must include every row:

| Input (quotes for clarity) | Result | Stored as |
|----------------------------|--------|-----------|
| `"María"` | ✅ valid | `María` |
| `"  María José Pérez  "` | ✅ valid | `María José Pérez` |
| `"Zoë Ñúñez"` | ✅ valid | `Zoë Ñúñez` |
| `"José"` in NFD (e + U+0301) | ✅ valid | `José` (NFC) |
| `"李小龙"` | ✅ valid | `李小龙` |
| `""` | ❌ required | — |
| `"   "` | ❌ empty after trim | — |
| `"Ana  María"` (two spaces) | ❌ single spaces only | — |
| `"Ana\tMaría"` | ❌ tab not allowed | — |
| `"O'Brien"` | ❌ apostrophe | — |
| `"García-López"` | ❌ hyphen | — |
| `"John3"` | ❌ digit | — |
| `"Dr. Smith"` | ❌ dot | — |
| 101 letters | ❌ too long | — |

### 3.2  D-02 — Gmail domain

After trimming and lowercasing, the address must have a non-empty local part and the domain **exactly** `gmail.com`. `googlemail.com`, subdomains (`mail.gmail.com`) and look-alikes (`gmail.co`) are rejected. The local part accepts letters, digits, `.`, `+`, `_`, `-`; no leading/trailing dot and no `..`.

| Input | Result |
|-------|--------|
| `ana.perez@gmail.com` | ✅ |
| `  Ana.Perez@GMAIL.com ` | ✅ stored as `ana.perez@gmail.com` |
| `ana+clinic@gmail.com` | ✅ |
| `ana@googlemail.com` | ❌ |
| `ana@mail.gmail.com` | ❌ |
| `ana@gmail.co` | ❌ |
| `.ana@gmail.com`, `ana..p@gmail.com` | ❌ |

### 3.3  D-03 — Email normalization and uniqueness

- Normalization: trim + lowercase. Gmail dot and `+tag` equivalence are **not** applied (`ana.perez@` and `anaperez@` are different patients).
- The normalized value is stored. PostgreSQL enforces uniqueness:

  ```sql
  CREATE UNIQUE INDEX uq_patients_email_lower ON patients (lower(email));
  ```

- The API does not rely on a prior `SELECT`: it inserts and maps the unique-violation (`IntegrityError` on `uq_patients_email_lower`) to `422` `{ "field": "email", "message": "A patient with this email already exists." }`. This is correct under concurrent requests.

### 3.4  D-04 — Phone prefix and number

Two separate inputs and columns. Prefix: `+` and 1–4 digits, not starting with `0` (`+54` ✅, `54` ❌, `+054` ❌, `+12345` ❌). Number: 6–15 digits, no spaces, dashes, or parentheses (`1155667788` ✅, `11 5566` ❌, `12345` ❌). Inputs are trimmed before validation. No country-specific rules.

### 3.5  D-05 — Photo size limit

Maximum **5 MB = 5 242 880 bytes**. The frontend checks `file.size`; the backend reads the upload in chunks and stops with `422` (`field: "photo"`) once the limit is exceeded, without loading more into memory.

### 3.6  D-06 — JPG validation

The backend accepts a photo only if **all** checks pass, in this order (first failure wins):

1. **Extension:** filename ends in `.jpg`, case-insensitive (`.JPG` ✅; `.jpeg`, `.png`, no extension ❌).
2. **Size:** 1 byte to 5 MB (D-05).
3. **JPEG format:** content starts with the SOI marker `FF D8 FF` **and** Pillow identifies it as `JPEG` (`Image.open(...).format == "JPEG"`). The client-sent `Content-Type` is ignored.
4. **Full decode:** `image.load()` succeeds with `ImageFile.LOAD_TRUNCATED_IMAGES = False`. (`verify()` alone is not enough: it does not decode the pixel data, so it can miss truncated files.)

The frontend applies checks 1–2 (and rejects non-`image/jpeg` MIME types when the browser provides one). Checks 3–4 are backend-only; their errors are shown under the photo field.

**Shared test cases** (fixtures generated by a script with Pillow — no real photos, no EXIF):

| File | Expected |
|------|----------|
| `valid.jpg` — real JPEG, ~100 KB | ✅ 201 |
| `VALID.JPG` — same file, uppercase extension | ✅ 201 |
| `valid.jpeg` — real JPEG, `.jpeg` extension | ❌ 422 extension |
| `renamed.jpg` — PNG bytes with `.jpg` name | ❌ 422 format |
| `truncated.jpg` — first half of `valid.jpg` (starts with `FF D8 FF`) | ❌ 422 decode |
| `fake-header.jpg` — `FF D8 FF` followed by random bytes | ❌ 422 format/decode |
| `empty.jpg` — 0 bytes | ❌ 422 size |
| `big.jpg` — valid JPEG > 5 MB | ❌ 422 size (frontend blocks it before sending) |

### 3.7  D-07 — Photo storage

Photos are stored as `bytea` in the `patients` table. This keeps patient, photo, and email job in one transaction and one backup, with no extra volume. Acceptable for ≤ 5 MB and challenge-scale data; a file/object store would replace it at larger scale.

---

## 4  Email Flow

### 4.1  Tables

```
patients(id, full_name, email, phone_prefix, phone_number,
         photo bytea, created_at)
email_jobs(id, patient_id FK → patients, status, attempts,
           next_attempt_at, last_error, created_at, sent_at)
status ∈ {pending, sent, failed}
```

### 4.2  Atomic persistence

The API inserts patient and job in **one transaction**, then responds:

```sql
BEGIN;
  INSERT INTO patients (...) VALUES (...) RETURNING id;
  INSERT INTO email_jobs (patient_id, status, attempts, next_attempt_at)
       VALUES (:id, 'pending', 0, now());
COMMIT;
```

If either insert fails (validation, duplicate email, DB error), nothing is stored and no email will be sent. Once `201` is returned, the job is durable even if the API or worker crashes. The API never connects to SMTP.

### 4.3  Immediate eligibility

Every new job is created with `next_attempt_at = now()`, so it is **eligible immediately**. The worker polls every **2 seconds**, so with a running worker the email normally reaches MailHog within a few seconds.

### 4.4  Worker and SMTP failures

Loop:

1. In a transaction, take up to 10 jobs: `status = 'pending' AND next_attempt_at <= now()`, ordered by `id`, `FOR UPDATE SKIP LOCKED` (safe if more than one worker runs).
2. For each job, send the confirmation email (plain text + HTML) to MailHog at `mailhog:1025`.
3. Success → `status = 'sent'`, `sent_at = now()`.
4. Failure (connection refused, timeout, SMTP error) → `attempts += 1`, `last_error` saved; if `attempts < 5`, `next_attempt_at = now() + 30 s × 2^(attempts − 1)` (30 s, 1 min, 2 min, 4 min); at the 5th failure `status = 'failed'`.
5. Commit and repeat.

Delivery is **at-least-once**: if the worker dies after SMTP accepted the message but before commit, the job is retried and the email may be sent twice. Acceptable for a confirmation email. The patient record is never modified by the worker.

### 4.5  Verification of asynchrony

Proves that the API answers without waiting for the email:

```bash
docker compose stop worker
curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:8000/patients \
  -F "full_name=Ana Pérez" -F "email=ana.perez@gmail.com" \
  -F "phone_prefix=+54" -F "phone_number=1155667788" \
  -F "photo=@api/tests/fixtures/valid.jpg"                  # → 201
docker compose exec db psql -U app -d patients -c \
  "select status, attempts from email_jobs order by id desc limit 1;"   # → pending | 0
curl -s "localhost:8025/api/v2/search?kind=to&query=ana.perez@gmail.com"   # → "total":0
docker compose start worker
# within ~10 s:
curl -s "localhost:8025/api/v2/search?kind=to&query=ana.perez@gmail.com"   # → "total":1
docker compose exec db psql -U app -d patients -c \
  "select status from email_jobs order by id desc limit 1;"            # → sent
```

SMTP failure (R-21): `docker compose stop mailhog`, register a patient (→ `201`), check the job has `attempts = 1`, `last_error` set, `status = pending`; `docker compose start mailhog`; after the backoff the job becomes `sent` and the email appears.

### 4.6  Future SMS (not implemented)

Rename `email_jobs` to `notification_jobs` with a `channel` column (`email`, `sms`) and a per-channel payload/recipient. On registration, insert one job per channel in the same transaction. The worker dispatches by channel to a sender interface (`EmailSender`, `SmsSender`); the SMS sender wraps a provider API and, locally, a fake that logs messages. Retries, backoff, and atomicity stay as above. Current scope: email confirmation only.

---

## 5  Delivery Plan

### 5.1  Stages and commits

One commit per stage. Each check is runnable from the repository root.

| # | Stage | Commit | IDs | Check |
|---|-------|--------|-----|-------|
| E1 | Spec | `docs: define patient registration specification` | all (definition) | `git show --stat HEAD` contains only `docs/spec.md`; coverage reviewed with the matrix in §6. |
| E2 | Environment | `chore: add docker compose environment` | R-22 | `docker compose up --build -d` → `docker compose ps` shows 5 services running; `curl localhost:8000/health` → `{"status":"ok"}`; `localhost:3000` serves a placeholder page; `localhost:8025` opens MailHog. |
| E3 | API | `feat(api): add patient registration and listing endpoints` | R-01 (API), R-12, R-13, R-16, R-17, R-18, R-20 | `docker compose exec api pytest` passes: D-01…D-06 shared cases, duplicate email (incl. different case), concurrent duplicate insert, list order, photo endpoint, patient + job inserted atomically. Plus the `curl` in §4.5 returns `201`. |
| E4 | Async email | `feat(worker): send confirmation emails asynchronously` | R-19, R-20, R-21 | `docker compose exec worker pytest` passes (backoff, failure → retry, 5 failures → `failed`); manual script in §4.5 (worker stopped → `201` + `pending` → start → MailHog `total:1`) and the SMTP-failure check. |
| E5 | React list | `feat(web): add patient list with expandable cards` | R-01…R-06 | `docker compose exec web npm test` passes (closed card has name + photo only; expanded shows email + phone; loading, empty, error states). In the browser: empty DB → "No patients yet"; after `curl` registration → card appears after reload and expands. |
| E6 | Form + full flow | `feat(web): add patient form and complete registration flow` | R-07…R-11, R-13…R-15 | `docker compose exec web npm test` passes (D-01 shared name cases, D-02/D-04/D-05 rules, errors hidden before first submit and shown after, no request on invalid form, 422 mapping, error modal keeps data). Browser checklist in §5.2. |
| E7 | Review + delivery | `chore: add readme and prepare anonymous delivery` | R-22…R-25, all | Clean-environment run and anonymity check in §5.3 pass; full matrix in §6 re-checked. |

### 5.2  Browser checklist (E6, repeated in E7)

1. Empty DB → "No patients yet" + Add Patient.
2. Add Patient → submit empty form → errors under all five fields; Network tab shows no request.
3. Fix fields one by one → each error disappears as it is fixed.
4. Drag `valid.jpg` onto the zone → file accepted; select `renamed.jpg` via the dialog → submit → error under photo (from backend).
5. Valid data → animated success modal → card appears without reload; closed card shows name + photo; expand → email + phone.
6. Register the same email in uppercase → error under email.
7. `docker compose stop api` → submit → animated error modal → close → data still in form → `docker compose start api` → submit succeeds.
8. MailHog shows one confirmation email per successful registration.

### 5.3  Clean environment and anonymous ZIP (E7)

**Build the ZIP** from the committed tree (archiving the tree instead of the commit avoids embedding the commit ID as a ZIP comment; `.git` is never included):

```bash
git status --porcelain            # must be empty
git archive --format=zip --prefix=challenge/ -o ../challenge.zip "HEAD^{tree}"
```

**Anonymity check** — names and contents. `PERSONAL` is a regex of your own identifiers (name, surname, email, GitHub user, Windows user folder) defined **only in your shell**, never written to the repository:

```bash
PERSONAL='...'                                        # set locally, not committed
unzip -Z1 ../challenge.zip                            # review the file list by eye
unzip -Z1 ../challenge.zip | grep -i -E "$PERSONAL"   # file names → must print nothing
unzip -p  ../challenge.zip | grep -a -i -E "$PERSONAL" # file contents → must print nothing
unzip -p  ../challenge.zip | grep -a -i -E "C:\\\\Users|/home/|@gmail\.com"  # paths/emails: only test addresses allowed
unzip -z  ../challenge.zip                            # archive comment → empty
```

Also check by hand: `author` fields in `package.json` / `pyproject.toml`, license headers, fixtures (generated, no EXIF), and `.env` files (only `.env.example` with non-personal defaults).

**Start from a clean environment** — new directory, unique Compose project name, no previous volumes or images:

```bash
rm -rf /tmp/verify && mkdir /tmp/verify
unzip -q ../challenge.zip -d /tmp/verify
cd /tmp/verify/challenge
docker compose -p challenge-verify up --build -d
docker compose -p challenge-verify ps                 # 5 services running
# run the browser checklist (§5.2) and the async check (§4.5, with -p challenge-verify)
docker compose -p challenge-verify down -v
```

The resulting `challenge.zip` is the file uploaded to the People team's form.

---

## 6  Traceability Matrix

| Req | Acceptance criterion (short) | Verification |
|-----|------------------------------|--------------|
| R-01 | N patients → N cards, newest first | E3 pytest (list order); E5 Vitest + browser |
| R-02 | Closed card: name + photo only | E5 Vitest (email/phone absent from DOM) |
| R-03 | Expanded card: email + phone; toggles | E5 Vitest + browser |
| R-04 | Add Patient visible in all states | E5 Vitest (loading / empty / list) |
| R-05 | Loading indicator; error + Retry on failure | E5 Vitest (mocked pending/failed fetch) |
| R-06 | "No patients yet" when empty | E5 Vitest + §5.2 step 1 |
| R-07 | Form with five fields | E6 Vitest + §5.2 step 2 |
| R-08 | Invalid form sends no request | E6 Vitest (mocked fetch not called) + §5.2 step 2 |
| R-09 | Errors under fields only after first submit, live updates | E6 Vitest + §5.2 steps 2–3 |
| R-10 | *(pref)* Field errors animate in | E6 visual check |
| R-11 | Drag & drop and file dialog; non-`.jpg` rejected | E6 Vitest (drop + change events) + §5.2 step 4 |
| R-12 | Backend 422 per field (D-01…D-06 shared cases) | E3 pytest |
| R-13 | Duplicate email (any case) under email field | E3 pytest; E6 Vitest + §5.2 step 6 |
| R-14 | Animated success modal + list refresh without reload | E6 Vitest + §5.2 step 5 |
| R-15 | Animated error modal; data preserved | E6 Vitest + §5.2 step 7 |
| R-16 | Data in PostgreSQL, survives restart | E3 `\dt` + `docker compose restart` |
| R-17 | Unique index on `lower(email)`; concurrent duplicates → 1 row | E3 `\d patients` + pytest |
| R-18 | Photo endpoint returns JPEG / 404 | E3 pytest |
| R-19 | Worker stopped → `201` + `pending`; started → MailHog | E4 §4.5 script |
| R-20 | Patient + job in one transaction; jobs survive restarts | E3 pytest (forced job-insert failure → no patient); E4 §4.5 |
| R-21 | MailHog down → `201`, retry, later delivered | E4 pytest + §4.5 SMTP-failure check |
| R-22 | `docker compose up --build` starts everything | E2; E7 clean environment |
| R-23 | ZIP → `challenge/`; no personal names/contents; no `.git` | E7 §5.3 |
| R-24 | *(pref)* README | E7 review |
| R-25 | SMS documented, not implemented | E1 §4.6 review |

---

*End of specification.*
