import pytest
import httpx
import uuid

BASE_URL = "http://127.0.0.1:8000"


@pytest.mark.asyncio
async def test_health_check():
    """Verify service uptime, health check response, and tracing headers."""
    async with httpx.AsyncClient(base_url=BASE_URL) as client:
        response = await client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "healthy", "service": "bank-core"}
        assert "x-request-id" in response.headers
        assert "x-process-time-ms" in response.headers


@pytest.mark.asyncio
async def test_user_registration_and_jwt_flow():
    """Verify Argon2 user registration, duplicate rejection, JWT login, and /auth/me protection."""
    async with httpx.AsyncClient(base_url=BASE_URL) as client:
        unique_email = f"user_{uuid.uuid4().hex[:8]}@bank.de"
        user_payload = {
            "email": unique_email,
            "full_name": "Erdem Test",
            "password": "StrongPassword123!"
        }

        # 1. Register a new user
        res_reg = await client.post("/auth/register", json=user_payload)
        assert res_reg.status_code == 201
        assert res_reg.json()["email"] == unique_email
        assert res_reg.json()["role"] == "CUSTOMER"

        # 2. Attempt duplicate registration with same email -> Expect 409 Conflict
        res_dup = await client.post("/auth/register", json=user_payload)
        assert res_dup.status_code == 409

        # 3. Login with valid credentials -> Expect JWT access token
        res_login = await client.post("/auth/login", json={
            "email": unique_email,
            "password": "StrongPassword123!"
        })
        assert res_login.status_code == 200
        token = res_login.json()["access_token"]
        assert token is not None

        # 4. Access protected /auth/me endpoint using Bearer token
        res_me = await client.get(
            "/auth/me",
            headers={"Authorization": f"Bearer {token}"}
        )
        assert res_me.status_code == 200
        assert res_me.json()["email"] == unique_email


@pytest.mark.asyncio
async def test_invalid_login_and_unauthorized_access():
    """Verify wrong password rejection (401) and missing token rejection."""
    async with httpx.AsyncClient(base_url=BASE_URL) as client:
        # 1. Login with non-existent account
        res_bad_login = await client.post("/auth/login", json={
            "email": "ghost@bank.de",
            "password": "WrongPassword123!"
        })
        assert res_bad_login.status_code == 401

        # 2. Call /auth/me with forged/invalid JWT token
        res_forged = await client.get(
            "/auth/me",
            headers={"Authorization": "Bearer invalid.forged.token"}
        )
        assert res_forged.status_code == 401


@pytest.mark.asyncio
async def test_create_and_fetch_account():
    """Verify account provisioning and balance initialization."""
    async with httpx.AsyncClient(base_url=BASE_URL) as client:
        create_payload = {
            "owner_name": "Test User",
            "initial_balance": 10000
        }
        res_create = await client.post("/accounts", json=create_payload)
        assert res_create.status_code == 201
        account_data = res_create.json()
        assert account_data["owner_name"] == "Test User"
        assert account_data["balance"] == 10000

        res_get = await client.get(f"/accounts/{account_data['id']}")
        assert res_get.status_code == 200
        assert res_get.json()["id"] == account_data["id"]


@pytest.mark.asyncio
async def test_successful_transfer_and_idempotency():
    """Verify atomic fund transfers and Redis fast-path idempotency."""
    async with httpx.AsyncClient(base_url=BASE_URL) as client:
        acc1 = (await client.post("/accounts", json={"owner_name": "Sender", "initial_balance": 20000})).json()
        acc2 = (await client.post("/accounts", json={"owner_name": "Recipient", "initial_balance": 5000})).json()

        idem_key = f"pytest-key-{uuid.uuid4().hex}"
        transfer_payload = {
            "source_account_id": acc1["id"],
            "destination_account_id": acc2["id"],
            "amount": 7500,
            "idempotency_key": idem_key
        }

        res_transfer = await client.post("/transfers", json=transfer_payload)
        assert res_transfer.status_code == 200
        assert res_transfer.json()["status"] == "COMPLETED"

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
            "amount": 5000,
            "idempotency_key": f"pytest-overdraft-{uuid.uuid4().hex}"
        }

        res = await client.post("/transfers", json=payload)
        assert res.status_code == 400
        assert "Insufficient funds" in res.json()["detail"]