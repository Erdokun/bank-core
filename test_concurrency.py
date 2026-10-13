import asyncio
import httpx
import uuid

BASE_URL = "http://127.0.0.1:8000"

async def fire_transfer(client: httpx.AsyncClient, request_id: int):
    """
    Sends a single transfer request to the API concurrently.
    """
    payload = {
        "source_account_id": 1,
        "destination_account_id": 2,
        "amount": 5000,  # 50.00 EUR per attempt
        "idempotency_key": f"stress-test-{uuid.uuid4().hex}"
    }

    try:
        response = await client.post(f"{BASE_URL}/transfers", json=payload, timeout=10.0)
        return request_id, response.status_code, response.json()
    except Exception as exc:
        return request_id, 500, str(exc)

async def run_stress_test():
    """
    Dispatches 10 simultaneous transfer requests to stress-test race conditions.
    """
    print("\n--- Starting High-Concurrency Transfer Stress Test ---")
    print("Account 1 Balance: 35,000 cents (350 EUR)")
    print("Firing 10 concurrent requests of 5,000 cents each (Total requested: 50,000 cents)...\n")

    async with httpx.AsyncClient() as client:
        # Create 10 concurrent asynchronous transfer tasks
        tasks = [fire_transfer(client, i + 1) for i in range(10)]
        
        # Fire all 10 requests at the exact same millisecond
        results = await asyncio.gather(*tasks)

    success_count = 0
    failure_count = 0

    for req_id, status_code, body in sorted(results, key=lambda x: x[0]):
        if status_code == 200:
            success_count += 1
            print(f"[SUCCESS] Request #{req_id}: Status 200 - Transferred 5,000 cents successfully.")
        else:
            failure_count += 1
            detail = body.get("detail", "Error") if isinstance(body, dict) else body
            print(f"[REJECTED] Request #{req_id}: Status {status_code} - Reason: {detail}")

    print("\n--- Stress Test Summary ---")
    print(f"Total Requests Processed : 10")
    print(f"Successful Transfers     : {success_count} (Expected: 7)")
    print(f"Rejected Requests        : {failure_count} (Expected: 3)")

    # Fetch final balance of Account 1 to prove data consistency
    async with httpx.AsyncClient() as client:
        res = await client.get(f"{BASE_URL}/accounts/1")
        final_balance = res.json().get("balance")
        print(f"Final Balance of Account 1: {final_balance} cents (Expected: 0 cents)")

    if success_count == 7 and final_balance == 0:
        print("\nPASSED: Zero race conditions detected. Pessimistic locking verified.")
    else:
        print("\nFAILED: Inconsistent state detected.")

if __name__ == "__main__":
    asyncio.run(run_stress_test())