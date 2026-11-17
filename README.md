# Veyra · Bank Core

A backend-focused banking portfolio project built with FastAPI, PostgreSQL, SQLAlchemy asyncio and Redis. The web application is a client of the same authenticated API exposed in Swagger.

## Start locally

```sh
docker compose up --build -d --wait
```

Migrations run automatically. Existing database volumes are preserved.

- Application: [localhost:8000](http://localhost:8000/)
- API documentation: [localhost:8000/docs](http://localhost:8000/docs)
- Development email inbox: [localhost:8025](http://localhost:8025/)
- Dependency readiness: [localhost:8000/health/ready](http://localhost:8000/health/ready)

The phone interface adds a safe-area-aware dock, full-screen sign-in and Home Screen
manifest below the existing 600px phone breakpoint. See [mobile web and iPhone testing](docs/mobile-web.md)
for exact meta tags, manifest, opt-in Wi-Fi access and installation steps.

Choose **Get started**, select your currency, enter your email, and verify its code. Registration opens only the selected currency with a zero balance and uses it as your default workspace currency. **Dashboard → Add currency** opens additional EUR, USD, GBP, TRY, CHF, CAD or AUD accounts at zero; retries reuse the same currency account. Existing accounts are preserved. **Settings → Preferences** changes your default currency. Open **Payments hub → Add money** to fund a sandbox balance. These credits are recorded against sandbox clearing accounts, with equal debit and credit entries.

**Explore the demo** is a separate browser-local preview that now starts with zero balances, zero savings and no fabricated transaction history. Older demo caches are reset once while their savings goal names are preserved. Demo money never becomes an authenticated account balance. Funded demo data exists only in automated test fixtures. The Payments hub requires a backend account.

Compose enables `BANK_SANDBOX=true` for development. By default it captures emails in Mailpit. Configuring SMTP independently enables external email delivery while keeping financial operations in the sandbox. No real card is charged and no real bank account or payment card is issued.

## Gmail delivery

Copy `.env.gmail.example` to `.env` and replace `SMTP_USER` and the address inside `SMTP_FROM` with your Gmail address. Put a [Google app password](https://support.google.com/accounts/answer/185833) in `SMTP_PASSWORD`; do not use your normal Google password. App passwords require Google two-step verification and may be unavailable under some organization policies. Keep `.env` private; it is ignored by Git.

The template uses `smtp.gmail.com:587` with STARTTLS, as documented in [Google's SMTP settings](https://support.google.com/mail/answer/7104828). Port 465 is also supported with `SMTP_SSL=true` and `SMTP_TLS=false`. Gmail configuration is validated before sending, the sender must match the authenticated account, and credentials are never returned to the browser. Gmail app-password display spaces are removed automatically.

```sh
# Recreate only the API so Compose loads updated environment values.
docker compose up -d --no-deps --force-recreate api
# Validate the loaded configuration without sending mail or printing secrets.
docker compose exec -T api python -m app.email_delivery
# Verify TLS and Gmail login without sending a message.
docker compose exec -T api python -m app.email_delivery --check-connection
# Send one diagnostic email only to the configured sender's own inbox.
docker compose exec -T api python -m app.email_delivery --send-test
```

Request a registration code for your own email through **Get started** to verify delivery. Registration, two-step login, security changes and password resets all use this transport. Check Spam as well as Inbox. SMTP acceptance does not guarantee inbox placement. Without your sender credentials, the application continues to use the existing local Mailpit configuration; real Gmail delivery cannot be verified yet.

## What works

| Area | Behavior |
| --- | --- |
| Accounts | Seven settlement currencies, chosen-currency onboarding, idempotent additional currency accounts, ownership checks, savings spaces and transfers between owned accounts |
| Transfers | Atomic settlement, positive integer minor units, ordered row locks, durable per-user idempotency and request fingerprint checks |
| Currency exchange | Reviewed, expiring Frankfurter reference-rate quotes; four balanced journal legs; durable execution replay |
| Sandbox card | Online purchases, contactless and ATM simulations; freeze/channel controls, per-payment contactless limit, aggregate daily spending and ATM limits |
| Recipients | Database-backed saved recipients, lookup by internal IBAN/Veyra ID, removal and send shortcuts |
| Scheduled payments | Idempotent one-time scheduling, cancellation while pending, automatic server execution, persisted completion/failure reason |
| Audit | Immutable account event history, transaction references and balance-to-journal reconciliation |
| Authentication | Argon2id, signed and expiring JWTs, normalized emails, email OTP, optional two-step sign-in, password changes/reset and global session revocation |
| Workspace | Full monochrome light/dark themes including landing/auth, profile/avatar, persisted selection between multiple accounts in one currency, balance privacy, idle sign-out, budgets, cash flow, transaction filters and CSV export |
| Landing page | Continuous scroll-driven 3D scenes, input-driven metal card, interactive currency preview, larger fluid typography, FAQ and persisted reduced-motion preference |
| Account deletion | Password plus purpose-bound email code, zero-balance checks, closed accounts, anonymized profile, cancelled schedules and revoked sessions; immutable journals are retained |

Card limits are measured in each selected account's currency. Daily limits reset at 00:00 UTC. A scheduled payment does not reserve funds: the balance is checked when the worker executes it, and insufficient funds produce a persisted `FAILED` result. The independent `worker` service polls every ten seconds, continues across API reloads/restarts, and processes overdue payments after restarting. Multiple workers use `FOR UPDATE SKIP LOCKED`; cancelled and completed records cannot execute again. `/health/worker` reports its successful-poll heartbeat. API-embedded scheduling is disabled in Compose; standalone deployments can use `SCHEDULER_EMBEDDED=true`.

PostgreSQL uses a persistent Docker volume for users, accounts, preferences and journals. Redis uses its own persistent volume and append-only persistence for rate windows and expiring state. The connection pool checks stale database connections before reuse. Cache disconnections return a retryable `503` response without exposing connection details.

The authenticated `/workspace` endpoint loads profile, all owned accounts, transaction entries and saved recipients together. Shared account locks keep its balances and journal consistent during concurrent payments. The browser refreshes a visible workspace every 25 seconds and on reconnection/focus, and stores personal financial state on the server. Currency tiles show totals; an account selector exposes additional same-currency accounts and saves the selection to the database. Transfers, exchange and savings movements use that selected account.

## Backend design

```text
Authenticated request
    → Pydantic validation / ownership / Redis rate limits
    → PostgreSQL advisory lock for user + idempotency key
    → Verify request fingerprint and return an existing settlement if present
    → Lock participating accounts in ascending ID order
    → Validate balance and settlement currency
    → Update balances + append debit/credit journal + append audit event
    → COMMIT (deferred database trigger verifies balance per currency)
```

`app/ledger.py` owns the shared posting path for transfers, sandbox funding, card settlement and scheduled payments. PostgreSQL is the authority for idempotency; Redis is used for rate windows and expiring OTP/FX data. A lost HTTP response can be retried with the **same** key without posting a second debit. Reusing the key with a different amount, destination or reference returns `409`. Separate users can use the same client key.

Database constraints reject negative customer balances and nonpositive journal amounts. Deferred triggers reject empty/unbalanced new journals at commit, and mutation triggers reject updates/deletes to ledger and audit entries. Clearing accounts may carry negative balances to represent the sandbox counterparty. Existing historical balances are preserved; reconciliation reports any difference from legacy opening balances rather than inventing journal entries.

Public registration cannot assign the auditor role, and account creation cannot mint an initial balance. The direct `/auth/register` convenience endpoint is sandbox-only; verified OTP onboarding remains the normal UI flow. Auditor provisioning is a trusted administration task, with no public role-change endpoint.

Argon2 hashing runs in bounded background threads rather than blocking the event loop. Missing-user login also verifies a dummy hash. Password rotation/reset and **Sign out all devices** increment the user's token version. OTP codes are stored as HMAC digests, are limited to five verification attempts, expire after ten minutes and can be consumed once. Request IDs, timing headers and security headers support tracing without logging request bodies, tokens or passwords.

## Validation

```sh
# PostgreSQL/Redis integration, email onboarding and database invariants
docker compose exec -T api python -m pytest tests -q

# An independent 10-request overdraft/conservation demonstration
docker compose exec -T api python test_concurrency.py

# DOM interactions, cash flow, scrollytelling and animation lifecycle checks (Node.js 24)
npm ci
npm test
```

For an explicit operational persistence check, run `node tests/persistence-restart.cjs` on the host. When it prints `READY_RESTART_API`, run `docker compose restart api` from another terminal. The probe creates only a disposable sandbox identity and verifies that its balance, savings goal, preferences, selected account, journal and authenticated session survive the restart.

Trusted local sandbox maintenance can review selected balances with `docker compose exec -T api python -m app.admin reset-balances --user-id <id>`; append `--apply` to commit. Multiple explicit user IDs are supported. It records missing positive legacy opening balances as balanced opening journals, then posts balanced reset transfers to clearing accounts. Existing transactions are never rewritten. Negative unexplained opening differences are rejected for manual review. This command is unavailable in production and is not exposed over HTTP.

The tests cover concurrent debits, opposing transfers, duplicate retries, ownership, privilege escalation, currency mismatches, card controls/aggregate limits, recipient isolation, scheduled completion/cancellation/failure, immutable journals, FX replay, email registration/2FA/reset and session revocation. Frontend tests cover persisted preferences, savings, quote confirmation, payments, recipients, schedules, reconciliation and animation suspension. CI runs backend and frontend checks.

## Environment and boundaries

See `.env.example`. Compose binds application, database, Redis and the mail inbox to localhost. For an externally deployed environment, set `APP_ENV=production`, `BANK_SANDBOX=false`, a unique `JWT_SECRET_KEY` of at least 32 characters, and an authenticated SMTP sender with TLS. Startup rejects short/default production signing keys and production sandbox funding. TLS termination, managed secrets, backups, external monitoring and deployment-specific operations still need configuration.

External SEPA/SWIFT/FAST settlement, card-network authorization/issuance, real card funding, identity verification, regulatory reporting, loans and investment trading are not integrated. The transfer amount ceiling is a configurable project guard, not a complete AML/compliance system. Frankfurter supplies daily reference rates, not executable market liquidity. The project is a banking sandbox and an engineering portfolio, not a licensed production bank.

Local email testing uses [Mailpit's API](https://mailpit.axllent.org/docs/api-v1/). The landing scene uses CSS perspective without external textures, a canvas or an autonomous animation loop. Scroll updates are batched through animation frames and suspend while the dashboard is open. Settings tabs have a moving capsule and cancellable content transitions; reduced motion is respected. Typography and workspace dimensions scale with the viewport from 1280×720 through 3840×2160, with separate tablet and mobile layouts. Inter is requested from Google Fonts with a system-font fallback.

Account deletion is available under **Settings → Profile → Delete account**. The server verifies the current password and emails a separate one-time deletion code. Enter that code and choose **Delete Account**; no typed confirmation word is needed. All currency and savings balances must be zero. Deletion anonymizes the user row, removes profile preferences and saved recipients, closes their accounts, cancels their pending scheduled payments, and invalidates every session. Ledger entries and existing audit records remain immutable; this is not an erasure of transaction history. Incoming payments serialize against the same account locks and cannot fund a closed account. Demo deletion removes only the demo's browser-local profile and state.
