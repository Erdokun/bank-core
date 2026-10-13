from fastapi import FastAPI, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import uuid

from database import get_db
import models
import schemas

app = FastAPI(
    title="Bank Core Ledger API",
    description="High-concurrency banking engine with double-entry ledger bookkeeping.",
    version="1.0.0"
)

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
    # Generate a unique synthetic account number (e.g., DE89...)
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
    from sqlalchemy.exc import IntegrityError

@app.post("/transfers", response_model=schemas.TransferResponse, status_code=status.HTTP_200_OK, tags=["Transfers"])
async def transfer_funds(
    payload: schemas.TransferRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Executes an atomic funds transfer using pessimistic row-level locking
    and double-entry ledger bookkeeping.
    """
    # 1. Reject transfers to the same account
    if payload.source_account_id == payload.destination_account_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Source and destination accounts must be different."
        )

    # 2. Check for existing idempotency key to prevent double execution
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
            message="Transfer already processed (Idempotent response)."
        )

    # 3. Prevent database deadlocks by ordering account IDs for locking
    first_id = min(payload.source_account_id, payload.destination_account_id)
    second_id = max(payload.source_account_id, payload.destination_account_id)

    # 4. Acquire pessimistic locks (SELECT ... FOR UPDATE) on both accounts in a deterministic order
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

    # Map locked instances back to sender and receiver
    sender = acc_first if acc_first.id == payload.source_account_id else acc_second
    receiver = acc_first if acc_first.id == payload.destination_account_id else acc_second

    # 5. Verify sufficient available balance
    if sender.balance < payload.amount:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Insufficient funds. Available: {sender.balance} cents, Required: {payload.amount} cents."
        )

    # 6. Apply state mutations within the atomic database transaction
    sender.balance -= payload.amount
    receiver.balance += payload.amount

    # Create transaction log record
    transaction_record = models.Transaction(
        idempotency_key=payload.idempotency_key,
        status=models.TransactionStatus.COMPLETED
    )
    db.add(transaction_record)
    await db.flush()  # Flush to populate transaction_record.id without committing

    # Create double-entry bookkeeping ledger records
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

    # Commit all changes atomically (Rolls back automatically on failure)
    await db.commit()

    return schemas.TransferResponse(
        transaction_id=transaction_record.id,
        idempotency_key=transaction_record.idempotency_key,
        status=transaction_record.status.value,
        message="Funds transferred successfully."
    )

@app.get("/accounts/{account_id}/statement", response_model=schemas.AccountStatementResponse, tags=["Accounts"])
async def get_account_statement(
    account_id: int,
    db: AsyncSession = Depends(get_db)
):
    """
    Fetches the double-entry bookkeeping audit trail for a specific account.
    """
    # 1. Verify account exists
    acc_query = select(models.Account).where(models.Account.id == account_id)
    acc_result = await db.execute(acc_query)
    account = acc_result.scalar_one_or_none()

    if not account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Account with ID {account_id} not found."
        )

    # 2. Fetch all ledger entries linked to this account ordered by time
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