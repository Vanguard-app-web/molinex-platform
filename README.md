# Molinex Platform

Molinex Platform is the deployable mock REST API used by the Molinex web application while the definitive backend is under development. It exposes the same `/api/v1` resource paths consumed by the Vue SPA and is designed to run locally or in Azure App Service.

Besides the seven operational resources, it simulates two more bounded contexts of the web application: **Identity and Access Management** (sign-in, users, roles and permissions) and **Commercial Engagement** (plans, value proposition and commercial inquiries).

## Technology

- Node.js 24.20 LTS or newer.
- JSON Server 0.17.4.
- ES modules. Hashing and token generation use only the built-in `node:crypto` module.

## Local setup

```powershell
git clone https://github.com/Vanguard-app-web/molinex-platform.git
Set-Location molinex-platform
npm ci
npm start
```

The API starts at `http://localhost:3000` by default. `npm install` works as well; `npm ci` restores exactly what `package-lock.json` records.

To run it together with the web application, start this API first and then follow the instructions of the `molinex-webapp` README. The web application must point to this API through `VITE_API_BASE_URL` (default `http://localhost:3000/api/v1`) and must **not** be used with its own `npm run api` mock, which does not implement Identity and Access Management or Commercial Engagement.

## Runtime configuration

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port. Azure App Service supplies this value at runtime. |
| `JSON_SERVER_DB_PATH` | `./db.json` | Path to the JSON database file with the operational resources. |
| `COMMERCIAL_CONTENT_PATH` | `./commercial-engagement/commercial-content.json` | Read-only JSON file with the published plans and value proposition. |

The private data file (credential hashes, sessions and commercial inquiries) is derived from the database path: `db.json` becomes `db.private.json` in the same directory. It is created on the first start with the demonstration accounts, is never served by the API and is ignored by Git (`*.private.json`). Delete it to restore the demonstration accounts and discard sessions and inquiries.

## Endpoints

All paths are relative to `/api/v1`. Bodies and responses are JSON. Every protected endpoint expects `Authorization: Bearer <token>`.

### Service

| Method | Path | Access | Result |
| --- | --- | --- | --- |
| `GET` | `/` (outside `/api/v1`) | public | Name, version and operational resources. |
| `GET` | `/health` | public | `200` `{status, time}`. |

### Identity and Access Management (`/iam`)

| Method | Path | Permission | Request | Success response |
| --- | --- | --- | --- | --- |
| `POST` | `/iam/sign-in` | public | `{email, password}` | `200` `{userId, token, role, permissions}` |
| `POST` | `/iam/sign-up` | public | `{email, password, fullName}` (optional `jobTitle`, `phoneNumber`) | `201` `UserResource`, `Location: /api/v1/iam/users/{id}` |
| `POST` | `/iam/sign-out` | any signed-in user | empty | `204`; the token stops working |
| `GET` | `/iam/profile` | any signed-in user | | `200` `UserResource` of the token owner |
| `PUT` | `/iam/profile` | any signed-in user | `UserResource` (only `fullName`, `jobTitle`, `phoneNumber` change) | `200` `UserResource` |
| `GET` | `/iam/users` | `MANAGE_USERS` | | `200` `UserResource[]` |
| `POST` | `/iam/users` | `MANAGE_USERS` | `{email, password, fullName, role}` (optional `jobTitle`, `phoneNumber`) | `201` `UserResource` with `Location` |
| `GET` | `/iam/users/{id}` | `MANAGE_USERS` | | `200` `UserResource` |
| `PUT` | `/iam/users/{id}` | `MANAGE_USERS` | `UserResource` (only `fullName`, `jobTitle`, `phoneNumber` change) | `200` `UserResource` |
| `PUT` | `/iam/users/{id}/role` | `MANAGE_USERS` | `{role}` | `200` `UserResource` |

`UserResource`: `{id, email, fullName, jobTitle, phoneNumber, role, permissions, status}`. Passwords, hashes and tokens are never part of any response.

Rules enforced by the API:

