from fastapi import HTTPException, status
import redis.asyncio as aioredis

RATE_LIMIT_MAX_REQUESTS = 10
RATE_LIMIT_WINDOW_SECONDS = 60
AML_MAX_SINGLE_TRANSFER_CENTS = 1_000_000  # 10,000.00 EUR


async def check_transfer_rate_limit(user_id: int, redis: aioredis.Redis) -> None:
    redis_key = f"ratelimit:transfers:user:{user_id}"
    current_count = await redis.incr(redis_key)
    if current_count == 1:
        await redis.expire(redis_key, RATE_LIMIT_WINDOW_SECONDS)

    if current_count > RATE_LIMIT_MAX_REQUESTS:
        ttl = await redis.ttl(redis_key)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Rate limit exceeded: Maximum {RATE_LIMIT_MAX_REQUESTS} transfer attempts per minute. Try again in {max(ttl, 1)}s."
        )


def evaluate_anti_fraud_rules(amount_cents: int) -> None:
    if amount_cents > AML_MAX_SINGLE_TRANSFER_CENTS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Anti-Fraud AML Alert: Single transfers exceeding 10,000.00 EUR are blocked pending compliance review."
        )