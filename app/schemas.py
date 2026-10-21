from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, Field, ConfigDict
from app.models import UserRole


class AccountCreate(BaseModel):
    owner_name: Optional[str] = Field(default=None, max_length=100, examples=["Erdem Celik"])
    initial_balance: int = Field(default=0, ge=0, description="Initial balance in cents (e.g., 10000 = 100.00 EUR)")


class AccountResponse(BaseModel):
    id: int
    user_id: int
    account_number: str
    owner_name: str
    balance: int
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
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class LoginRequest(BaseModel):
    email: str = Field(..., examples=["erdem@bank.de"])
    password: str = Field(..., examples=["StrongPass123!"])


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class OtpSendRequest(BaseModel):
    email: str = Field(..., examples=["user@veyra.com"])


class OtpSendResponse(BaseModel):
    status: str
    email: str
    expires_in: int = 300
    dev_otp: Optional[str] = None
    html_preview: Optional[str] = None


class OtpVerifyRequest(BaseModel):
    email: str
    code: str = Field(..., min_length=6, max_length=6, examples=["849201"])
    password: Optional[str] = None
    full_name: Optional[str] = None


class OtpVerifyResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse