import time
import uuid
import logging
from fastapi import FastAPI, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import redis.asyncio as aioredis

from database import get_db
from redis_client import get_redis
import models
import schemas

# Configure structured-style application logger
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s"
)
logger = logging.getLogger("bank-core")

app = FastAPI(
    title="Bank Core Ledger API",
    description="High-concurrency banking engine with double-entry ledger bookkeeping.",
    version="1.0.0"
)

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

@app.post("/accounts", response_model=schemas.AccountResponse, status_code=status.HTTP_201_CREATED, tags=["Accounts"])
async def create_account(
    payload: schemas.AccountCreate,
    db: AsyncSession = Depends(get_db)
):
    """
    Creates a new bank account with an automatically generated account identifier.
    """
    generated_iban = f"DE89{uuid.uuid4().hex[:18].upper()}"

    new_account = models.Account(
        account_number=generated_iban,
        owner_name=payload.owner_name,
        balance=payload.initial_balance
    )

    db.add(new_account)
    await db.commit()
    await db.refresh(new_account)

    return new_account

@app.get("/accounts/{account_id}", response_model=schemas.AccountResponse, tags=["Accounts"])
async def get_account(
    account_id: int,
    db: AsyncSession = Depends(get_db)
):
    """
    Fetches an existing account by its unique primary key identifier.
    """
    query = select(models.Account).where(models.Account.id == account_id)
    result = await db.execute(query)
    account = result.scalar_one_or_none()

    if not account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Account with ID {account_id} not found."
        )

    return account

@app.get("/accounts/{account_id}/statement", response_model=schemas.AccountStatementResponse, tags=["Accounts"])
async def get_account_statement(
    account_id: int,
    db: AsyncSession = Depends(get_db)
):
    """
    Fetches the double-entry bookkeeping audit trail for a specific account.
    """
    acc_query = select(models.Account).where(models.Account.id == account_id)
    acc_result = await db.execute(acc_query)
    account = acc_result.scalar_one_or_none()

    if not account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Account with ID {account_id} not found."
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
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis)
):
    """
    Executes an atomic funds transfer using Redis fast-fail idempotency checks,
    pessimistic row-level locking, and double-entry ledger bookkeeping.
    """
    if payload.source_account_id == payload.destination_account_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Source and destination accounts must be different."
        )

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