# Self-hosting DengTa Home

## Components

1. Supabase Auth, Postgres and Storage
2. DengTa Express backend
3. DengTa React frontend
4. Optional voice, notification and MCP services

## Supabase

Create an independent development project and review the SQL files in `backend/supabase/`, their dependencies, and the target database's migration history before applying the required files. Some files share numeric prefixes; a numeric sort alone does not establish a complete dependency order. Verify Auth, table permissions, Row Level Security, Storage and account initialization after setup. Do not blindly reapply every file to an existing database; production upgrades require a backup and a verified rollback plan. Use the project URL and public publishable/legacy anon key in the frontend. Keep the secret/service-role key on the backend only.

## Backend

Deploy `backend/` to a Node.js 24 runtime. Copy the variable names from `backend/.env.example` into the platform's secret manager. Set `AUTH_REQUIRED=true` for internet-facing deployments and restrict `FRONTEND_URL` to the deployed frontend origin.

Do not place secrets in build arguments, repository variables visible to pull requests, client-side `VITE_*` values or Docker image layers.

## Frontend

Deploy `frontend/` as a Vite static app. Configure `VITE_API_URL`, `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` during the build. The anon key is designed for browser use, but database Row Level Security must still be enabled and tested.

## Android

Build the web bundle, run Capacitor sync, then build from `frontend/android`. Set `DENGTA_BACKEND_API_URL` when invoking Gradle so background notifications and screen sharing use your own backend. Release signing material is intentionally not included in this repository.

The manual GitHub Actions APK workflow requires three Repository Secrets: `VITE_API_URL`, `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. The anon key is intended for client use, but it must still be paired with tested Row Level Security. The workflow reuses `VITE_API_URL` as `DENGTA_BACKEND_API_URL` for native background services.

## Background jobs

Leave background jobs disabled until all required migrations are applied. Configure trigger secrets and worker identity only in the deployment platform. Start with one worker, then raise concurrency after observing database load and provider rate limits.

`backend/.github/workflows/shadow-push.yml` is an optional workflow template. It does not run from this monorepo's nested directory. If you install it into a deployment repository, set `DENGTA_BACKGROUND_JOB_API_URL` as a repository variable and `DENGTA_BACKGROUND_JOB_TRIGGER_SECRET_V3` as a repository secret for your own backend. Never reuse another deployment's secret.

## Before going live

- run frontend and backend tests;
- verify Row Level Security with two separate accounts;
- verify CORS and authentication failures;
- rotate any key that has ever appeared in a log or local export;
- test database restore, not only backup creation;
- run `scripts/public-release-audit.ps1`.