- `role` is a `RoleType`; `status` is an `AccountStatus`; `permissions` is derived from the role.
- Sign-up never accepts a privileged role: it always creates an `ACTIVE` account with the `PRODUCTION_OPERATOR` role. A body that asks for another `role`, `status` or `permissions` is rejected with `403 PRIVILEGE_CHANGE_FORBIDDEN`.
- The profile endpoint cannot change `role`, `permissions` or `status` (`403 PRIVILEGE_CHANGE_FORBIDDEN`) nor `email` or `id` (`400 IMMUTABLE_FIELD`). Sending the unchanged values is accepted, so a client can send back the whole resource.
- `INACTIVE` and `LOCKED` accounts cannot sign in (`403 ACCOUNT_INACTIVE` / `403 ACCOUNT_LOCKED`, only after the password was verified) and their existing tokens stop working.
- Emails are unique, compared without case (`409 EMAIL_ALREADY_REGISTERED`).
- The last active administrator cannot lose the role (`409 LAST_ADMINISTRATOR`).
- Passwords need 8 to 128 characters (a convention of this simulation). Names and job titles allow up to 100 characters. A phone number, when given, needs 7 to 15 digits.
- Role changes apply immediately: permissions are read from the user on every request.

### Commercial Engagement (`/commercial`, public)

| Method | Path | Request | Success response |
| --- | --- | --- | --- |
| `GET` | `/commercial/plans` | | `200` `PlanResource[]`: `{id, name, priceLabel, features}` (possibly empty) |
| `GET` | `/commercial/value-proposition` | | `200` `{headline, benefits}` |
| `POST` | `/commercial/inquiries` | `{fullName, email, companyName, message}` and optional `phone` | `201` `{id, fullName, email, phone?, companyName, message, submittedAt}`, `Location: /api/v1/commercial/inquiries/{id}` |

The API assigns the inquiry `id` and `submittedAt`; values sent by the client are ignored. Inquiries are write-only: no endpoint lists or reads them (the `Location` URL answers `404`) and they are stored in the private data file, never in a public collection. There is no length limit on the text fields besides the request size. A blank phone is treated as not provided. The plans and the value proposition come from `commercial-engagement/commercial-content.json` and cannot be changed through the API.

### Operational resources

`/raw-material-receptions`, `/production-batches`, `/production-records`, `/quality-assessments`, `/waste-records`, `/machines` and `/maintenance-records` keep the standard JSON Server `GET`, `POST`, `PUT`, `PATCH` and `DELETE` operations, now behind a bearer token:

| Operation | Required permission |
| --- | --- |
| `GET` on any of them | `VIEW_OPERATIONAL_INFORMATION` |
| Changes to `raw-material-receptions`, `production-batches`, `production-records`, `quality-assessments`, `waste-records` | `MANAGE_PRODUCTION` |
| Changes to `machines`, `maintenance-records` | `MANAGE_MAINTENANCE` |

Any other path answers `404`, including `/db`, `/users`, `/tokens`, `/sessions` and `/commercial-inquiries`, so the generic CRUD can never reach private data. The guard also covers the unprefixed form of each path (`/machines`).

**Breaking change:** a client without a token can no longer read or change the operational resources. Deploy this API together with the matching `molinex-webapp`.

## Roles and permissions

| Permission | `ADMINISTRATOR` | `MAINTENANCE_TECHNICIAN` | `PRODUCTION_OPERATOR` |
| --- | :---: | :---: | :---: |
| `MANAGE_USERS` | yes | | |
| `MANAGE_PRODUCTION` | | | yes |
| `MANAGE_MAINTENANCE` | | yes | |
| `VIEW_OPERATIONAL_INFORMATION` | yes | yes | yes |
| `VIEW_REPORTS` | yes | | |

The matrix is derived from the C4 actors: the administrator administers users and supervises operations and reports; the maintenance technician manages machines and maintenance; the production operator records production, quality and waste. `VIEW_REPORTS` only travels with the role: the reporting and analytics context is not implemented. The matrix lives in `shared/authorization.js` and must stay equal to `rolePermissions` in the web application.

## Errors

Every failure uses one format, including malformed JSON and unknown paths:

```json
{"status": 409, "code": "EMAIL_ALREADY_REGISTERED", "message": "An account with this email address already exists.", "details": []}
```

`details` lists the invalid fields of a `400`: `[{"field": "email", "code": "INVALID_FORMAT"}]`.

