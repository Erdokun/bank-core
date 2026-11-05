import os
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase

# Read database URL from environment variable, fallback to localhost for local dev
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://bank_user:bank_password123@localhost:5432/bank_db"
)

# Async database engine
engine = create_async_engine(DATABASE_URL, echo=False, pool_pre_ping=True, pool_size=10, max_overflow=20, pool_timeout=15, pool_recycle=1800)

# Session factory for handling requests
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False
)

# Declarative base class for models
class Base(DeclarativeBase):
    pass

# Dependency provider for FastAPI routes
async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
