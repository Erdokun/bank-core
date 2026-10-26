from datetime import datetime
from typing import List, Optional, Literal
from pydantic import BaseModel, Field, ConfigDict
from app.models import UserRole


class AccountCreate(BaseModel):
    owner_name: Optional[str] = Field(default=None, max_length=100, examples=["Erdem Celik"])
    initial_balance: int = Field(default=0, ge=0, description="Initial balance in cents (e.g., 10000 = 100.00 EUR)")
    currency: Literal["EUR", "TRY", "USD", "GBP"] = "EUR"
    kind: Literal["current", "space"] = "current"
    goal: int = Field(default=0, ge=0)


class AccountResponse(BaseModel):
    id: int
    user_id: int
    account_number: str
    owner_name: str
    balance: int
    currency: str = "EUR"
    kind: str = "current"
    goal: int = 0
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class TransferRequest(BaseModel):
    source_account_id: int = Field(..., gt=0)
    destination_account_id: int = Field(..., gt=0)
    amount: int = Field(..., gt=0, description="Transfer amount in cents (must be positive)")
    idempotency_key: str = Field(..., min_length=5, max_length=100)


class TransferResponse(BaseModel):
    transaction_id: int
    idempotency_key: str
    status: str
    message: str


class LedgerEntryResponse(BaseModel):
    id: int
    transaction_id: int
    amount: int
    entry_type: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AccountStatementResponse(BaseModel):
    account_id: int
    account_number: str
    current_balance: int
    entries: List[LedgerEntryResponse]


class UserCreate(BaseModel):
    email: str = Field(..., min_length=5, max_length=255, examples=["erdem@bank.de"])
    full_name: str = Field(..., min_length=2, max_length=100, examples=["Erdem Celik"])
    password: str = Field(..., min_length=8, max_length=128, examples=["StrongPass123!"])
    role: UserRole = Field(default=UserRole.CUSTOMER, examples=["CUSTOMER"])


class UserResponse(BaseModel):
    id: int
    email: str
    full_name: str
    role: str
    settings: dict = Field(default_factory=dict)
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class LoginRequest(BaseModel):
    email: str = Field(..., examples=["erdem@bank.de"])
    password: str = Field(..., examples=["StrongPass123!"])
    code: Optional[str] = Field(default=None, pattern=r"^\d{6}$")


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class OtpSendRequest(BaseModel):
    email: str = Field(..., min_length=5, max_length=255, pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


class OtpSendResponse(BaseModel):
    status: str
    email: str
    expires_in: int = 600


class OtpVerifyRequest(BaseModel):
    email: str
    code: str = Field(..., pattern=r"^\d{6}$")
    password: str = Field(..., min_length=8, max_length=128)
    full_name: str = Field(..., min_length=2, max_length=100)
    primary_currency: Literal["EUR", "TRY", "USD", "GBP"] = "EUR"
    purpose: str = Field(default="Personal Daily Banking", max_length=100)


class OtpVerifyResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse