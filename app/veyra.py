"""Veyra onboarding and authenticated workspace extensions.

No payment provider or OAuth identity is impersonated by these routes.
"""
import asyncio
import hashlib
import hmac
import json
import logging
import os
import secrets
import uuid
from datetime import datetime, timezone
from typing import Literal
from decimal import Decimal, ROUND_HALF_UP
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
from html import escape
from urllib.parse import urlsplit

import httpx
from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, delete
from sqlalchemy.exc import IntegrityError
from app import models, schemas, security, ledger, guards
from app.database import get_db
from app.redis_client import get_redis
from app.email_delivery import SmtpConfig, deliver

log = logging.getLogger("bank-core")
CURRENCIES = ("EUR", "TRY", "USD", "GBP")


def generate_iban(currency):
    # Valid ISO 13616 checksum; these are internal ledger identifiers, not issued bank IBANs.
    country, bban = ("TR", "00099" + "0" + "".join(str(secrets.randbelow(10)) for _ in range(16))) if currency == "TRY" else ("DE", "99999999" + "".join(str(secrets.randbelow(10)) for _ in range(10)))
    numeric = bban + "".join(str(ord(c) - 55) for c in country) + "00"
    return country + f"{98 - int(numeric) % 97:02d}" + bban


def otp_digest(email, code, purpose):
    return hmac.new(security.SECRET_KEY.encode(), f"{purpose}:{email}:{code}".encode(), hashlib.sha256).hexdigest()


def generate_veyra_otp_email_html(code, purpose="register"):
    app_url = os.getenv("PUBLIC_APP_URL", "http://localhost:8000").rstrip("/")
    parsed = urlsplit(app_url)
    copy_url = escape(app_url + "/", quote=True) if parsed.scheme in ("http", "https") and parsed.netloc else "http://localhost:8000/"
    title = {"delete": "Confirm your account deletion", "reset": "Reset your Veyra password", "login": "Confirm your sign-in", "settings": "Confirm your security change"}.get(purpose, "Verify your email address")
    instruction = {"delete": "Use this code only if you want to permanently delete your Veyra profile and sign-in. If you did not request this, do not share this code.", "reset": "Use this code to reset your Veyra password. If you did not request this, ignore this email.", "login": "Use this code to finish signing in to Veyra.", "settings": "Use this code to confirm a change to your Veyra security settings."}.get(purpose, "Use this code to verify your email address and activate your Veyra account.")
    return f'''<!doctype html><html lang="en"><body style="margin:0;background:#050505;padding:40px 16px;font-family:Arial,sans-serif;color:#f4f4f4">
    <table role="presentation" style="max-width:520px;margin:auto;background:#111;border:1px solid #303030;border-radius:24px;padding:36px;width:100%"><tr><td>
    <div style="font-size:28px;letter-spacing:-1px;margin-bottom:38px;color:#fff"><b>Ⅴ</b> veyra</div>
    <p style="font-size:10px;letter-spacing:2px;color:#888">YOUR ACCOUNT. YOUR PERSPECTIVE.</p>
    <h1 style="font-size:27px;font-weight:400;letter-spacing:-1px;color:#fff">{title}</h1><p style="line-height:1.8;color:#aaa">Hello,<br>{instruction}</p>
    <div style="font-family:monospace;font-size:34px;letter-spacing:8px;text-align:center;padding:28px 5px;background:#191919;color:#fff;border:1px solid #333;border-radius:16px;user-select:all">{escape(code)}</div>
    <p style="text-align:center;margin:26px"><a href="{copy_url}" style="display:inline-block;padding:14px 28px;background:#f4f4f4;color:#111;text-decoration:none;border-radius:999px;font-size:13px">Return to Veyra →</a></p>
    <p style="font-size:12px;color:#999;text-align:center;line-height:1.8">Enter this code in Veyra. It expires in 10 minutes and works only once.<br>Never share your code with anyone.</p>
    <p style="font-size:11px;color:#777;line-height:1.8;margin-top:30px;border-top:1px solid #333;padding-top:24px">If you did not request this code, you can ignore this email.<br><br>Veyra · An independent banking sandbox.<br>This is an automated email. Please do not reply.</p>
    </td></tr></table></body></html>'''


