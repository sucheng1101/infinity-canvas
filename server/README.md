# Infinite Canvas Hosted Server

M1 provides the account boundary for hosted operation:

- MySQL connection and versioned migrations;
- Redis connectivity, request IDs, and authentication rate limits;
- email/password registration with one-time email verification;
- HttpOnly session cookies with seven-day idle TTL and thirty-day absolute TTL;
- logout, current-user lookup, password reset, and admin bootstrap;
- `/healthz` and `/api/v1/admin/health` checks.

## Local startup

1. Create a MySQL database named `infinite_canvas` and a Redis instance.
2. Copy `.env.example` to a local environment file outside version control.
3. Set `DATABASE_DSN`, `REDIS_ADDR`, `ADMIN_USERNAME`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD`.
4. Configure SMTP before enabling registration in a shared environment. For local-only flow checks, set `DEV_EXPOSE_TOKENS=true` and keep the server private.
5. Run the server from `server/` with the Go toolchain. On Windows, `./start-local.ps1` loads the ignored `server/.env.local` file before starting the service.

The local bootstrap file created for this workspace uses:

- administrator username: `sucheng`
- administrator email: `sucheng@example.com`
- administrator password: `sucheng123..`

`auth.EnsureAdmin` creates this administrator on the first successful server startup and synchronizes the configured username, email, password, active status, and admin role on later local restarts.

M2 recharge endpoints are available under `/api/v1/recharge/*` and `/api/v1/payments/epay/webhook`.
The administrator can maintain products at `/api/v1/admin/recharge-products` and EPay settings at
`/api/v1/admin/payment-settings`. Configure EPay either through the administrator API or the
`EPAY_*` environment variables before creating a payment order. `EPAY_CALLBACK_URL` must point to the externally reachable account-service base URL; the gateway will call `/api/v1/payments/epay/webhook` there. The admin payment form exposes the same callback setting for database-backed configuration.

M3 published model catalog endpoints are available at `/api/v1/models` for users and
`/api/v1/admin/models` for administrators. User responses only contain the published model
name, capability, and public configuration; upstream channels and credentials stay server-side.

Administrator channel and route endpoints are available at `/api/v1/admin/channels` and
`/api/v1/admin/model-routes`. A route maps one published model to an upstream model on a
managed channel. Channel API keys are accepted only on administrator writes and are returned
as a masked value; ordinary users never receive channel or route data.

M3 pricing and task endpoints are available at `/api/v1/admin/pricing`, `/api/v1/quotes`, and
`/api/v1/generation-tasks`. Administrators publish a formula-based price version for each
model. Users receive a five-minute quote snapshot by default (`QUOTE_TTL`), then create a
task with the same parameters. Task creation atomically consumes the quote and reserves the
user quota; cancellation or relay failure releases the reservation, while successful relay
settlement deducts the actual amount.

Queued tasks can be sent through the administrator-managed channel with
`POST /api/v1/generation-tasks/:id/execute`. The relay selects the active route by priority,
injects the upstream model and API key server-side, and persists the upstream JSON response
on the task. The user-facing API never returns channel credentials. Custom route or channel
settings may provide a `path` and additional non-authentication `headers`; otherwise the
default paths are `/v1/chat/completions`, `/v1/images/generations`, `/v1/videos`, and
`/v1/audio/speech` for text, image, video, and audio respectively.

The service does not store canvas projects, nodes, assets, or generated files. Those remain in the browser localforage/IndexedDB stores.
