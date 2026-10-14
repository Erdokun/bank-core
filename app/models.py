from datetime import datetime
from sqlalchemy import BigInteger, String, DateTime, ForeignKey, Enum as SQLEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
import enum

from app.database import Base

class TransactionStatus(str, enum.Enum):
    PENDING = "PENDING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"

class EntryType(str, enum.Enum):
    DEBIT = "DEBIT"    # Para çıkışı
    CREDIT = "CREDIT"  # Para girişi

class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    account_number: Mapped[str] = mapped_column(String(34), unique=True, index=True)
    owner_name: Mapped[str] = mapped_column(String(100))
    # Para cent/kuruş cinsinden BigInteger olarak saklanır
    balance: Mapped[int] = mapped_column(BigInteger, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    ledger_entries: Mapped[list["LedgerEntry"]] = relationship(back_populates="account")

class Transaction(Base):
    __tablename__ = "transactions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    # Aynı isteğin iki kez işlenmesini önleyen benzersiz anahtar
    idempotency_key: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    status: Mapped[TransactionStatus] = mapped_column(
        SQLEnum(TransactionStatus), default=TransactionStatus.PENDING
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    entries: Mapped[list["LedgerEntry"]] = relationship(back_populates="transaction")

class LedgerEntry(Base):
    """
    Çift taraflı muhasebe defteri (Double-Entry Bookkeeping).
    Bir transferde en az iki kayıt oluşur: bir hesaptan DEBIT, diğer hesaba CREDIT.
    """
    __tablename__ = "ledger_entries"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    transaction_id: Mapped[int] = mapped_column(ForeignKey("transactions.id"), index=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), index=True)
    amount: Mapped[int] = mapped_column(BigInteger)  # Pozitif cent değeri
    entry_type: Mapped[EntryType] = mapped_column(SQLEnum(EntryType))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    transaction: Mapped["Transaction"] = relationship(back_populates="entries")
    account: Mapped["Account"] = relationship(back_populates="ledger_entries")