async def send_otp_email_smtp(email, code, purpose="register"):
    def dispatch():
        config = SmtpConfig.from_environment()
        message = EmailMessage()
        message["Subject"] = {"delete": "Confirm your Veyra account deletion", "reset": "Reset your Veyra password", "login": "Your Veyra sign-in code", "settings": "Confirm your Veyra security change"}.get(purpose, "Your Veyra verification code")
        message["From"] = config.sender
        message["To"] = email
        message["Date"] = formatdate(localtime=False, usegmt=True)
        message["Message-ID"] = make_msgid()
        message.set_content(f"{message['Subject']}\n\nYour one-time code: {code}\n\nThis code expires in 10 minutes. If you did not request it, ignore this email.\nVeyra")
        message.add_alternative(generate_veyra_otp_email_html(code, purpose), subtype="html")
        deliver(message, config)
    await asyncio.to_thread(dispatch)


async def issue_otp(email, redis, purpose="register"):
    key = f"veyra:otp:{purpose}:{email}"
    if not await redis.set(key + ":cooldown", "1", nx=True, ex=60):
        raise HTTPException(429, "Please wait 60 seconds before requesting another code.")
    daily = key + ":daily"
    count = await redis.incr(daily)
    if count == 1:
        await redis.expire(daily, 86400)
    if count > 20:
        raise HTTPException(429, "Daily email limit reached. Please try again tomorrow.")
    code = f"{secrets.randbelow(1000000):06d}"
    digest = otp_digest(email, code, purpose)
    # A single hash carries attempts and expiry. Verification is an atomic Redis script.
    await redis.hset(key, mapping={"digest": digest, "attempts": "0"})
    await redis.expire(key, 600)
    try:
        await send_otp_email_smtp(email, code, purpose)
    except Exception:
        await redis.delete(key, key + ":cooldown")
        log.warning("smtp_delivery_failed")
        raise HTTPException(503, "Email delivery is unavailable. Please try again later.")


async def consume_otp(email, code, redis, purpose="register"):
    result = await redis.eval('''
        local digest = redis.call('HGET', KEYS[1], 'digest')
        if not digest then return 0 end
        local attempts = redis.call('HINCRBY', KEYS[1], 'attempts', 1)
        if attempts > 5 then redis.call('DEL', KEYS[1]); return -2 end
        if digest ~= ARGV[1] then return -1 end
        redis.call('DEL', KEYS[1]); return 1
    ''', 1, f"veyra:otp:{purpose}:{email}", otp_digest(email, code, purpose))
    if result != 1:
        raise HTTPException(400, "Code is invalid, expired or already used. Request a new code if needed.")


class SettingsUpdate(BaseModel):
    selected_account_id: int | None = Field(default=None, strict=True, gt=0)
    avatar: str | None = Field(default=None, max_length=280000)
    card_frozen: bool | None = None
    online_payments: bool | None = None
    contactless_limit: int | None = Field(default=None, ge=0, le=50000)
    daily_limit: int | None = Field(default=None, ge=0, le=1000000)
    atm_limit: int | None = Field(default=None, ge=0, le=500000)
    theme: Literal["light", "dark"] | None = None
    primary_currency: Literal["EUR", "USD", "TRY", "GBP"] | None = None
    hide_balances: bool | None = None
    compact_activity: bool | None = None
    reduced_motion: bool | None = None
    idle_timeout: Literal[5, 15, 30, 60] | None = None
    monthly_budget: int | None = Field(default=None, ge=0, le=100000000)
    two_factor: bool | None = None
    password: str | None = Field(default=None, min_length=8, max_length=128)
    code: str | None = Field(default=None, pattern=r"^\d{6}$")


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


class ProfileUpdate(BaseModel):
    full_name: str = Field(min_length=2, max_length=100, pattern=r"^\S(?:.*\S)?$")


class DeletionRequest(BaseModel):
    password: str = Field(min_length=1, max_length=128)


class AccountDeletion(DeletionRequest):
    code: str = Field(pattern=r"^\d{6}$")
    confirmation: Literal["DELETE"]


class ResetRequest(schemas.OtpSendRequest):
    pass


class PasswordReset(ResetRequest):
    code: str = Field(pattern=r"^\d{6}$")
    new_password: str = Field(min_length=8, max_length=128)


class FxQuote(BaseModel):
    source_account_id: int = Field(gt=0)
    destination_account_id: int = Field(gt=0)
    amount: int = Field(strict=True, gt=0, le=1000000)


class FxExecute(BaseModel):
    quote_id: str = Field(pattern=r"^[a-f0-9]{32}$")


