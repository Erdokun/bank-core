import redis.asyncio as aioredis

REDIS_URL = "redis://localhost:6379/0"

# Async Redis client instance
redis_client = aioredis.from_url(
    REDIS_URL,
    encoding="utf-8",
    decode_responses=True
)

async def get_redis():
    """
    Dependency provider for FastAPI routes to access Redis.
    """
    return redis_client