| Status | Meaning | Codes |
| --- | --- | --- |
| `400` | Invalid input | `VALIDATION_ERROR`, `IMMUTABLE_FIELD`, `MALFORMED_JSON` |
| `401` | Missing or invalid credentials or token | `INVALID_CREDENTIALS`, `AUTHENTICATION_REQUIRED`, `INVALID_TOKEN` |
| `403` | Not allowed | `FORBIDDEN`, `PRIVILEGE_CHANGE_FORBIDDEN`, `ACCOUNT_INACTIVE`, `ACCOUNT_LOCKED` |
| `404` | Resource does not exist | `NOT_FOUND`, `USER_NOT_FOUND` |
| `405` | Method not supported (with `Allow`) | `METHOD_NOT_ALLOWED` |
| `409` | Conflict | `EMAIL_ALREADY_REGISTERED`, `LAST_ADMINISTRATOR` |
| `413` / `500` | Oversized body / internal error | `PAYLOAD_TOO_LARGE`, `INTERNAL_ERROR` |

## Demonstration accounts

Fictitious accounts created the first time the API starts. The passwords are public demonstration values, never real secrets.

| Email | Password | Role | Status |
| --- | --- | --- | --- |
| `admin@molinex.test` | `Demo-Admin-2026` | `ADMINISTRATOR` | `ACTIVE` |
| `technician@molinex.test` | `Demo-Technician-2026` | `MAINTENANCE_TECHNICIAN` | `ACTIVE` |
| `operator@molinex.test` | `Demo-Operator-2026` | `PRODUCTION_OPERATOR` | `ACTIVE` |
| `inactive@molinex.test` | `Demo-Inactive-2026` | `PRODUCTION_OPERATOR` | `INACTIVE` |
| `locked@molinex.test` | `Demo-Locked-2026` | `MAINTENANCE_TECHNICIAN` | `LOCKED` |

## Commercial content

The repository does not contain confirmed plans, prices or benefits, so `commercial-engagement/commercial-content.json` ships with an empty plan list and no benefits. Its headline reuses the product description of the web application (`index.html`). Nothing was invented. To publish content, edit that file (or point `COMMERCIAL_CONTENT_PATH` to another one) and restart the API:

```json
{
  "plans": [{"id": "...", "name": "...", "priceLabel": "...", "features": ["..."]}],
  "valueProposition": {"headline": "...", "benefits": ["..."]}
}
```

The headline is required; plans may be empty. The API refuses to start when the file does not follow this format.

## Tests

```powershell
node --test "tests/**/*.test.js"
```

The tests start the API as a child process on a free port with a temporary copy of the database, so `db.json` and the private data file of the project are never touched. They create `molinex-mock-test-*` directories under the operating system temporary directory and do not remove them. No test dependency is needed.

## Decisions and gaps

- **Default role of public sign-up.** The design does not say which role a self-registered account receives; `PRODUCTION_OPERATOR` was chosen. Change `DEFAULT_SIGN_UP_ROLE` in `shared/authorization.js` (and the web application constant) if the team decides otherwise.
- **Account status.** The design lists `AccountStatus` but no operation to change it, so accounts can only be `INACTIVE` or `LOCKED` by editing the private data file. The demonstration accounts cover both states.
- **Last administrator.** Not specified by the design; the API refuses to demote the last active administrator to avoid locking everyone out.
- **Commercial content.** Plans and benefits are empty on purpose (see above).
- **Location of inquiries.** `201` returns a `Location` that identifies the inquiry, but inquiries are not readable.

## Limitations

This repository is a course mock and not the definitive Molinex backend. Authentication is a local simulation:

- Tokens are opaque demonstration values (`mlx-demo.…`) valid for 8 hours and verified against hashes stored in the private data file. They are **not JWTs** and are not compatible with the definitive backend.
- Passwords are hashed with scrypt, but nothing here is production-grade security: no HTTPS, no rate limiting or lockout after failed attempts, no password recovery, no email verification, no multi-factor authentication and no external integration.
- Concurrency control, transactions and durable database persistence are not provided. Data lives in two JSON files.
- All committed records and accounts are fictitious demonstration data.

## License

This project is licensed under the MIT License. See [LICENSE.md](LICENSE.md).
