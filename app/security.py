import os
from datetime import datetime, timedelta, timezone
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError, InvalidHashError
import secrets
import jwt

# Configuration for JWT signing
SECRET_KEY = os.getenv("JWT_SECRET_KEY") or secrets.token_urlsafe(48)
if os.getenv("APP_ENV") == "production" and (len(os.getenv("JWT_SECRET_KEY", "")) < 32 or SECRET_KEY.startswith(("development-", "replace-"))):
    raise RuntimeError("Production requires a JWT_SECRET_KEY of at least 32 characters.")
if os.getenv("APP_ENV") == "production" and os.getenv("BANK_SANDBOX", "false").lower() == "true":
    raise RuntimeError("Sandbox funding must be disabled in production.")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60

# Initialize Argon2id password hasher
ph = PasswordHasher()
DUMMY_PASSWORD_HASH = ph.hash(secrets.token_urlsafe(32))

# Bound Argon2 memory/CPU work while keeping the event loop responsive.
import asyncio
password_workers = asyncio.Semaphore(4)


def hash_password(plain_password: str) -> str:
    """Hashes a plaintext password using Argon2id."""
    return ph.hash(plain_password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verifies a plaintext password against an Argon2id hash."""
    try:
        return ph.verify(hashed_password, plain_password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def create_access_token(user_id: int, email: str, role: str, version: int = 0) -> str:
    """Generates a cryptographically signed JWT access token."""
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {
        "sub": str(user_id),
        "email": email,
        "role": role,
        "ver": version,
        "iat": datetime.now(timezone.utc),
        "jti": secrets.token_hex(16),
        "iss": "bank-core",
        "exp": expire
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict:
    """Decodes and validates a JWT access token."""
    return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM], issuer="bank-core", options={"require": ["sub", "exp", "iat", "jti", "iss", "ver"]})


async def hash_password_async(password):
    import asyncio
    async with password_workers:
        return await asyncio.to_thread(hash_password, password)


async def verify_password_async(password, hashed):
    import asyncio
    async with password_workers:
        return await asyncio.to_thread(verify_password, password, hashed)
