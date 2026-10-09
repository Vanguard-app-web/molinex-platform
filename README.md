# Molinex Platform

Molinex Platform is the deployable mock REST API used by the Molinex web application while the definitive backend is under development. It exposes the same `/api/v1` resource paths consumed by the Vue SPA and is designed to run locally or in Azure App Service.

## Technology

- Node.js 24.20 LTS or newer.
- JSON Server 0.17.4.
- ES modules.

## Local setup

```powershell
git clone https://github.com/Vanguard-app-web/molinex-platform.git
Set-Location molinex-platform
npm install
npm start
```

The API starts at `http://localhost:3000` by default.

## Endpoints

- `GET /`
- `GET /api/v1/health`
- `/api/v1/raw-material-receptions`
- `/api/v1/production-batches`
- `/api/v1/production-records`
- `/api/v1/quality-assessments`
- `/api/v1/waste-records`
- `/api/v1/machines`
- `/api/v1/maintenance-records`

JSON Server provides the standard `GET`, `POST`, `PUT`, `PATCH`, and `DELETE` operations for each resource.

## Runtime configuration

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port. Azure App Service supplies this value at runtime. |
| `JSON_SERVER_DB_PATH` | `./db.json` | Path to the JSON database file. |

## Limitations

This repository is a course mock and not the definitive Molinex backend. It does not provide production authentication, authorization, transactional guarantees, or durable database persistence. All committed records are fictitious demonstration data.

## License

This project is licensed under the MIT License. See [LICENSE.md](LICENSE.md).
