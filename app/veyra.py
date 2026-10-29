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
import smtplib
import ssl
import uuid
from typing import Literal
from decimal import Decimal, ROUND_HALF_UP
from email.message import EmailMessage

import httpx
from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from app import models, schemas, security
from app.database import get_db
from app.redis_client import get_redis

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
    copy_url = app_url + "/"
    title = {"reset": "Reset your Veyra password", "login": "Confirm your sign-in", "settings": "Confirm your security change"}.get(purpose, "Verify your email address")
    instruction = {"reset": "Use this code to reset your Veyra password. If you did not request this, ignore this email.", "login": "Use this code to finish signing in to Veyra.", "settings": "Use this code to confirm a change to your Veyra security settings."}.get(purpose, "Use this code to verify your email address and activate your Veyra account.")
    return f'''<!doctype html><html lang="en"><body style="margin:0;background:#f4f5f7;padding:40px 16px;font-family:Arial,sans-serif;color:#17212a">
    <table role="presentation" style="max-width:520px;margin:auto;background:white;border-radius:16px;padding:40px;width:100%"><tr><td>
    <div style="font-size:30px;letter-spacing:-1px;margin-bottom:38px"><b>Ⅴ</b> Veyra</div>
    <h1 style="font-size:25px">{title}</h1><p style="line-height:1.8;color:#5b626c">Hello,<br>{instruction}</p>
    <div style="font-family:monospace;font-size:38px;letter-spacing:8px;text-align:center;padding:28px 5px;background:#f6f7f9;border:1px solid #e6e8ec;border-radius:10px;user-select:all">{' '.join(code)}</div>
    <p style="text-align:center;margin:26px"><a href="{copy_url}" style="display:inline-block;padding:13px 26px;background:#15271f;color:white;text-decoration:none;border-radius:8px">Open Veyra</a></p>
    <p style="font-size:12px;color:#757c84;text-align:center">Enter this code in Veyra. You can select and copy the code above.</p>
    <p style="font-size:13px;color:#5b626c">Note: This code will expire in 10 minutes.</p><p style="font-size:12px;color:#8c929a;line-height:1.7;margin-top:30px">If you did not request this code, you can ignore this email.<br><br>Veyra · Private Wealth &amp; Digital Ledger<br>Berlin, Germany<br>This is an automated email. Please do not reply.</p>
    </td></tr></table></body></html>'''


async def send_otp_email_smtp(email, code, purpose="register"):
    def dispatch():
        host = os.getenv("SMTP_HOST", "")
        if not host:
            raise RuntimeError("SMTP_HOST is not configured")
        message = EmailMessage()
        message["Subject"] = {"reset": "Reset your Veyra password", "login": "Your Veyra sign-in code", "settings": "Confirm your Veyra security change"}.get(purpose, "Your Veyra verification code")
        message["From"] = "Veyra <no-reply@veyra.com>"
        message["To"] = email
        message.set_content(f"{message['Subject']}\n\nYour one-time code: {code}\n\nThis code expires in 10 minutes. If you did not request it, ignore this email.\nVeyra")
        message.add_alternative(generate_veyra_otp_email_html(code, purpose), subtype="html")
        use_ssl = os.getenv("SMTP_SSL", "false").lower() == "true"
        port = int(os.getenv("SMTP_PORT", "465" if use_ssl else "587"))
        factory = smtplib.SMTP_SSL if use_ssl else smtplib.SMTP
        with factory(host, port, timeout=12) as server:
            if not use_ssl and os.getenv("SMTP_TLS", "true").lower() == "true":
                server.starttls(context=ssl.create_default_context())
            if os.getenv("SMTP_USER"):
                server.login(os.environ["SMTP_USER"], os.getenv("SMTP_PASSWORD", ""))
            server.send_message(message)
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


class ResetRequest(schemas.OtpSendRequest):
    pass


class PasswordReset(ResetRequest):
    code: str = Field(pattern=r"^\d{6}$")
    new_password: str = Field(min_length=8, max_length=128)


class FxQuote(BaseModel):
    source_account_id: int = Field(gt=0)
    destination_account_id: int = Field(gt=0)
    amount: int = Field(gt=0, le=1000000)


class FxExecute(BaseModel):
    quote_id: str


