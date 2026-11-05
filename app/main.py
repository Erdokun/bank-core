import time
import uuid
import logging
from typing import List
import jwt
from fastapi import FastAPI, Depends, HTTPException, Request, status
from fastapi.responses import HTMLResponse
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
import os
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
import redis.asyncio as aioredis
from app.database import get_db, engine
from app.redis_client import get_redis, redis_client
from app import models, schemas, security, guards, ledger
from app.operations import register_operations, scheduler_loop, sandbox_enabled
from contextlib import asynccontextmanager
import asyncio
from app.veyra import register_veyra_routes, generate_iban, issue_otp, consume_otp

# Configure structured-style application logger
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s"
)
logger = logging.getLogger("bank-core")

@asynccontextmanager
async def lifespan(app):
    worker = asyncio.create_task(scheduler_loop()) if os.getenv("SCHEDULER_EMBEDDED", "true").lower() == "true" else None
    try:
        yield
    finally:
        if worker:
            worker.cancel()
            try:
                await worker
            except asyncio.CancelledError:
                pass
        await engine.dispose()
        await redis_client.aclose()


app = FastAPI(
    lifespan=lifespan,
    title="Bank Core Ledger API",
    description="High-concurrency banking engine with double-entry ledger bookkeeping, JWT auth, RBAC, and Anti-Fraud guards.",
    version="2.0.0"
)

# Bearer token security scheme for Swagger UI Authorize button
security_scheme = HTTPBearer()


@app.exception_handler(aioredis.RedisError)
async def cache_unavailable(request, exc):
    return JSONResponse(status_code=503, content={"detail": "The service is reconnecting. Please try again shortly."}, headers={"Retry-After": "5"})


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security_scheme),
    db: AsyncSession = Depends(get_db)
) -> models.User:
    """
    Validates the Bearer JWT token from the Authorization header
    and fetches the authenticated user from PostgreSQL.
    """
    token = credentials.credentials
    try:
        payload = security.decode_access_token(token)
        user_id = int(payload.get("sub"))
    except (jwt.PyJWTError, ValueError, TypeError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired authentication token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    query = select(models.User).where(models.User.id == user_id)
    result = await db.execute(query)
    user = result.scalar_one_or_none()

    if not user or user.deleted_at is not None or payload.get("ver", 0) != user.token_version:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User no longer exists."
        )

    return user


@app.middleware("http")
async def request_tracing_middleware(request: Request, call_next):
    """
    Intercepts every incoming HTTP request to assign a unique correlation ID (X-Request-ID)
    and measure execution latency in milliseconds for audit logging.
    """
    request_id = str(uuid.uuid4())
    start_time = time.perf_counter()

    logger.info(f"request_started | request_id={request_id} method={request.method} path={request.url.path}")

    response = await call_next(request)

    process_time_ms = round((time.perf_counter() - start_time) * 1000, 2)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "same-origin"
    if not request.url.path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-store"
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Process-Time-Ms"] = str(process_time_ms)

    logger.info(
        f"request_completed | request_id={request_id} status={response.status_code} duration_ms={process_time_ms}"
    )
    return response


@app.get("/health", tags=["System"])
async def health_check():
    """Endpoint to verify API service uptime."""
    return {"status": "healthy", "service": "bank-core"}


@app.post("/auth/register", response_model=schemas.UserResponse, status_code=status.HTTP_201_CREATED, tags=["Auth"])
async def register_user(
    payload: schemas.UserCreate,
    db: AsyncSession = Depends(get_db)
):
    """
    Registers a new user with an Argon2id hashed password and assigned RBAC role.
    """
    if not sandbox_enabled():
        raise HTTPException(403, "Use verified email registration in this environment.")
    existing_query = select(models.User).where(models.User.email == payload.email)
    existing_result = await db.execute(existing_query)
    if existing_result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with this email address is already registered."
        )

    new_user = models.User(
        email=payload.email,
        full_name=payload.full_name,
        hashed_password=await security.hash_password_async(payload.password),
        role=models.UserRole.CUSTOMER
    )

    db.add(new_user)
    try:
        await db.flush()
        ledger.audit(db, new_user.id, "auth.registered")
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "A user with this email address is already registered.")
    await db.refresh(new_user)

    return new_user


