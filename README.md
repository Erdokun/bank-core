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

Choose **Get started**, enter a test email, and read its verification code in the local inbox. Verified registration provisions EUR, USD, GBP and TRY accounts with zero balances. Open **Payments hub → Add money** to fund a test balance. These credits are recorded against sandbox clearing accounts, with equal debit and credit entries.

**Explore the demo** is a separate browser-local preview. Its sample money never becomes an authenticated account balance. The Payments hub requires a backend account.

Compose enables `BANK_SANDBOX=true` for development. It captures emails in Mailpit rather than forwarding them to external recipients. No real card is charged and no real bank account or payment card is issued.

## What works

| Area | Behavior |
| --- | --- |
| Accounts | Four settlement currencies, ownership checks, savings spaces, deposits and withdrawals between owned accounts |
| Transfers | Atomic settlement, positive integer minor units, ordered row locks, durable per-user idempotency and request fingerprint checks |
| Currency exchange | Reviewed, expiring Frankfurter reference-rate quotes; four balanced journal legs; durable execution replay |
| Sandbox card | Online purchases, contactless and ATM simulations; freeze/channel controls, per-payment contactless limit, aggregate daily spending and ATM limits |
| Recipients | Database-backed saved recipients, lookup by internal IBAN/Veyra ID, removal and send shortcuts |
| Scheduled payments | Idempotent one-time scheduling, cancellation while pending, automatic server execution, persisted completion/failure reason |
| Audit | Immutable account event history, transaction references and balance-to-journal reconciliation |
| Authentication | Argon2id, signed and expiring JWTs, normalized emails, email OTP, optional two-step sign-in, password changes/reset and global session revocation |
| Workspace | Light/dark appearance, profile/avatar, balance privacy, idle sign-out, currency preference, budgets, transaction filters and CSV export |
| Landing page | Procedural galaxy, stars with perspective and parallax, shooting stars, pause control and reduced-motion fallback |

Card limits are measured in each selected account's currency. Daily limits reset at 00:00 UTC. A scheduled payment does not reserve funds: the balance is checked when the worker executes it, and insufficient funds produce a persisted `FAILED` result. The worker polls every ten seconds while the API is running and processes overdue payments after a restart. Multiple workers use `FOR UPDATE SKIP LOCKED`; cancelled and completed records cannot execute again.

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

# DOM interaction and galaxy lifecycle checks (Node.js 24)
npm ci
npm test
```

The tests cover concurrent debits, opposing transfers, duplicate retries, ownership, privilege escalation, currency mismatches, card controls/aggregate limits, recipient isolation, scheduled completion/cancellation/failure, immutable journals, FX replay, email registration/2FA/reset and session revocation. Frontend tests cover persisted preferences, savings, quote confirmation, payments, recipients, schedules, reconciliation and animation suspension. CI runs backend and frontend checks.

## Environment and boundaries

See `.env.example`. Compose binds application, database, Redis and the mail inbox to localhost. For an externally deployed environment, set `APP_ENV=production`, `BANK_SANDBOX=false`, a unique `JWT_SECRET_KEY` of at least 32 characters, and an authenticated SMTP sender with TLS. Startup rejects short/default production signing keys and production sandbox funding. TLS termination, managed secrets, backups, external monitoring and deployment-specific operations still need configuration.

External SEPA/SWIFT/FAST settlement, card-network authorization/issuance, real card funding, identity verification, regulatory reporting, loans and investment trading are not integrated. The transfer amount ceiling is a configurable project guard, not a complete AML/compliance system. Frankfurter supplies daily reference rates, not executable market liquidity. The project is a banking sandbox and an engineering portfolio, not a licensed production bank.

Local email testing uses [Mailpit's API](https://mailpit.axllent.org/docs/api-v1/). The galaxy is generated in the browser without Earth textures or a 3D library. Inter is requested from Google Fonts with a system-font fallback.