def register_veyra_routes(app, current_user_dependency):
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
        user.hashed_password = security.hash_password(payload.new_password)
        user.token_version += 1
        await db.commit()
        return {"status": "updated"}

    @app.patch("/auth/profile", response_model=schemas.UserResponse, tags=["Auth"])
    async def update_profile(payload: ProfileUpdate, user=Depends(current_user_dependency), db=Depends(get_db)):
        locked = (await db.execute(select(models.User).where(models.User.id == user.id).with_for_update().execution_options(populate_existing=True))).scalar_one()
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
        user = models.User(email=email, full_name=payload.full_name, hashed_password=security.hash_password(payload.password), role=models.UserRole.CUSTOMER, settings={"primary_currency": payload.primary_currency, "purpose": payload.purpose})
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
        updates = payload.model_dump(exclude_none=True, exclude={"password", "code"})
        if "two_factor" in updates:
            if not payload.password or not security.verify_password(payload.password, user.hashed_password):
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
        locked.settings = {**locked.settings, **updates}
        await db.commit()
        return locked.settings

    @app.post("/auth/password", tags=["Auth"])
    async def change_password(payload: PasswordChange, user=Depends(current_user_dependency), db=Depends(get_db)):
        locked = (await db.execute(select(models.User).where(models.User.id == user.id).with_for_update().execution_options(populate_existing=True))).scalar_one()
        if not security.verify_password(payload.current_password, locked.hashed_password):
            raise HTTPException(401, "Your current password is incorrect.")
        locked.hashed_password = security.hash_password(payload.new_password)
        locked.token_version += 1
        await db.commit()
        return {"access_token": security.create_access_token(locked.id, locked.email, locked.role.value, locked.token_version)}

    @app.post("/auth/sessions/revoke", tags=["Auth"])
    async def revoke_sessions(user=Depends(current_user_dependency), db=Depends(get_db)):
        locked = (await db.execute(select(models.User).where(models.User.id == user.id).with_for_update().execution_options(populate_existing=True))).scalar_one()
        locked.token_version += 1
        await db.commit()
        return {"status": "revoked"}

    @app.post("/fx/quote", tags=["Exchange"])
    async def quote_fx(payload: FxQuote, user=Depends(current_user_dependency), db=Depends(get_db), redis=Depends(get_redis)):
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
        # Treasury accounts preserve a balanced journal in each settlement currency.
        treasury = (await db.execute(select(models.User).where(models.User.email == "treasury@internal.veyra.invalid"))).scalar_one_or_none()
        if not treasury:
            await db.execute(text("SELECT pg_advisory_xact_lock(82764001)"))
            treasury = (await db.execute(select(models.User).where(models.User.email == "treasury@internal.veyra.invalid"))).scalar_one_or_none()
            if not treasury:
                treasury = models.User(email="treasury@internal.veyra.invalid", full_name="Veyra FX Clearing", hashed_password=security.hash_password(secrets.token_urlsafe(48)), role=models.UserRole.CUSTOMER)
                db.add(treasury)
                await db.flush()
                for currency in CURRENCIES:
                    db.add(models.Account(user_id=treasury.id, account_number=generate_iban(currency), owner_name="FX clearing", currency=currency, kind="clearing", balance=0))
                await db.flush()
        treasury_accounts = (await db.execute(select(models.Account).where(models.Account.user_id == treasury.id))).scalars().all()
        ids = [quote["source_account_id"], quote["destination_account_id"]] + [a.id for a in treasury_accounts]
        accounts = (await db.execute(select(models.Account).where(models.Account.id.in_(ids)).order_by(models.Account.id).with_for_update().execution_options(populate_existing=True))).scalars().all()
        by_id = {a.id: a for a in accounts}
        source, dest = by_id[quote["source_account_id"]], by_id[quote["destination_account_id"]]
        if source.balance < quote["amount"]:
            raise HTTPException(400, "Insufficient available balance.")
        clearing_source = next(a for a in accounts if a.user_id == treasury.id and a.currency == source.currency)
        clearing_dest = next(a for a in accounts if a.user_id == treasury.id and a.currency == dest.currency)
        tx = models.Transaction(idempotency_key=idem, status=models.TransactionStatus.COMPLETED)
        db.add(tx)
        await db.flush()
        for account, amount, direction in [(source, quote["amount"], "DEBIT"), (clearing_source, quote["amount"], "CREDIT"), (clearing_dest, quote["received"], "DEBIT"), (dest, quote["received"], "CREDIT")]:
            account.balance += amount if direction == "CREDIT" else -amount
            db.add(models.LedgerEntry(transaction_id=tx.id, account_id=account.id, amount=amount, entry_type=models.EntryType(direction)))
        await db.commit()
        return {"status": "COMPLETED", "transaction_id": tx.id}
