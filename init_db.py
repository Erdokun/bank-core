import asyncio
from database import engine, Base
import models  # Modelleri Base'e tanıtmak için import ediyoruz

async def init_tables():
    print("Tablolar oluşturuluyor...")
    async with engine.begin() as conn:
        # Tabloları veritabanında fiziksel olarak yaratır
        await conn.run_sync(Base.metadata.create_all)
    print("Tüm banka tabloları başarıyla oluşturuldu!")

if __name__ == "__main__":
    asyncio.run(init_tables())