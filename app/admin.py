"""Explicit local sandbox maintenance. Never exposed as an HTTP endpoint."""
import argparse
import asyncio
import json
import os
import uuid
from sqlalchemy import select, func, case
from app import models, ledger
from app.database import AsyncSessionLocal, engine


async def reset_balances(user_ids, apply=False):
    if os.getenv("APP_ENV") == "production" or os.getenv("BANK_SANDBOX", "false").lower() != "true":
        raise ValueError("Balance reset is available only in a non-production banking sandbox.")
    if not user_ids:
        raise ValueError("Select explicit user IDs.")
    async with AsyncSessionLocal() as db:
        users = (await db.execute(select(models.User).where(models.User.id.in_(user_ids), models.User.deleted_at.is_(None)).order_by(models.User.id).with_for_update())).scalars().all()
        if len(users) != len(set(user_ids)) or any(u.role != models.UserRole.CUSTOMER for u in users):
            raise ValueError("Every selected ID must belong to an active customer.")
        candidates = (await db.execute(select(models.Account).where(models.Account.user_id.in_(user_ids), models.Account.kind.in_(["current", "space"])).order_by(models.Account.id))).scalars().all()
        clearing = {c: await ledger.clearing_account(db, c) for c in sorted({a.currency for a in candidates})} if apply else {}
        # The scheduler locks its payment row before locking account rows.
        await db.execute(select(models.ScheduledPayment.id).where(models.ScheduledPayment.user_id.in_(user_ids), models.ScheduledPayment.status == "PENDING").order_by(models.ScheduledPayment.id).with_for_update())
        ids = [a.id for a in candidates] + [a.id for a in clearing.values()]
        locked = (await db.execute(select(models.Account).where(models.Account.id.in_(ids)).order_by(models.Account.id).with_for_update().execution_options(populate_existing=True))).scalars().all()
        accounts = [a for a in locked if a.user_id in user_ids and a.kind in ("current", "space")]
        report = []
        for account in accounts:
            journal = await db.scalar(select(func.coalesce(func.sum(case((models.LedgerEntry.entry_type == models.EntryType.CREDIT, models.LedgerEntry.amount), else_=-models.LedgerEntry.amount)), 0)).where(models.LedgerEntry.account_id == account.id))
            opening = account.balance - int(journal)
            if opening < 0:
                raise ValueError(f"Account {account.id} has an unexplained negative opening difference; manual review is required.")
            before = account.balance
            report.append(dict(user_id=account.user_id, account_id=account.id, currency=account.currency, before_minor=before, legacy_opening_minor=opening, after_minor=0 if apply else before))
            if not apply:
                continue
            counterparty = clearing[account.currency]
            if opening:
                # Legacy customer money already exists in balance. Journal its opening
                # without crediting the customer a second time; fund the clearing leg.
                key, fingerprint, previous = await ledger.lock_operation(db, account.user_id, f"legacy-opening:{account.id}", dict(account_id=account.id, opening=opening))
                if previous:
                    raise ValueError("An opening journal already exists but does not reconcile.")
                tx = models.Transaction(user_id=account.user_id, idempotency_key=key, request_hash=fingerprint, kind="legacy_opening", reference="Recorded legacy opening balance", status=models.TransactionStatus.COMPLETED)
                db.add(tx)
                await db.flush()
                db.add_all([models.LedgerEntry(transaction_id=tx.id, account_id=account.id, amount=opening, entry_type=models.EntryType.CREDIT), models.LedgerEntry(transaction_id=tx.id, account_id=counterparty.id, amount=opening, entry_type=models.EntryType.DEBIT)])
                counterparty.balance -= opening
                ledger.audit(db, account.user_id, "ledger.opening_reconciled", account_id=account.id, amount=opening)
            if before:
                await ledger.post(db, account.user_id, "reset:" + uuid.uuid4().hex, account.id, counterparty.id, before, kind="sandbox_reset", reference="Requested sandbox balance reset")
        if apply:
            await db.commit()
        else:
            await db.rollback()
        return {"applied": apply, "accounts": report}


async def main():
    parser = argparse.ArgumentParser(description="Review or reset explicit sandbox customer balances with balanced journal entries.")
    parser.add_argument("action", choices=["reset-balances"])
    parser.add_argument("--user-id", type=int, action="append", required=True)
    parser.add_argument("--apply", action="store_true", help="Commit the reviewed reset; default is read-only.")
    args = parser.parse_args()
    try:
        print(json.dumps(await reset_balances(args.user_id, args.apply)))
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