def register_veyra_routes(app, current_user_dependency):
    @app.get("/workspace", tags=["Workspace"])
    async def workspace_snapshot(user=Depends(current_user_dependency), db=Depends(get_db)):
        # Shared account locks keep balances and the journal in the same snapshot.
        accounts = (await db.execute(select(models.Account).where(models.Account.user_id == user.id, models.Account.kind.in_(["current", "space"])).order_by(models.Account.id).with_for_update(read=True).execution_options(populate_existing=True))).scalars().all()
        ids = [account.id for account in accounts]
        entries = (await db.execute(select(models.LedgerEntry, models.Transaction, models.Account.currency).join(models.Transaction).join(models.Account, models.Account.id == models.LedgerEntry.account_id).where(models.LedgerEntry.account_id.in_(ids), models.Account.kind == "current").order_by(models.LedgerEntry.created_at.desc(), models.LedgerEntry.id.desc()))).all() if ids else []
        saved = (await db.execute(select(models.Beneficiary, models.Account).join(models.Account).where(models.Beneficiary.user_id == user.id, models.Account.kind == "current").order_by(models.Beneficiary.id.desc()))).all()
        return {"user": schemas.UserResponse.model_validate(user), "accounts": [schemas.AccountResponse.model_validate(a) for a in accounts], "entries": [dict(id=e.id, transaction_id=e.transaction_id, account_id=e.account_id, amount=e.amount, entry_type=e.entry_type.value, created_at=e.created_at, kind=tx.kind, reference=tx.reference, currency=currency) for e, tx, currency in entries], "recipients": [dict(id=b.id, name=b.name, account_id=a.id, account_number=a.account_number, currency=a.currency) for b, a in saved], "synced_at": datetime.now(timezone.utc)}

    @app.post("/auth/account/deletion-code", tags=["Auth"])
    async def request_deletion(payload: DeletionRequest, user=Depends(current_user_dependency), db=Depends(get_db), redis=Depends(get_redis)):
        guards.require_customer(user)
        await guards.check_transfer_rate_limit(user.id, redis, "account-delete")
        if not await security.verify_password_async(payload.password, user.hashed_password):
            raise HTTPException(401, "Confirm your current password to delete your account.")
        if (await db.execute(select(models.Account.id).where(models.Account.user_id == user.id, models.Account.balance != 0))).first():
            raise HTTPException(409, "Move all remaining balances out of your accounts and savings spaces before deleting your account.")
        await issue_otp(user.email, redis, "delete")
        return {"status": "dispatched", "expires_in": 600}

    @app.delete("/auth/account", tags=["Auth"])
    async def delete_account(payload: AccountDeletion, user=Depends(current_user_dependency), db=Depends(get_db), redis=Depends(get_redis)):
        await guards.check_transfer_rate_limit(user.id, redis, "account-delete")
        locked = (await db.execute(select(models.User).where(models.User.id == user.id).with_for_update().execution_options(populate_existing=True))).scalar_one()
        guards.require_customer(locked)
        if not await security.verify_password_async(payload.password, locked.hashed_password):
            raise HTTPException(401, "Your current password is incorrect.")
        # Lock schedules before accounts, matching the worker's schedule -> account order.
        pending = (await db.execute(select(models.ScheduledPayment).where(models.ScheduledPayment.user_id == user.id, models.ScheduledPayment.status == "PENDING").order_by(models.ScheduledPayment.id).with_for_update().execution_options(populate_existing=True))).scalars().all()
        accounts = (await db.execute(select(models.Account).where(models.Account.user_id == user.id).order_by(models.Account.id).with_for_update().execution_options(populate_existing=True))).scalars().all()
        if any(account.balance != 0 for account in accounts):
            raise HTTPException(409, "Move all remaining balances out of your accounts and savings spaces before deleting your account.")
        await consume_otp(locked.email, payload.code, redis, "delete")
        for item in pending:
            item.status = "CANCELLED"
        for account in accounts:
            account.kind = "closed"
            account.owner_name = "Deleted Veyra member"
            account.goal = 0
        old_email = locked.email
        locked.email = f"deleted-{uuid.uuid4().hex}@deleted.veyra.invalid"
        locked.full_name = "Deleted Veyra member"
        locked.hashed_password = await security.hash_password_async(secrets.token_urlsafe(48))
        locked.settings = {}
        locked.token_version += 1
        locked.deleted_at = datetime.now(timezone.utc)
        await db.execute(delete(models.Beneficiary).where(models.Beneficiary.user_id == user.id))
        ledger.audit(db, user.id, "auth.account_deleted", closed_accounts=len(accounts), cancelled_schedules=len(pending))
        await redis.delete(*(f"veyra:otp:{purpose}:{old_email}" for purpose in ("login", "settings", "reset")))
        await db.commit()
        return {"status": "deleted", "message": "Your profile and sign-in have been deleted. Closed accounts and immutable transaction history are retained."}

    @app.post("/auth/password/reset/request", tags=["Auth"])
    async def request_reset(payload: ResetRequest, db=Depends(get_db), redis=Depends(get_redis)):
        email = payload.email.strip().lower()
        # The same response and cooldown apply whether the address exists or not.
        gate = f"veyra:reset-request:{email}"
        if not await redis.set(gate, "1", nx=True, ex=60):
            raise HTTPException(429, "Please wait 60 seconds before requesting another code.")
        user = (await db.execute(select(models.User).where(models.User.email == email))).scalar_one_or_none()
        if user:
            try:
                await issue_otp(email, redis, "reset")
            except HTTPException as exc:
                if exc.status_code != 503:
                    raise
        return {"message": "If this email has an account, a reset code will arrive shortly."}

    @app.post("/auth/password/reset", tags=["Auth"])
    async def reset_password(payload: PasswordReset, db=Depends(get_db), redis=Depends(get_redis)):
        email = payload.email.strip().lower()
        await consume_otp(email, payload.code, redis, "reset")
        user = (await db.execute(select(models.User).where(models.User.email == email).with_for_update())).scalar_one_or_none()
        if not user:
            raise HTTPException(400, "Code is invalid, expired or already used.")
        user.hashed_password = await security.hash_password_async(payload.new_password)
        ledger.audit(db, user.id, "auth.password_reset")
        user.token_version += 1
        await db.commit()
        return {"status": "updated"}

    @app.patch("/auth/profile", response_model=schemas.UserResponse, tags=["Auth"])
    async def update_profile(payload: ProfileUpdate, user=Depends(current_user_dependency), db=Depends(get_db)):
        locked = (await db.execute(select(models.User).where(models.User.id == user.id).with_for_update().execution_options(populate_existing=True))).scalar_one()
        guards.require_active(locked)
        ledger.audit(db, user.id, "profile.updated")
        locked.full_name = payload.full_name
        accounts = (await db.execute(select(models.Account).where(models.Account.user_id == user.id, models.Account.kind == "current").order_by(models.Account.id).with_for_update())).scalars().all()
        for account in accounts:
            account.owner_name = payload.full_name
        await db.commit()
        return locked

    @app.post("/auth/otp/send", response_model=schemas.OtpSendResponse, tags=["Auth"])
    async def send_otp(payload: schemas.OtpSendRequest, redis=Depends(get_redis), db=Depends(get_db)):
        email = payload.email.strip().lower()
        if (await db.execute(select(models.User.id).where(models.User.email == email))).first():
            raise HTTPException(409, "This email already has an account. Please sign in.")
        await issue_otp(email, redis)
        return {"status": "dispatched", "email": email, "expires_in": 600}

    @app.post("/auth/otp/verify", response_model=schemas.OtpVerifyResponse, tags=["Auth"])
    async def verify_otp(payload: schemas.OtpVerifyRequest, redis=Depends(get_redis), db=Depends(get_db)):
        email = payload.email.strip().lower()
        await consume_otp(email, payload.code, redis)
        user = models.User(email=email, full_name=payload.full_name.strip(), hashed_password=await security.hash_password_async(payload.password), role=models.UserRole.CUSTOMER, settings={"primary_currency": payload.primary_currency, "purpose": payload.purpose})
        db.add(user)
        try:
            await db.flush()
            for currency in CURRENCIES:
                db.add(models.Account(user_id=user.id, account_number=generate_iban(currency), owner_name=user.full_name, balance=0, currency=currency))
            await db.commit()
        except IntegrityError:
            await db.rollback()
            raise HTTPException(409, "This email already has an account. Please sign in.")
        return {"access_token": security.create_access_token(user.id, user.email, user.role.value, user.token_version), "user": user}

    @app.get("/recipients/resolve", tags=["Accounts"])
    async def recipient_lookup(identifier: str = Query(min_length=3, max_length=40), user=Depends(current_user_dependency), db=Depends(get_db)):
        clean = identifier.replace(" ", "").upper()
        query = select(models.Account).where(models.Account.account_number == clean, models.Account.kind == "current")
        if clean.startswith("VY-") and clean[3:].isdigit():
            query = select(models.Account).where(models.Account.id == int(clean[3:]), models.Account.kind == "current")
        account = (await db.execute(query)).scalar_one_or_none()
        if not account:
            raise HTTPException(404, "No Veyra account matches this IBAN or Veyra ID.")
        return {"id": account.id, "owner_name": account.owner_name, "currency": account.currency, "account_number": account.account_number}

    @app.patch("/auth/settings", tags=["Auth"])
    async def update_settings(payload: SettingsUpdate, user=Depends(current_user_dependency), db=Depends(get_db), redis=Depends(get_redis)):
        updates = payload.model_dump(exclude_none=True, exclude={"password", "code", "selected_account_id"})
        if "two_factor" in updates:
            if not payload.password or not await security.verify_password_async(payload.password, user.hashed_password):
                raise HTTPException(401, "Confirm your current password to change two-factor authentication.")
            if not payload.code:
                await issue_otp(user.email, redis, "settings")
                raise HTTPException(428, "A verification code has been sent. Enter it to confirm this change.")
            await consume_otp(user.email, payload.code, redis, "settings")
        avatar = updates.get("avatar", "")
        if avatar and avatar not in ("sage", "sand", "slate", "rose") and not avatar.startswith(("data:image/png;base64,", "data:image/jpeg;base64,", "data:image/webp;base64,")):
            raise HTTPException(422, "Choose a PNG, JPEG or WebP avatar.")
        # Row lock prevents unrelated preference updates from overwriting each other.
        locked = (await db.execute(select(models.User).where(models.User.id == user.id).with_for_update().execution_options(populate_existing=True))).scalar_one()
        guards.require_active(locked)
        if payload.selected_account_id is not None:
            account = (await db.execute(select(models.Account).where(models.Account.id == payload.selected_account_id, models.Account.user_id == user.id, models.Account.kind == "current"))).scalar_one_or_none()
            if not account:
                raise HTTPException(404, "Choose one of your current accounts.")
            updates["selected_accounts"] = {**locked.settings.get("selected_accounts", {}), account.currency: account.id}
        ledger.audit(db, user.id, "settings.updated", fields=list(updates))
        locked.settings = {**locked.settings, **updates}
        await db.commit()
        return locked.settings

    @app.post("/auth/password", tags=["Auth"])
    async def change_password(payload: PasswordChange, user=Depends(current_user_dependency), db=Depends(get_db)):
        locked = (await db.execute(select(models.User).where(models.User.id == user.id).with_for_update().execution_options(populate_existing=True))).scalar_one()
        guards.require_active(locked)
        if not await security.verify_password_async(payload.current_password, locked.hashed_password):
            raise HTTPException(401, "Your current password is incorrect.")
        locked.hashed_password = await security.hash_password_async(payload.new_password)
        ledger.audit(db, locked.id, "auth.sessions_revoked")
        locked.token_version += 1
        await db.commit()
        return {"access_token": security.create_access_token(locked.id, locked.email, locked.role.value, locked.token_version)}

    @app.post("/auth/sessions/revoke", tags=["Auth"])
    async def revoke_sessions(user=Depends(current_user_dependency), db=Depends(get_db)):
        locked = (await db.execute(select(models.User).where(models.User.id == user.id).with_for_update().execution_options(populate_existing=True))).scalar_one()
        guards.require_active(locked)
        ledger.audit(db, locked.id, "auth.sessions_revoked")
        locked.token_version += 1
        await db.commit()
        return {"status": "revoked"}

    @app.post("/fx/quote", tags=["Exchange"])
    async def quote_fx(payload: FxQuote, user=Depends(current_user_dependency), db=Depends(get_db), redis=Depends(get_redis)):
        guards.require_customer(user)
        accounts = (await db.execute(select(models.Account).where(models.Account.id.in_([payload.source_account_id, payload.destination_account_id]), models.Account.user_id == user.id, models.Account.kind == "current"))).scalars().all()
        if len(accounts) != 2:
            raise HTTPException(400, "Choose two of your currency accounts.")
        source = next(a for a in accounts if a.id == payload.source_account_id)
        destination = next(a for a in accounts if a.id == payload.destination_account_id)
        if source.currency == destination.currency:
            raise HTTPException(400, "Choose different currencies.")
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                response = await client.get("https://api.frankfurter.dev/v2/rates", params={"base": source.currency, "quotes": destination.currency})
                response.raise_for_status()
                rate_data = response.json()[0]
                rate = Decimal(str(rate_data["rate"]))
                if not rate.is_finite() or rate <= 0:
                    raise ValueError("Invalid exchange rate")
        except (httpx.HTTPError, KeyError, ValueError, IndexError):
            raise HTTPException(503, "Exchange rates are unavailable. Please try again later.")
        quote = {**payload.model_dump(), "user_id": user.id, "rate": str(rate), "rate_date": rate_data["date"], "received": int((Decimal(payload.amount) * rate).quantize(Decimal("1"), rounding=ROUND_HALF_UP)), "expires_in": 30}
        if quote["received"] < 1:
            raise HTTPException(400, "Amount is too small to exchange.")
        quote_id = uuid.uuid4().hex
        await redis.set(f"veyra:fx:{quote_id}", json.dumps(quote), ex=30)
        return {**quote, "quote_id": quote_id, "provider": "Frankfurter · daily reference rate", "fee": 0}

    @app.post("/fx/swap", tags=["Exchange"])
    async def swap_fx(payload: FxExecute, user=Depends(current_user_dependency), db=Depends(get_db), redis=Depends(get_redis)):
        guards.require_customer(user)
        idem = "fx:" + payload.quote_id
        existing = (await db.execute(select(models.Transaction).where(models.Transaction.idempotency_key == idem, models.Transaction.user_id == user.id))).scalar_one_or_none()
        if existing:
            return {"status": "COMPLETED", "transaction_id": existing.id}
        raw = await redis.get(f"veyra:fx:{payload.quote_id}")
        if not raw:
            raise HTTPException(409, "This quote has expired. Get a new quote.")
        quote = json.loads(raw)
        if quote["user_id"] != user.id:
            raise HTTPException(403, "This quote belongs to another account.")
        idem = "fx:" + payload.quote_id
        # An advisory transaction lock makes the quote idempotent across workers.
        from sqlalchemy import text
        await db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": idem})
        existing = (await db.execute(select(models.Transaction).where(models.Transaction.idempotency_key == idem))).scalar_one_or_none()
        if existing:
            return {"status": "COMPLETED", "transaction_id": existing.id}
        # Balanced journal entries in each currency, using shared clearing accounts.
        source_account = await db.get(models.Account, quote["source_account_id"])
        dest_account = await db.get(models.Account, quote["destination_account_id"])
        treasury_accounts = [await ledger.clearing_account(db, source_account.currency), await ledger.clearing_account(db, dest_account.currency)]
        ids = [quote["source_account_id"], quote["destination_account_id"]] + [a.id for a in treasury_accounts]
        accounts = (await db.execute(select(models.Account).where(models.Account.id.in_(ids)).order_by(models.Account.id).with_for_update().execution_options(populate_existing=True))).scalars().all()
        by_id = {a.id: a for a in accounts}
        source, dest = by_id[quote["source_account_id"]], by_id[quote["destination_account_id"]]
        if source.kind == "closed" or dest.kind == "closed":
            raise HTTPException(409, "Currency exchange is unavailable for closed accounts.")
        if source.balance < quote["amount"]:
            raise HTTPException(400, "Insufficient available balance.")
        clearing_source = next(a for a in accounts if a.kind == "clearing" and a.currency == source.currency)
        clearing_dest = next(a for a in accounts if a.kind == "clearing" and a.currency == dest.currency)
        tx = models.Transaction(user_id=user.id, kind="exchange", reference="Currency exchange", idempotency_key=idem, status=models.TransactionStatus.COMPLETED)
        db.add(tx)
        await db.flush()
        for account, amount, direction in [(source, quote["amount"], "DEBIT"), (clearing_source, quote["amount"], "CREDIT"), (clearing_dest, quote["received"], "DEBIT"), (dest, quote["received"], "CREDIT")]:
            account.balance += amount if direction == "CREDIT" else -amount
            db.add(models.LedgerEntry(transaction_id=tx.id, account_id=account.id, amount=amount, entry_type=models.EntryType(direction)))
        ledger.audit(db, user.id, "payment.exchange", transaction_id=tx.id)
        await db.commit()
        return {"status": "COMPLETED", "transaction_id": tx.id}
