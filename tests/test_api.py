import pytest
import httpx
import uuid

BASE_URL = "http://127.0.0.1:8000"


async def create_authenticated_user(client: httpx.AsyncClient, role: str = "CUSTOMER") -> dict:
    """Helper function to register a user, login, and return auth headers + user info."""
    email = f"user_{uuid.uuid4().hex[:8]}@bank.de"
    password = "StrongPassword123!"
    reg_res = await client.post("/auth/register", json={
        "email": email,
        "full_name": "Test User",
        "password": password,
        "role": role
    })
    assert reg_res.status_code == 201

    login_res = await client.post("/auth/login", json={
        "email": email,
        "password": password
    })
    assert login_res.status_code == 200
    token = login_res.json()["access_token"]

    return {
        "user": reg_res.json(),
        "headers": {"Authorization": f"Bearer {token}"}
    }


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

        res_reg = await client.post("/auth/register", json=user_payload)
        assert res_reg.status_code == 201
        assert res_reg.json()["email"] == unique_email
        assert res_reg.json()["role"] == "CUSTOMER"

        res_dup = await client.post("/auth/register", json=user_payload)
        assert res_dup.status_code == 409

        res_login = await client.post("/auth/login", json={
            "email": unique_email,
            "password": "StrongPassword123!"
        })
        assert res_login.status_code == 200
        token = res_login.json()["access_token"]

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
        res_bad_login = await client.post("/auth/login", json={
            "email": "ghost@bank.de",
            "password": "WrongPassword123!"
        })
        assert res_bad_login.status_code == 401

        res_forged = await client.get(
            "/auth/me",
            headers={"Authorization": "Bearer invalid.forged.token"}
        )
        assert res_forged.status_code == 401


@pytest.mark.asyncio
async def test_create_and_fetch_account():
    """Verify authenticated account provisioning and /accounts/me listing."""
    async with httpx.AsyncClient(base_url=BASE_URL) as client:
        auth = await create_authenticated_user(client)

        res_create = await client.post(
            "/accounts",
            json={"owner_name": "Erdem Main Account", "initial_balance": 10000},
            headers=auth["headers"]
        )
        assert res_create.status_code == 201
        account_data = res_create.json()
        assert account_data["balance"] == 10000
        assert account_data["user_id"] == auth["user"]["id"]

        res_me_accounts = await client.get("/accounts/me", headers=auth["headers"])
        assert res_me_accounts.status_code == 200
        assert len(res_me_accounts.json()) == 1

        res_get = await client.get(f"/accounts/{account_data['id']}", headers=auth["headers"])
        assert res_get.status_code == 200
        assert res_get.json()["id"] == account_data["id"]


@pytest.mark.asyncio
async def test_successful_transfer_and_idempotency():
    """Verify atomic fund transfers and Redis fast-path idempotency."""
    async with httpx.AsyncClient(base_url=BASE_URL) as client:
        sender_auth = await create_authenticated_user(client)
        receiver_auth = await create_authenticated_user(client)

        acc1 = (await client.post(
            "/accounts",
            json={"owner_name": "Sender", "initial_balance": 20000},
            headers=sender_auth["headers"]
        )).json()
        acc2 = (await client.post(
            "/accounts",
            json={"owner_name": "Recipient", "initial_balance": 5000},
            headers=receiver_auth["headers"]
        )).json()

        idem_key = f"pytest-key-{uuid.uuid4().hex}"
        transfer_payload = {
            "source_account_id": acc1["id"],
            "destination_account_id": acc2["id"],
            "amount": 7500,
            "idempotency_key": idem_key
        }

        res_transfer = await client.post("/transfers", json=transfer_payload, headers=sender_auth["headers"])
        assert res_transfer.status_code == 200
        assert res_transfer.json()["status"] == "COMPLETED"

        res_duplicate = await client.post("/transfers", json=transfer_payload, headers=sender_auth["headers"])
        assert res_duplicate.status_code == 200
        assert "already processed" in res_duplicate.json()["message"]


