import os
from datetime import datetime, timedelta, timezone
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
import jwt

# Configuration for JWT signing
SECRET_KEY = os.getenv("JWT_SECRET_KEY", "super-secret-bank-key-change-in-production-998877")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60

# Initialize Argon2id password hasher
ph = PasswordHasher()


def hash_password(plain_password: str) -> str:
    """Hashes a plaintext password using Argon2id."""
    return ph.hash(plain_password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verifies a plaintext password against an Argon2id hash."""
    try:
        return ph.verify(hashed_password, plain_password)
    except VerifyMismatchError:
        return False


def create_access_token(user_id: int, email: str, role: str, version: int = 0) -> str:
    """Generates a cryptographically signed JWT access token."""
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {
        "sub": str(user_id),
        "email": email,
        "role": role,
        "ver": version,
        "exp": expire
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict:
    """Decodes and validates a JWT access token."""
    return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
