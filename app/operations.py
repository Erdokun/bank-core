"""Authenticated banking operations and a restart-safe scheduled-payment worker."""
import asyncio
import logging
import os
from datetime import datetime, timezone, timedelta
from typing import Literal
from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel, Field, AwareDatetime
from sqlalchemy import select, func, case
from app import models, ledger, guards
from app.database import get_db, AsyncSessionLocal
from app.redis_client import get_redis


def sandbox_enabled():
    return os.getenv("BANK_SANDBOX", "false").lower() == "true"


def require_sandbox():
    if not sandbox_enabled():
        raise HTTPException(403, "Sandbox operations are disabled in this environment.")


class Funding(BaseModel):
    account_id: int = Field(gt=0)
    amount: int = Field(strict=True, gt=0, le=500000)
    idempotency_key: str = Field(min_length=5, max_length=100)


class CardPayment(Funding):
    merchant: str = Field(min_length=2, max_length=100)
    channel: Literal["online", "contactless", "atm"] = "online"


class BeneficiaryCreate(BaseModel):
    account_id: int = Field(gt=0)
    name: str = Field(min_length=2, max_length=100, pattern=r"^\S(?:.*\S)?$")


class ScheduleCreate(BaseModel):
    idempotency_key: str = Field(min_length=5, max_length=100)
    source_account_id: int = Field(gt=0)
    destination_account_id: int = Field(gt=0)
    amount: int = Field(strict=True, gt=0, le=1000000)
    reference: str = Field(default="", max_length=140)
    due_at: AwareDatetime


def payment_response(tx, replay=False):
    return {"transaction_id": tx.id, "status": tx.status.value, "message": "Payment already processed." if replay else "Payment completed."}


async def owned_account(db, user_id, account_id):
    account = await db.get(models.Account, account_id)
    if not account or account.user_id != user_id or account.kind != "current":
        raise HTTPException(404, "Current account not found.")
    return account


