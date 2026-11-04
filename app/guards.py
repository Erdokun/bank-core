from fastapi import HTTPException, status
import redis.asyncio as aioredis

RATE_LIMIT_MAX_REQUESTS = 10
RATE_LIMIT_WINDOW_SECONDS = 60
AML_MAX_SINGLE_TRANSFER_CENTS = 1_000_000  # 10,000 settlement-currency units


async def check_transfer_rate_limit(user_id: int, redis: aioredis.Redis, operation: str = "transfers") -> None:
    redis_key = f"ratelimit:{operation}:user:{user_id}"
    current_count = await redis.eval("""
        local n = redis.call('INCR', KEYS[1])
        if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
        return n
    """, 1, redis_key, RATE_LIMIT_WINDOW_SECONDS)

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
            detail="Single transfers are limited to 10,000 units of the settlement currency."
        )

def require_customer(user):
    from app.models import UserRole
    if user.role != UserRole.CUSTOMER:
        raise HTTPException(403, "Auditor accounts have read-only access to banking operations.")
