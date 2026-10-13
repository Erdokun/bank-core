from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase

# Docker'da tanımladığımız kullanıcı adı, şifre ve port bilgileri
DATABASE_URL = "postgresql+asyncpg://bank_user:bank_password123@localhost:5432/bank_db"

# Asenkron veritabanı motoru (echo=True SQL sorgularını terminalde gösterir)
engine = create_async_engine(DATABASE_URL, echo=True)

# Her API isteği için bağımsız bir veritabanı oturumu açan fabrika
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False
)

# Tüm tablolarımızın türeyeceği temel sınıf
class Base(DeclarativeBase):
    pass

# FastAPI endpoint'lerine veritabanı oturumu aktaran bağımlılık (Dependency)
async def get_db():
    async with AsyncSessionLocal() as session:
        yield session