@pytest.mark.asyncio
async def test_insufficient_funds_rejection():
    """Verify transactions are rejected when sender lacks necessary balance."""
    async with httpx.AsyncClient(base_url=BASE_URL) as client:
        sender_auth = await create_authenticated_user(client)
        receiver_auth = await create_authenticated_user(client)

        acc1 = (await client.post(
            "/accounts",
            json={"owner_name": "Poor Sender", "initial_balance": 1000},
            headers=sender_auth["headers"]
        )).json()
        acc2 = (await client.post(
            "/accounts",
            json={"owner_name": "Receiver", "initial_balance": 0},
            headers=receiver_auth["headers"]
        )).json()

        payload = {
            "source_account_id": acc1["id"],
            "destination_account_id": acc2["id"],
            "amount": 5000,
            "idempotency_key": f"pytest-overdraft-{uuid.uuid4().hex}"
        }

        res = await client.post("/transfers", json=payload, headers=sender_auth["headers"])
        assert res.status_code == 400
        assert "Insufficient funds" in res.json()["detail"]


@pytest.mark.asyncio
async def test_unauthorized_transfer_and_auditor_rbac():
    """
    Verify 403 Forbidden when a customer tries to steal funds or read another user's statement,
    and verify AUDITOR role can inspect statements but cannot initiate transfers.
    """
    async with httpx.AsyncClient(base_url=BASE_URL) as client:
        victim_auth = await create_authenticated_user(client, role="CUSTOMER")
        attacker_auth = await create_authenticated_user(client, role="CUSTOMER")
        auditor_auth = await create_authenticated_user(client, role="AUDITOR")

        victim_acc = (await client.post(
            "/accounts",
            json={"owner_name": "Victim Account", "initial_balance": 50000},
            headers=victim_auth["headers"]
        )).json()
        attacker_acc = (await client.post(
            "/accounts",
            json={"owner_name": "Attacker Account", "initial_balance": 0},
            headers=attacker_auth["headers"]
        )).json()

        # 1. Attacker attempts to transfer money out of Victim's account -> Expect 403 Forbidden
        steal_payload = {
            "source_account_id": victim_acc["id"],
            "destination_account_id": attacker_acc["id"],
            "amount": 10000,
            "idempotency_key": f"steal-attempt-{uuid.uuid4().hex}"
        }
        res_steal = await client.post("/transfers", json=steal_payload, headers=attacker_auth["headers"])
        assert res_steal.status_code == 403

        # 2. Attacker attempts to view Victim's account statement -> Expect 403 Forbidden
        res_spy = await client.get(f"/accounts/{victim_acc['id']}/statement", headers=attacker_auth["headers"])
        assert res_spy.status_code == 403

        # 3. AUDITOR inspects Victim's account statement -> Expect 200 OK
        res_audit = await client.get(f"/accounts/{victim_acc['id']}/statement", headers=auditor_auth["headers"])
        assert res_audit.status_code == 200
        assert res_audit.json()["current_balance"] == 50000

        # 4. AUDITOR attempts to transfer money from Victim's account -> Expect 403 Forbidden
        auditor_transfer_payload = {
            "source_account_id": victim_acc["id"],
            "destination_account_id": attacker_acc["id"],
            "amount": 1000,
            "idempotency_key": f"auditor-attempt-{uuid.uuid4().hex}"
        }
        res_auditor_tx = await client.post("/transfers", json=auditor_transfer_payload, headers=auditor_auth["headers"])
        assert res_auditor_tx.status_code == 403

