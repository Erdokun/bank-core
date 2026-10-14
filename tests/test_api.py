import pytest
import httpx
import uuid

BASE_URL = "http://127.0.0.1:8000"

@pytest.mark.asyncio
async def test_health_check():
    """Verify service uptime and health check response."""
    async with httpx.AsyncClient(base_url=BASE_URL) as client:
        response = await client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "healthy", "service": "bank-core"}

@pytest.mark.asyncio
async def test_create_and_fetch_account():
    """Verify account provisioning and balance initialization."""
    async with httpx.AsyncClient(base_url=BASE_URL) as client:
        create_payload = {
            "owner_name": "Test User",
            "initial_balance": 10000  # 100.00 EUR
        }
        res_create = await client.post("/accounts", json=create_payload)
        assert res_create.status_code == 201
        account_data = res_create.json()
        assert account_data["owner_name"] == "Test User"
        assert account_data["balance"] == 10000

        # Fetch newly created account by ID
        res_get = await client.get(f"/accounts/{account_data['id']}")
        assert res_get.status_code == 200
        assert res_get.json()["id"] == account_data["id"]

@pytest.mark.asyncio
async def test_successful_transfer_and_idempotency():
    """Verify atomic fund transfers and Redis fast-path idempotency."""
    async with httpx.AsyncClient(base_url=BASE_URL) as client:
        # 1. Provision sender and recipient accounts
        acc1 = (await client.post("/accounts", json={"owner_name": "Sender", "initial_balance": 20000})).json()
        acc2 = (await client.post("/accounts", json={"owner_name": "Recipient", "initial_balance": 5000})).json()

        idem_key = f"pytest-key-{uuid.uuid4().hex}"
        transfer_payload = {
            "source_account_id": acc1["id"],
            "destination_account_id": acc2["id"],
            "amount": 7500,  # 75.00 EUR
            "idempotency_key": idem_key
        }

        # 2. First transfer attempt: expect HTTP 200
        res_transfer = await client.post("/transfers", json=transfer_payload)
        assert res_transfer.status_code == 200
        assert res_transfer.json()["status"] == "COMPLETED"

        # 3. Second transfer attempt with same key: expect idempotent handling
        res_duplicate = await client.post("/transfers", json=transfer_payload)
        assert res_duplicate.status_code == 200
        assert "already processed" in res_duplicate.json()["message"]

@pytest.mark.asyncio
async def test_insufficient_funds_rejection():
    """Verify transactions are rejected when sender lacks necessary balance."""
    async with httpx.AsyncClient(base_url=BASE_URL) as client:
        acc1 = (await client.post("/accounts", json={"owner_name": "Poor Sender", "initial_balance": 1000})).json()
        acc2 = (await client.post("/accounts", json={"owner_name": "Receiver", "initial_balance": 0})).json()

        payload = {
            "source_account_id": acc1["id"],
            "destination_account_id": acc2["id"],
            "amount": 5000,  # Attempting to send more than available balance
            "idempotency_key": f"pytest-overdraft-{uuid.uuid4().hex}"
        }

        res = await client.post("/transfers", json=payload)
        assert res.status_code == 400
        assert "Insufficient funds" in res.json()["detail"]