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
3. Set `DATABASE_DSN`, `REDIS_ADDR`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD`.
4. Configure SMTP before enabling registration in a shared environment. For local-only flow checks, set `DEV_EXPOSE_TOKENS=true` and keep the server private.
5. Run the server from `server/` with the Go toolchain.

The service does not store canvas projects, nodes, assets, or generated files. Those remain in the browser localforage/IndexedDB stores.
