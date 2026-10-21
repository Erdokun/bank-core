import time
import uuid
import logging
from typing import List
import jwt
from fastapi import FastAPI, Depends, HTTPException, Request, status
from fastapi.responses import HTMLResponse
import os
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import redis.asyncio as aioredis

from app.database import get_db
from app.redis_client import get_redis
from app import models, schemas, security, guards

# Configure structured-style application logger
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s"
)
logger = logging.getLogger("bank-core")

app = FastAPI(
    title="Bank Core Ledger API",
    description="High-concurrency banking engine with double-entry ledger bookkeeping, JWT auth, RBAC, and Anti-Fraud guards.",
    version="1.3.0"
)

# Bearer token security scheme for Swagger UI Authorize button
security_scheme = HTTPBearer()


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

    if not user:
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
    request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))
    start_time = time.perf_counter()

    logger.info(f"request_started | request_id={request_id} method={request.method} path={request.url.path}")

    response = await call_next(request)

    process_time_ms = round((time.perf_counter() - start_time) * 1000, 2)
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
        hashed_password=security.hash_password(payload.password),
        role=payload.role
    )

    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)

    return new_user


@app.post("/auth/login", response_model=schemas.TokenResponse, tags=["Auth"])
async def login_user(
    payload: schemas.LoginRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Authenticates user credentials and returns a signed JWT access token.
    """
    query = select(models.User).where(models.User.email == payload.email)
    result = await db.execute(query)
    user = result.scalar_one_or_none()

    if not user or not security.verify_password(payload.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password."
        )

    access_token = security.create_access_token(
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
    generated_iban = f"DE89{uuid.uuid4().hex[:18].upper()}"
    owner_name = payload.owner_name if payload.owner_name else current_user.full_name

    new_account = models.Account(
        user_id=current_user.id,
        account_number=generated_iban,
        owner_name=owner_name,
        balance=payload.initial_balance
    )

    db.add(new_account)
    await db.commit()
    await db.refresh(new_account)

    return new_account


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
        select(models.LedgerEntry)
        .where(models.LedgerEntry.account_id == account_id)
        .order_by(models.LedgerEntry.created_at.desc())
    )
    entries_result = await db.execute(entries_query)
    entries = entries_result.scalars().all()

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
    """
    Executes an atomic funds transfer protected by Redis Rate Limiting,
    Anti-Fraud AML compliance rules, Redis Idempotency, and PostgreSQL row locking.
    """
    # 1. Redis Rate Limiting Guard (Max 10 attempts per minute per user)
    await guards.check_transfer_rate_limit(current_user.id, redis)
    guards.evaluate_anti_fraud_rules(payload.amount)

    # 2. Basic validation
    if payload.source_account_id == payload.destination_account_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Source and destination accounts must be different."
        )

    # 3. Anti-Fraud / AML Compliance Guard (Max 10,000.00 EUR per single transfer)
    guards.evaluate_anti_fraud_rules(payload.amount)

    # 4. Redis Fast-Path Idempotency Check
    redis_key = f"idempotency:{payload.idempotency_key}"
    is_new_request = await redis.set(redis_key, "PROCESSING", ex=60, nx=True)

    if not is_new_request:
        existing_tx_query = select(models.Transaction).where(
            models.Transaction.idempotency_key == payload.idempotency_key
        )
        tx_result = await db.execute(existing_tx_query)
        existing_tx = tx_result.scalar_one_or_none()

        if existing_tx:
            return schemas.TransferResponse(
                transaction_id=existing_tx.id,
                idempotency_key=existing_tx.idempotency_key,
                status=existing_tx.status.value,
                message="Transfer already processed (Redis cached response)."
            )

        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A transfer request with this idempotency key is already in progress."
        )

    try:
        first_id = min(payload.source_account_id, payload.destination_account_id)
        second_id = max(payload.source_account_id, payload.destination_account_id)

        stmt_first = select(models.Account).where(models.Account.id == first_id).with_for_update()
        stmt_second = select(models.Account).where(models.Account.id == second_id).with_for_update()

        res_first = await db.execute(stmt_first)
        res_second = await db.execute(stmt_second)

        acc_first = res_first.scalar_one_or_none()
        acc_second = res_second.scalar_one_or_none()

        if not acc_first or not acc_second:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="One or both bank accounts do not exist."
            )

        sender = acc_first if acc_first.id == payload.source_account_id else acc_second
        receiver = acc_first if acc_first.id == payload.destination_account_id else acc_second

        if sender.user_id != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied: You can only transfer funds from your own account."
            )

        if sender.balance < payload.amount:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Insufficient funds. Available: {sender.balance} cents, Required: {payload.amount} cents."
            )

        sender.balance -= payload.amount
        receiver.balance += payload.amount

        transaction_record = models.Transaction(
            idempotency_key=payload.idempotency_key,
            status=models.TransactionStatus.COMPLETED
        )
        db.add(transaction_record)
        await db.flush()

        debit_entry = models.LedgerEntry(
            transaction_id=transaction_record.id,
            account_id=sender.id,
            amount=payload.amount,
            entry_type=models.EntryType.DEBIT
        )
        credit_entry = models.LedgerEntry(
            transaction_id=transaction_record.id,
            account_id=receiver.id,
            amount=payload.amount,
            entry_type=models.EntryType.CREDIT
        )

        db.add_all([debit_entry, credit_entry])
        await db.commit()

        await redis.set(redis_key, "COMPLETED", ex=300)

        return schemas.TransferResponse(
            transaction_id=transaction_record.id,
            idempotency_key=transaction_record.idempotency_key,
            status=transaction_record.status.value,
            message="Funds transferred successfully."
        )

    except Exception:
        await redis.delete(redis_key)
        raise

@app.get("/", response_class=HTMLResponse, tags=["Frontend"])
async def serve_banking_ui():
    """Serves the FinTech web application dashboard."""
    html_path = os.path.join(os.path.dirname(__file__), "static", "index.html")
    with open(html_path, "r", encoding="utf-8") as f:
        return f.read()