"""One atomic posting path for transfers, sandbox funding and card payments.

The caller owns commit/rollback. PostgreSQL, rather than a transient cache, is
the authority for idempotency. Locks are always acquired in account ID order.
"""
import hashlib
import json
from sqlalchemy import select, text
from fastapi import HTTPException
from app import models


def audit(db, user_id, action, **details):
    db.add(models.AuditEvent(user_id=user_id, action=action, details=details))


async def lock_operation(db, user_id, key, payload):
    storage_key = hashlib.sha256(f"{user_id}:{key}".encode()).hexdigest()
    fingerprint = hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    await db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"), {"key": storage_key})
    existing = (await db.execute(select(models.Transaction).where(models.Transaction.idempotency_key == storage_key))).scalar_one_or_none()
    if existing and existing.request_hash != fingerprint:
        raise HTTPException(409, "This idempotency key was used with different payment details.")
    return storage_key, fingerprint, existing


async def post(db, user_id, key, source_id, destination_id, amount, *, kind="transfer", reference="", clearing_source=False):
    if amount <= 0 or source_id == destination_id:
        raise HTTPException(400, "Choose different accounts and a positive amount.")
    storage_key, fingerprint, existing = await lock_operation(db, user_id, key, dict(source=source_id, destination=destination_id, amount=amount, kind=kind, reference=reference))
    if existing:
        return existing, True
    accounts = (await db.execute(select(models.Account).where(models.Account.id.in_([source_id, destination_id])).order_by(models.Account.id).with_for_update().execution_options(populate_existing=True))).scalars().all()
    if len(accounts) != 2:
        raise HTTPException(404, "One or both bank accounts do not exist.")
    source = next(a for a in accounts if a.id == source_id)
    destination = next(a for a in accounts if a.id == destination_id)
    if clearing_source:
        if source.kind != "clearing" or destination.user_id != user_id:
            raise HTTPException(403, "Invalid funding accounts.")
    elif source.user_id != user_id:
        raise HTTPException(403, "You can only transfer funds from your own account.")
    if not clearing_source and source.kind == "clearing":
        raise HTTPException(403, "Clearing accounts cannot initiate customer payments.")
    if kind == "transfer" and destination.kind == "clearing":
        raise HTTPException(403, "Choose a customer destination account.")
    if destination.kind == "space" and destination.user_id != user_id:
        raise HTTPException(403, "Savings spaces only accept their owner's transfers.")
    if source.currency != destination.currency:
        raise HTTPException(400, "Use currency exchange for different settlement currencies.")
    if not clearing_source and source.balance < amount:
        raise HTTPException(400, "Insufficient funds in the source account.")
    source.balance -= amount
    destination.balance += amount
    tx = models.Transaction(user_id=user_id, idempotency_key=storage_key, request_hash=fingerprint, kind=kind, reference=reference, status=models.TransactionStatus.COMPLETED)
    db.add(tx)
    await db.flush()
    db.add_all([models.LedgerEntry(transaction_id=tx.id, account_id=source.id, amount=amount, entry_type=models.EntryType.DEBIT), models.LedgerEntry(transaction_id=tx.id, account_id=destination.id, amount=amount, entry_type=models.EntryType.CREDIT)])
    audit(db, user_id, "payment." + kind, transaction_id=tx.id, amount=amount, currency=source.currency, reference=reference)
    return tx, False


async def clearing_account(db, currency):
    from app.veyra import generate_iban
    account = (await db.execute(select(models.Account).join(models.User).where(models.User.email == "treasury@internal.veyra.invalid", models.Account.currency == currency, models.Account.kind == "clearing"))).scalar_one_or_none()
    if account is not None:
        return account
    # Only first-time provisioning needs the global lock.
    await db.execute(text("SELECT pg_advisory_xact_lock(82764001)"))
    treasury = (await db.execute(select(models.User).where(models.User.email == "treasury@internal.veyra.invalid"))).scalar_one_or_none()
    if treasury is None:
        from app import security
        import secrets
        treasury = models.User(email="treasury@internal.veyra.invalid", full_name="Veyra Clearing", hashed_password=await security.hash_password_async(secrets.token_urlsafe(48)))
        db.add(treasury)
        await db.flush()
    account = (await db.execute(select(models.Account).where(models.Account.user_id == treasury.id, models.Account.currency == currency, models.Account.kind == "clearing"))).scalar_one_or_none()
    if account is None:
        account = models.Account(user_id=treasury.id, account_number=generate_iban(currency), owner_name="Sandbox clearing", currency=currency, kind="clearing", balance=0)
        db.add(account)
        await db.flush()
    return account
