"""Independent, restart-safe scheduler process; API reloads do not stop it."""
import asyncio
import logging
import os
from datetime import datetime, timezone
from app.operations import process_due_payments
from app.database import engine
from app.redis_client import redis_client

log = logging.getLogger("veyra-worker")


async def run():
    key = "veyra:worker:" + os.getenv("HOSTNAME", "local") + ":heartbeat"
    try:
        while True:
            try:
                await process_due_payments()
                now = datetime.now(timezone.utc).isoformat()
                async with redis_client.pipeline(transaction=True) as pipe:
                    await pipe.set(key, now, ex=45).set("veyra:worker:heartbeat", now, ex=45).execute()
            except Exception:
                log.exception("scheduler_poll_failed")
            await asyncio.sleep(10)
    finally:
        await redis_client.delete(key)
        await redis_client.aclose()
        await engine.dispose()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(run())
