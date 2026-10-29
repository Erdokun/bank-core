# Bank Core Ledger API

A high-concurrency, double-entry core banking transaction engine built with **FastAPI**, **PostgreSQL**, **SQLAlchemy 2.0 (Async)**, and **Redis**. Designed to guarantee strict ACID compliance, zero race conditions under parallel load, and sub-millisecond idempotency protection.

---

## Core Engineering Highlights

* **Double-Entry Bookkeeping (Audit Trail):** Every fund transfer generates immutable, balanced `DEBIT` and `CREDIT` ledger records within a single atomic transaction, ensuring complete financial auditability.
* **Race Condition Elimination (Pessimistic Locking):** Utilizes PostgreSQL row-level locks (`SELECT ... FOR UPDATE`) to serialize concurrent balance mutations and prevent overdrafts under high-concurrency stress.
* **Deterministic Deadlock Prevention:** Acquires database row locks in a strict ascending account ID order (`min(id)`, `max(id)`), mathematically eliminating circular wait conditions when two accounts transfer funds to each other simultaneously.
* **Two-Tier Idempotency (Redis + PostgreSQL):** Implements a Redis fast-path cache (`SET NX EX`) in front of PostgreSQL unique constraints to intercept duplicate network retries in ~3ms without saturating database connections.
* **Zero Floating-Point Drift:** All monetary values are stored and processed as `BIGINT` in minor currency units (cents) to prevent IEEE 754 floating-point rounding errors.
* **Request Tracing & Observability:** Custom HTTP middleware injects a unique `X-Request-ID` correlation header and logs execution latency (`X-Process-Time-Ms`) across every transaction.

---

## Tech Stack

* **Backend Framework:** Python 3.12+, FastAPI, Pydantic v2
* **Database & ORM:** PostgreSQL 16, SQLAlchemy 2.0 (Asyncio + `asyncpg`)
* **Caching & Locking:** Redis 7 (`redis-py` async)
* **Infrastructure & CI:** Docker, Docker Compose, GitHub Actions
* **Testing:** `pytest`, `pytest-asyncio`, `httpx`

---

## Quick Start (Docker Compose)

The entire stack (FastAPI, PostgreSQL 16, Redis 7) is fully containerized.

### 1. Build and start the services
```bash
docker compose up --build -d
```

### 2. Initialize the database schema
```bash
docker exec bank_api python init_db.py
```

### 3. Explore the interactive API documentation
Open your browser and navigate to:
* **Swagger UI:** `http://127.0.0.1:8000/docs`
* **Health Check:** `http://127.0.0.1:8000/health`

---

## Running Automated Tests

The Veyra interface is served at `http://127.0.0.1:8000/`. Its public landing page
always uses dark mode. The personal workspace supports pure black/white light
and dark themes, saved profile/preferences, monthly cash flow and budgets,
transaction search/filters, CSV exports, balance privacy and an inactivity lock.
The explicit demo uses browser-local sample data; live accounts never use demo
balances. Card issuance and external card funding are not connected.

Configure the SMTP values in `.env.example` to enable signup, two-step sign-in
and password-reset emails. Password changes and resets revoke prior tokens.
Preferences and profile changes use the existing user settings storage; no new
database migration is needed.

The dark home page has a separate native WebGL Earth scene with rotation,
clouds, atmospheric lighting and pointer depth. It pauses outside the viewport,
in the dashboard and in background tabs; reduced-motion preferences are
respected. The original Earth video/poster provides a fallback. All scene assets
are served locally. Veyra wordmarks return to the home page while keeping the
session open, including on mobile.

Optional GPU-only visual QA: install `moderngl` and `Pillow` in the development
environment and run `python tests/render_hero.py`. This compiles the scene shader
and saves desktop, rotated and mobile renders to the system temporary directory.
These packages are not application/runtime dependencies.

For frontend interaction regressions, run `npm ci` followed by `npm test`.
For all API and workspace checks against the running local services, run
`python -m pytest tests -q` in the Python environment.

### 1. Integration & Idempotency Test Suite (`pytest`)
Run the automated test suite directly inside the isolated container environment:
```bash
docker exec bank_api pytest -v
```

### 2. High-Concurrency Race Condition Stress Test
Simulates 10 simultaneous transfer requests fired at the exact same millisecond against a limited account balance to verify `SELECT ... FOR UPDATE` row locking:
```bash
python test_concurrency.py
```

---

## API Endpoints Overview

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/health` | Service health check and latency tracing headers |
| `POST` | `/accounts` | Provision a new bank account with an initial balance (in cents) |
| `GET` | `/accounts/{id}` | Retrieve current account details and real-time balance |
| `GET` | `/accounts/{id}/statement` | Fetch full double-entry (`DEBIT`/`CREDIT`) audit trail |
| `POST` | `/transfers` | Execute an atomic, idempotent funds transfer between accounts |