@pytest.mark.asyncio
async def test_anti_fraud_aml_and_redis_rate_limiting():
    """
    Verify AML compliance blocks single transfers over 10,000 EUR (422)
    and Redis rate limiter blocks excessive transfer attempts (>10/min) with 429.
    """
    async with httpx.AsyncClient(base_url=BASE_URL) as client:
        sender_auth = await create_authenticated_user(client)
        receiver_auth = await create_authenticated_user(client)

        acc1 = (await client.post(
            "/accounts",
            json={"owner_name": "Whale Sender", "initial_balance": 5_000_000},
            headers=sender_auth["headers"]
        )).json()
        acc2 = (await client.post(
            "/accounts",
            json={"owner_name": "Receiver", "initial_balance": 0},
            headers=receiver_auth["headers"]
        )).json()

        # 1. Attempt single transfer of 15,000.00 EUR (1,500,000 cents) -> Expect 422 AML Alert (Attempt #1)
        aml_payload = {
            "source_account_id": acc1["id"],
            "destination_account_id": acc2["id"],
            "amount": 1_500_000,
            "idempotency_key": f"aml-test-{uuid.uuid4().hex}"
        }
        res_aml = await client.post("/transfers", json=aml_payload, headers=sender_auth["headers"])
        assert res_aml.status_code == 422
        assert "Anti-Fraud AML Alert" in res_aml.json()["detail"]

        # 2. Fire 9 valid small transfers (Attempts #2 through #10) -> Expect 200 OK
        for _ in range(9):
            small_payload = {
                "source_account_id": acc1["id"],
                "destination_account_id": acc2["id"],
                "amount": 100,
                "idempotency_key": f"rate-ok-{uuid.uuid4().hex}"
            }
            res_ok = await client.post("/transfers", json=small_payload, headers=sender_auth["headers"])
            assert res_ok.status_code == 200

        # 3. Fire the 11th transfer within the same minute -> Expect 429 Too Many Requests
        spam_payload = {
            "source_account_id": acc1["id"],
            "destination_account_id": acc2["id"],
            "amount": 100,
            "idempotency_key": f"rate-blocked-{uuid.uuid4().hex}"
        }
        res_rate_limit = await client.post("/transfers", json=spam_payload, headers=sender_auth["headers"])
        assert res_rate_limit.status_code == 429
        assert "Rate limit exceeded" in res_rate_limit.json()["detail"]

@pytest.mark.asyncio
async def test_anti_fraud_aml_and_redis_rate_limiting():
    """Verify AML blocks >10k EUR (422) and Redis rate limiter blocks >10 req/min (429)."""
    async with httpx.AsyncClient(base_url=BASE_URL) as client:
        sender_auth = await create_authenticated_user(client)
        receiver_auth = await create_authenticated_user(client)

        acc1 = (await client.post(
            "/accounts",
            json={"owner_name": "Whale Sender", "initial_balance": 5_000_000},
            headers=sender_auth["headers"]
        )).json()
        acc2 = (await client.post(
            "/accounts",
            json={"owner_name": "Receiver", "initial_balance": 0},
            headers=receiver_auth["headers"]
        )).json()

        # 1. 10.000 EUR üstü transfer denemesi -> 422 Beklenir
        res_aml = await client.post("/transfers", json={
            "source_account_id": acc1["id"],
            "destination_account_id": acc2["id"],
            "amount": 1_500_000,
            "idempotency_key": f"aml-{uuid.uuid4().hex}"
        }, headers=sender_auth["headers"])
        assert res_aml.status_code == 422

        # 2. 9 adet geçerli ufak transfer gönder (Sayaç: 2..10) -> 200 OK
        for _ in range(9):
            res_ok = await client.post("/transfers", json={
                "source_account_id": acc1["id"],
                "destination_account_id": acc2["id"],
                "amount": 100,
                "idempotency_key": f"rate-ok-{uuid.uuid4().hex}"
            }, headers=sender_auth["headers"])
            assert res_ok.status_code == 200

        # 3. Aynı dakika içindeki 11. transfer denemesi -> 429 Too Many Requests
        res_rate = await client.post("/transfers", json={
            "source_account_id": acc1["id"],
            "destination_account_id": acc2["id"],
            "amount": 100,
            "idempotency_key": f"rate-block-{uuid.uuid4().hex}"
        }, headers=sender_auth["headers"])
        assert res_rate.status_code == 429


@pytest.mark.asyncio
async def test_otp_send_does_not_expose_security_code():
    """OTP dispatch must never leak the code or email HTML through the public API."""
    async with httpx.AsyncClient(base_url=BASE_URL) as client:
        test_email = f"otp_client_{uuid.uuid4().hex[:8]}@veyra.com"

        # 1. Dispatch OTP
        res_send = await client.post("/auth/otp/send", json={"email": test_email})
        assert res_send.status_code in (200, 503)
        send_data = res_send.json()
        assert "dev_otp" not in send_data
        assert "html_preview" not in send_data
        if res_send.status_code == 200:
            assert send_data["status"] == "dispatched"
            assert send_data["expires_in"] == 600
        else:
            assert "unavailable" in send_data["detail"].lower()
        
