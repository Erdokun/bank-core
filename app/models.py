import enum
from datetime import datetime, timezone
from sqlalchemy import String, BigInteger, DateTime, ForeignKey, Enum, func, JSON, Integer
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class TransactionStatus(str, enum.Enum):
    PENDING = "PENDING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class EntryType(str, enum.Enum):
    DEBIT = "DEBIT"
    CREDIT = "CREDIT"


class UserRole(str, enum.Enum):
    CUSTOMER = "CUSTOMER"
    AUDITOR = "AUDITOR"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    full_name: Mapped[str] = mapped_column(String(100), nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    settings: Mapped[dict] = mapped_column(JSON, default=dict, server_default="{}", nullable=False)
    token_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    role: Mapped[UserRole] = mapped_column(
        Enum(UserRole),
        default=UserRole.CUSTOMER,
        nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        server_default=func.now()
    )


class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    account_number: Mapped[str] = mapped_column(String(34), unique=True, index=True, nullable=False)
    owner_name: Mapped[str] = mapped_column(String(100), nullable=False)
    balance: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="EUR", server_default="EUR", nullable=False)
    kind: Mapped[str] = mapped_column(String(16), default="current", server_default="current", nullable=False)
    goal: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        server_default=func.now()
    )


class Transaction(Base):
    __tablename__ = "transactions"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    idempotency_key: Mapped[str] = mapped_column(String(100), unique=True, index=True, nullable=False)
    status: Mapped[TransactionStatus] = mapped_column(
        Enum(TransactionStatus),
        default=TransactionStatus.PENDING,
        nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        server_default=func.now()
    )


class LedgerEntry(Base):
    __tablename__ = "ledger_entries"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    transaction_id: Mapped[int] = mapped_column(ForeignKey("transactions.id"), index=True, nullable=False)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), index=True, nullable=False)
    amount: Mapped[int] = mapped_column(BigInteger, nullable=False)
    entry_type: Mapped[EntryType] = mapped_column(Enum(EntryType), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        server_default=func.now()
    )
