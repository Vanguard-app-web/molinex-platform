# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Identity and Access Management endpoints under `/api/v1/iam`: sign-in, sign-up, sign-out, own profile, user administration and role assignment.
- Commercial Engagement endpoints under `/api/v1/commercial`: plan catalog, value proposition and commercial inquiries.
- Roles, permissions and account states (`ADMINISTRATOR`, `MAINTENANCE_TECHNICIAN`, `PRODUCTION_OPERATOR`; `MANAGE_USERS`, `MANAGE_PRODUCTION`, `MANAGE_MAINTENANCE`, `VIEW_OPERATIONAL_INFORMATION`, `VIEW_REPORTS`; `ACTIVE`, `INACTIVE`, `LOCKED`).
- Fictitious demonstration accounts for the three roles and the inactive and locked states.
- Private data file (`<database>.private.json`) for credential hashes, session hashes and commercial inquiries, kept outside the JSON Server collections.
- Optional `COMMERCIAL_CONTENT_PATH` setting and `commercial-engagement/commercial-content.json` with the published plans and value proposition (no plans or benefits are confirmed yet).
- Common JSON error format for every failure, including malformed JSON and unknown paths.
- Automated tests of the API with the Node.js test runner.
- README sections for endpoints, permissions, errors, demonstration accounts, decisions and limitations.

### Changed

- The operational resources now require a bearer token: `VIEW_OPERATIONAL_INFORMATION` to read, and `MANAGE_PRODUCTION` or `MANAGE_MAINTENANCE` to change them. Clients without a token receive `401`.
- Any path that is not an operational resource, including `/db`, answers `404` instead of reaching the generic CRUD.
- `MockApiServer.start()` returns the HTTP server.

### Security

- Passwords are stored only as scrypt hashes and access tokens only as SHA-256 hashes; neither appears in any response.
- Sign-up and profile updates cannot raise privileges.
- Private data is ignored by Git (`*.private.json`).