@app.post("/auth/login", response_model=schemas.TokenResponse, tags=["Auth"])
async def login_user(
    payload: schemas.LoginRequest,
    db: AsyncSession = Depends(get_db),
    redis = Depends(get_redis)
):
    """
    Authenticates user credentials and returns a signed JWT access token.
    """
    email = payload.email.strip().lower()
    if len(email) > 255 or len(payload.password) > 128:
        raise HTTPException(422, "Email or password exceeds the allowed length.")
    import hashlib
    key = "veyra:login-attempts:" + hashlib.sha256(email.encode()).hexdigest()
    # Keep a short, shared attempt window across API workers, including OTP attempts.
    attempts = await redis.eval("""
        local n = redis.call('INCR', KEYS[1])
        if n == 1 then redis.call('EXPIRE', KEYS[1], 300) end
        return n
    """, 1, key)
    if attempts > 10:
        raise HTTPException(429, "Too many sign-in attempts. Please try again in 5 minutes.")
    query = select(models.User).where(models.User.email == email)
    result = await db.execute(query)
    user = result.scalar_one_or_none()

    valid_password = await security.verify_password_async(payload.password, user.hashed_password if user else security.DUMMY_PASSWORD_HASH)
    if not user or user.deleted_at is not None or not valid_password:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password."
        )

    if user.settings.get("two_factor"):
        if not payload.code:
            await issue_otp(user.email, redis, "login")
            raise HTTPException(status_code=428, detail="Email verification required. A code has been sent.")
        await consume_otp(user.email, payload.code, redis, "login")

    await redis.delete(key)
    ledger.audit(db, user.id, "auth.login")
    await db.commit()
    access_token = security.create_access_token(
        version=user.token_version,
        user_id=user.id,
        email=user.email,
        role=user.role.value
    )

    return schemas.TokenResponse(access_token=access_token)


@app.get("/auth/me", response_model=schemas.UserResponse, tags=["Auth"])
async def get_my_profile(
    current_user: models.User = Depends(get_current_user)
):
    """
    Returns the profile of the currently authenticated user based on their JWT token.
    """
    return current_user


@app.post("/accounts", response_model=schemas.AccountResponse, status_code=status.HTTP_201_CREATED, tags=["Accounts"])
async def create_account(
    payload: schemas.AccountCreate,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Creates a new bank account bound to the currently authenticated user.
    """
    guards.require_customer(current_user)
    current_user = (await db.execute(select(models.User).where(models.User.id == current_user.id).with_for_update().execution_options(populate_existing=True))).scalar_one()
    guards.require_active(current_user)
    generated_iban = generate_iban(payload.currency)
    owner_name = payload.owner_name if payload.owner_name else current_user.full_name

    new_account = models.Account(
        user_id=current_user.id,
        account_number=generated_iban,
        owner_name=owner_name,
        balance=0,
        currency=payload.currency, kind=payload.kind, goal=payload.goal
    )

    db.add(new_account)
    ledger.audit(db, current_user.id, "account.created", currency=payload.currency, kind=payload.kind)
    await db.commit()
    await db.refresh(new_account)

    return new_account


@app.post("/accounts/currencies", response_model=schemas.AccountResponse, tags=["Accounts"])
async def open_currency_account(
    payload: schemas.CurrencyAccountCreate,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Open a zero-balance currency once, including concurrent requests and retries."""
    guards.require_customer(current_user)
    locked = (await db.execute(select(models.User).where(models.User.id == current_user.id).with_for_update().execution_options(populate_existing=True))).scalar_one()
    guards.require_active(locked)
    existing = (await db.execute(select(models.Account).where(models.Account.user_id == locked.id, models.Account.kind == "current", models.Account.currency == payload.currency).order_by(models.Account.id))).scalars().first()
    if existing:
        return existing
    account = models.Account(user_id=locked.id, account_number=generate_iban(payload.currency), owner_name=locked.full_name, balance=0, currency=payload.currency)
    db.add(account)
    ledger.audit(db, locked.id, "account.currency_opened", currency=payload.currency)
    await db.commit()
    await db.refresh(account)
    return account


@app.get("/accounts/me", response_model=List[schemas.AccountResponse], tags=["Accounts"])
async def get_my_accounts(
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Lists all bank accounts owned by the currently authenticated user.
    """
    query = (
        select(models.Account)
        .where(models.Account.user_id == current_user.id)
        .order_by(models.Account.id.asc())
    )
    result = await db.execute(query)
    return result.scalars().all()


@app.get("/accounts/{account_id}", response_model=schemas.AccountResponse, tags=["Accounts"])
async def get_account(
    account_id: int,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Fetches an account by ID. Enforces ownership or AUDITOR role.
    """
    query = select(models.Account).where(models.Account.id == account_id)
    result = await db.execute(query)
    account = result.scalar_one_or_none()

    if not account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Account with ID {account_id} not found."
        )

    if account.user_id != current_user.id and current_user.role != models.UserRole.AUDITOR:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: You do not have permission to view this account."
        )

    return account