def register_operations(app, current_user):
    @app.get("/system/capabilities", tags=["System"])
    async def capabilities():
        return {"sandbox": sandbox_enabled(), "currencies": ["EUR", "USD", "GBP", "TRY"], "external_transfers": False, "card_network": False, "scheduled_payments": True}

    @app.post("/sandbox/funding", tags=["Sandbox"])
    async def fund(payload: Funding, user=Depends(current_user), db=Depends(get_db), redis=Depends(get_redis)):
        guards.require_customer(user)
        require_sandbox()
        await guards.check_transfer_rate_limit(user.id, redis, "funding")
        account = await owned_account(db, user.id, payload.account_id)
        clearing = await ledger.clearing_account(db, account.currency)
        tx, replay = await ledger.post(db, user.id, "fund:" + payload.idempotency_key, clearing.id, account.id, payload.amount, kind="sandbox_funding", reference="Sandbox funding", clearing_source=True)
        await db.commit()
        return payment_response(tx, replay)

    @app.post("/sandbox/card-payments", tags=["Sandbox"])
    async def card_payment(payload: CardPayment, user=Depends(current_user), db=Depends(get_db), redis=Depends(get_redis)):
        guards.require_customer(user)
        require_sandbox()
        await guards.check_transfer_rate_limit(user.id, redis, "card")
        account = await owned_account(db, user.id, payload.account_id)
        clearing = await ledger.clearing_account(db, account.currency)
        # Serialize all of this user's card channels, including preference changes.
        locked = (await db.execute(select(models.User).where(models.User.id == user.id).with_for_update().execution_options(populate_existing=True))).scalar_one()
        guards.require_active(locked)
        _, _, existing = await ledger.lock_operation(db, user.id, "card:" + payload.idempotency_key, dict(source=account.id, destination=clearing.id, amount=payload.amount, kind="card_" + payload.channel, reference=payload.merchant))
        if existing:
            return payment_response(existing, True)
        settings = locked.settings
        if settings.get("card_frozen", False):
            raise HTTPException(403, "Your card is frozen. Unfreeze it before making payments.")
        if payload.channel == "online" and not settings.get("online_payments", True):
            raise HTTPException(403, "Online payments are disabled.")
        if payload.channel == "contactless" and payload.amount > settings.get("contactless_limit", 5000):
            raise HTTPException(422, "Contactless payment exceeds your per-payment limit.")
        today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        # Card limits are denominated in the selected account's currency.
        spent = await db.scalar(select(func.coalesce(func.sum(models.LedgerEntry.amount), 0)).join(models.Transaction).join(models.Account).where(models.Account.user_id == user.id, models.Account.currency == account.currency, models.LedgerEntry.entry_type == models.EntryType.DEBIT, models.Transaction.kind.like("card_%"), models.Transaction.created_at >= today))
        if spent + payload.amount > settings.get("daily_limit", 250000):
            raise HTTPException(422, "Daily card spending limit exceeded.")
        if payload.channel == "atm":
            atm_spent = await db.scalar(select(func.coalesce(func.sum(models.LedgerEntry.amount), 0)).join(models.Transaction).join(models.Account).where(models.Account.user_id == user.id, models.Account.currency == account.currency, models.LedgerEntry.entry_type == models.EntryType.DEBIT, models.Transaction.kind == "card_atm", models.Transaction.created_at >= today))
            if atm_spent + payload.amount > settings.get("atm_limit", 100000):
                raise HTTPException(422, "Daily ATM withdrawal limit exceeded.")
        tx, replay = await ledger.post(db, user.id, "card:" + payload.idempotency_key, account.id, clearing.id, payload.amount, kind="card_" + payload.channel, reference=payload.merchant)
        await db.commit()
        return payment_response(tx, replay)

    @app.get("/beneficiaries", tags=["Beneficiaries"])
    async def beneficiaries(user=Depends(current_user), db=Depends(get_db)):
        rows = (await db.execute(select(models.Beneficiary, models.Account).join(models.Account).where(models.Beneficiary.user_id == user.id, models.Account.kind == "current").order_by(models.Beneficiary.id.desc()))).all()
        return [{"id": b.id, "name": b.name, "account_id": a.id, "account_number": a.account_number, "currency": a.currency} for b, a in rows]

    @app.post("/beneficiaries", status_code=201, tags=["Beneficiaries"])
    async def add_beneficiary(payload: BeneficiaryCreate, user=Depends(current_user), db=Depends(get_db)):
        locked = (await db.execute(select(models.User).where(models.User.id == user.id).with_for_update().execution_options(populate_existing=True))).scalar_one()
        guards.require_active(locked)
        account = await db.get(models.Account, payload.account_id)
        if not account or account.kind != "current":
            raise HTTPException(404, "Recipient account not found.")
        saved = models.Beneficiary(user_id=user.id, **payload.model_dump())
        db.add(saved)
        ledger.audit(db, user.id, "beneficiary.created", account_id=account.id)
        await db.commit()
        return {"id": saved.id, "name": saved.name, "account_id": saved.account_id}

    @app.delete("/beneficiaries/{beneficiary_id}", tags=["Beneficiaries"])
    async def delete_beneficiary(beneficiary_id: int, user=Depends(current_user), db=Depends(get_db)):
        saved = (await db.execute(select(models.Beneficiary).where(models.Beneficiary.id == beneficiary_id, models.Beneficiary.user_id == user.id))).scalar_one_or_none()
        if not saved:
            raise HTTPException(404, "Saved recipient not found.")
        await db.delete(saved)
        ledger.audit(db, user.id, "beneficiary.deleted", beneficiary_id=beneficiary_id)
        await db.commit()
        return {"status": "deleted"}

    @app.get("/payments/scheduled", tags=["Scheduled payments"])
    async def schedules(user=Depends(current_user), db=Depends(get_db)):
        return (await db.execute(select(models.ScheduledPayment).where(models.ScheduledPayment.user_id == user.id).order_by(models.ScheduledPayment.due_at.desc()).limit(100))).scalars().all()

    @app.post("/payments/scheduled", status_code=201, tags=["Scheduled payments"])
    async def schedule(payload: ScheduleCreate, user=Depends(current_user), db=Depends(get_db)):
        guards.require_customer(user)
        locked = (await db.execute(select(models.User).where(models.User.id == user.id).with_for_update().execution_options(populate_existing=True))).scalar_one()
        guards.require_active(locked)
        key, fingerprint, _ = await ledger.lock_operation(db, user.id, "schedule:" + payload.idempotency_key, payload.model_dump(mode="json", exclude={"idempotency_key"}))
        existing = (await db.execute(select(models.ScheduledPayment).where(models.ScheduledPayment.request_key == key))).scalar_one_or_none()
        if existing:
            if existing.request_hash != fingerprint:
                raise HTTPException(409, "This idempotency key was used with different schedule details.")
            return existing
        if payload.due_at < datetime.now(timezone.utc) or payload.due_at > datetime.now(timezone.utc) + timedelta(days=366):
            raise HTTPException(422, "Choose a future payment date within one year.")
        source = await owned_account(db, user.id, payload.source_account_id)
        dest = await db.get(models.Account, payload.destination_account_id)
        if not dest or dest.kind != "current" or source.id == dest.id or dest.currency != source.currency:
            raise HTTPException(422, "Choose a different current account in the same currency.")
        item = models.ScheduledPayment(user_id=user.id, request_key=key, request_hash=fingerprint, **payload.model_dump(exclude={"idempotency_key"}))
        db.add(item)
        ledger.audit(db, user.id, "schedule.created", amount=payload.amount, due_at=payload.due_at.isoformat())
        await db.commit()
        return item

    @app.delete("/payments/scheduled/{payment_id}", tags=["Scheduled payments"])
    async def cancel_schedule(payment_id: int, user=Depends(current_user), db=Depends(get_db)):
        item = (await db.execute(select(models.ScheduledPayment).where(models.ScheduledPayment.id == payment_id, models.ScheduledPayment.user_id == user.id).with_for_update())).scalar_one_or_none()
        if not item:
            raise HTTPException(404, "Scheduled payment not found.")
        if item.status != "PENDING":
            raise HTTPException(409, "Only pending payments can be cancelled.")
        item.status = "CANCELLED"
        ledger.audit(db, user.id, "schedule.cancelled", payment_id=item.id)
        await db.commit()
        return {"status": item.status}

    @app.get("/audit/events", tags=["Audit"])
    async def audit_events(limit: int = Query(50, ge=1, le=200), user=Depends(current_user), db=Depends(get_db)):
        return (await db.execute(select(models.AuditEvent).where(models.AuditEvent.user_id == user.id).order_by(models.AuditEvent.id.desc()).limit(limit))).scalars().all()

    @app.get("/accounts/{account_id}/reconciliation", tags=["Audit"])
    async def reconcile(account_id: int, user=Depends(current_user), db=Depends(get_db)):
        account = await owned_account(db, user.id, account_id)
        # A stable account lock prevents a concurrent posting between the two reads.
        account = (await db.execute(select(models.Account).where(models.Account.id == account_id).with_for_update().execution_options(populate_existing=True))).scalar_one()
        journal = await db.scalar(select(func.coalesce(func.sum(case((models.LedgerEntry.entry_type == models.EntryType.CREDIT, models.LedgerEntry.amount), else_=-models.LedgerEntry.amount)), 0)).where(models.LedgerEntry.account_id == account_id))
        return {"account_id": account.id, "balance": account.balance, "journal_balance": journal, "difference": account.balance - journal, "balanced": account.balance == journal, "currency": account.currency}


async def process_due_payments():
    """SKIP LOCKED permits multiple API workers without duplicate settlements."""
    for _ in range(50):
        async with AsyncSessionLocal() as db:
            item = (await db.execute(select(models.ScheduledPayment).where(models.ScheduledPayment.status == "PENDING", models.ScheduledPayment.due_at <= datetime.now(timezone.utc)).order_by(models.ScheduledPayment.id).limit(1).with_for_update(skip_locked=True))).scalar_one_or_none()
            if item is None:
                return
            try:
                async with db.begin_nested():
                    tx, _ = await ledger.post(db, item.user_id, f"scheduled:{item.id}", item.source_account_id, item.destination_account_id, item.amount, reference=item.reference)
                    item.transaction_id = tx.id
                    item.status = "COMPLETED"
            except HTTPException as exc:
                item.status = "FAILED"
                item.failure_reason = str(exc.detail)[:255]
                ledger.audit(db, item.user_id, "schedule.failed", payment_id=item.id, reason=item.failure_reason)
            await db.commit()


async def scheduler_loop():
    while True:
        try:
            await process_due_payments()
        except Exception:
            logging.getLogger("bank-core").exception("scheduled_payment_worker_failed")
        await asyncio.sleep(10)
