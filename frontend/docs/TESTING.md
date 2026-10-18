# Frontend and cross-repository tests

Run `npm ci` and `npm test` inside the frontend checkout. The default suite exercises only frontend source, components and synthetic fixtures; it does not opportunistically load an adjacent backend.

Release validation also requires `npm run test:backend-integration`. It explicitly runs XHS request/session isolation, actual art dispatcher → frontend studio cards, and million-character personalization payload → backend settings persistence. Install dependencies in both repositories first. Missing backend source or feature fixtures fail clearly; no integration is silently skipped.

Supported layouts: `frontend/` beside `backend/`, or `dengta-home-frontend/` beside `dengta-home-backend/`. For another layout, set `DENGTA_BACKEND_TEST_ROOT` to the backend directory. Relative paths are resolved from the command working directory; this is a local test path, not a production credential or URL.

The extra capacity integration is intentionally separate: `npm run test:import-capacity-integration` writes and verifies a synthetic 24 MiB file by default. `DENGTA_CAPACITY_BYTES` can select a multiple of 64 up to 1 GiB; `DENGTA_TEST_ARTIFACT_DIR` selects its evidence directory. It uses the same explicit backend resolver and never calls a production service.