@app.get("/accounts/{account_id}/statement", response_model=schemas.AccountStatementResponse, tags=["Accounts"])
async def get_account_statement(
    account_id: int,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Fetches the double-entry audit trail for an account. Accessible by owner or AUDITOR.
    """
    acc_query = select(models.Account).where(models.Account.id == account_id)
    acc_result = await db.execute(acc_query)
    account = acc_result.scalar_one_or_none()

    if not account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Account with ID {account_id} not found."
        )

    if account.user_id != current_user.id and current_user.role != models.UserRole.AUDITOR:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: Only the account owner or an auditor can view statements."
        )

    entries_query = (
        select(models.LedgerEntry, models.Transaction)
        .join(models.Transaction)
        .where(models.LedgerEntry.account_id == account_id)
        .order_by(models.LedgerEntry.created_at.desc())
    )
    entries_result = await db.execute(entries_query)
    entries = [dict(id=e.id, transaction_id=e.transaction_id, amount=e.amount,
        entry_type=e.entry_type.value, created_at=e.created_at, kind=tx.kind,
        reference=tx.reference) for e, tx in entries_result.all()]

    return schemas.AccountStatementResponse(
        account_id=account.id,
        account_number=account.account_number,
        current_balance=account.balance,
        entries=entries
    )


@app.post("/transfers", response_model=schemas.TransferResponse, status_code=status.HTTP_200_OK, tags=["Transfers"])
async def transfer_funds(
    payload: schemas.TransferRequest,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis)
):
    guards.require_customer(current_user)
    await guards.check_transfer_rate_limit(current_user.id, redis)
    guards.evaluate_anti_fraud_rules(payload.amount)
    tx, replay = await ledger.post(db, current_user.id, payload.idempotency_key,
        payload.source_account_id, payload.destination_account_id, payload.amount,
        reference=payload.reference)
    await db.commit()
    return schemas.TransferResponse(transaction_id=tx.id, idempotency_key=payload.idempotency_key,
        status=tx.status.value, message="Transfer already processed." if replay else "Funds transferred successfully.")


register_veyra_routes(app, get_current_user)
register_operations(app, get_current_user)


@app.get("/health/ready", tags=["System"])
async def readiness(db=Depends(get_db), redis=Depends(get_redis)):
    try:
        await db.execute(text("SELECT 1"))
        await redis.ping()
    except Exception:
        raise HTTPException(503, "Database or cache is unavailable.")
    return {"status": "ready", "database": "up", "redis": "up"}


@app.get("/health/worker", tags=["System"])
async def worker_health(redis=Depends(get_redis)):
    heartbeat = await redis.get("veyra:worker:heartbeat")
    if not heartbeat:
        raise HTTPException(503, "The background worker is not reporting a heartbeat.")
    return {"status": "ready", "scheduler": "up", "last_poll": heartbeat}


static_dir = os.path.join(os.path.dirname(__file__), "static")

if os.path.exists(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static")


@app.get("/", response_class=HTMLResponse, tags=["Frontend"])
async def serve_banking_ui():
    """Serves the Veyra FinTech web application dashboard."""
    html_path = os.path.join(static_dir, "index.html")
    with open(html_path, "r", encoding="utf-8") as f:
        return f.read()

