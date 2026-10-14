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