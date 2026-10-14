from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field

# Schema for creating a new bank account
class AccountCreate(BaseModel):
    owner_name: str = Field(..., min_length=2, max_length=100, description="Full name of the account holder")
    initial_balance: int = Field(default=0, ge=0, description="Opening balance in cents (must be non-negative)")

# Response schema returned when reading an account
class AccountResponse(BaseModel):
    id: int
    account_number: str
    owner_name: str
    balance: int
    created_at: datetime

    # Enable ORM mode to serialize SQLAlchemy models directly into Pydantic models
    model_config = ConfigDict(from_attributes=True)

# Schema for initiating a funds transfer
class TransferRequest(BaseModel):
    source_account_id: int = Field(..., description="ID of the sender account")
    destination_account_id: int = Field(..., description="ID of the receiver account")
    amount: int = Field(..., gt=0, description="Transfer amount in cents (must be greater than 0)")
    idempotency_key: str = Field(..., min_length=10, max_length=64, description="Unique key to prevent duplicate transfers")

# Response schema returned after a transfer execution
class TransferResponse(BaseModel):
    transaction_id: int
    idempotency_key: str
    status: str
    message: str
    # Schema for individual ledger entry representation
class LedgerEntryResponse(BaseModel):
    id: int
    transaction_id: int
    amount: int
    entry_type: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

# Schema for the full account statement (audit log)
class AccountStatementResponse(BaseModel):
    account_id: int
    account_number: str
    current_balance: int
    entries: list[LedgerEntryResponse]