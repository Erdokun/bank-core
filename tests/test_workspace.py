"""Workspace persistence and sign-in regression checks against the local API."""
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import HTTPException

BASE_URL = "http://127.0.0.1:8000"


async def identity(client):
    email = f"workspace_{uuid.uuid4().hex}@example.com"
    password = "OriginalPassword123!"
    response = await client.post("/auth/register", json={"email": email, "full_name": "Workspace Test", "password": password})
    assert response.status_code == 201
    login = await client.post("/auth/login", json={"email": email, "password": password})
    assert login.status_code == 200
    return email, password, {"Authorization": "Bearer " + login.json()["access_token"]}


@pytest.mark.asyncio
async def test_profile_updates_account_holder_but_preserves_savings_names():
    async with httpx.AsyncClient(base_url=BASE_URL) as client:
        _, _, headers = await identity(client)
        for kind, name in [("current", "Workspace Test"), ("space", "My next home")]:
            created = await client.post("/accounts", headers=headers, json={"kind": kind, "owner_name": name})
            assert created.status_code == 201
        changed = await client.patch("/auth/profile", headers=headers, json={"full_name": "Updated Person"})
        assert changed.status_code == 200
        assert changed.json()["full_name"] == "Updated Person"
        accounts = (await client.get("/accounts/me", headers=headers)).json()
        assert next(a for a in accounts if a["kind"] == "current")["owner_name"] == "Updated Person"
        assert next(a for a in accounts if a["kind"] == "space")["owner_name"] == "My next home"
        assert (await client.patch("/auth/profile", headers=headers, json={"full_name": "  "})).status_code == 422
        assert (await client.patch("/auth/profile", json={"full_name": "Unauthorized"})).status_code in (401, 403)


@pytest.mark.asyncio
async def test_preferences_validate_and_persist_without_losing_other_settings():
    async with httpx.AsyncClient(base_url=BASE_URL) as client:
        _, _, headers = await identity(client)
        prefs = {"theme": "light", "primary_currency": "USD", "hide_balances": True, "compact_activity": True, "idle_timeout": 30, "monthly_budget": 75000, "daily_limit": 100000, "atm_limit": 20000}
        response = await client.patch("/auth/settings", headers=headers, json=prefs)
        assert response.status_code == 200
        assert all(response.json()[key] == value for key, value in prefs.items())
        await client.patch("/auth/settings", headers=headers, json={"theme": "dark"})
        saved = (await client.get("/auth/me", headers=headers)).json()["settings"]
        assert saved["theme"] == "dark"
        assert saved["monthly_budget"] == 75000
        assert saved["primary_currency"] == "USD"
        for invalid in [{"theme": "rainbow"}, {"primary_currency": "JPY"}, {"monthly_budget": -1}, {"idle_timeout": 0}]:
            assert (await client.patch("/auth/settings", headers=headers, json=invalid)).status_code == 422


@pytest.mark.asyncio
async def test_password_rotation_and_session_revocation():
    async with httpx.AsyncClient(base_url=BASE_URL) as client:
        email, password, headers = await identity(client)
        invalid = await client.post("/auth/password", headers=headers, json={"current_password": "wrong", "new_password": "ReplacementPassword123!"})
        assert invalid.status_code == 401
        changed = await client.post("/auth/password", headers=headers, json={"current_password": password, "new_password": "ReplacementPassword123!"})
        assert changed.status_code == 200
        assert (await client.get("/auth/me", headers=headers)).status_code == 401
        new_headers = {"Authorization": "Bearer " + changed.json()["access_token"]}
        assert (await client.get("/auth/me", headers=new_headers)).status_code == 200
        assert (await client.post("/auth/login", json={"email": email, "password": password})).status_code == 401
        normalized = await client.post("/auth/login", json={"email": "  " + email.upper() + "  ", "password": "ReplacementPassword123!"})
        assert normalized.status_code == 200
        assert (await client.post("/auth/sessions/revoke", headers=new_headers)).status_code == 200
        assert (await client.get("/auth/me", headers=new_headers)).status_code == 401


@pytest.mark.asyncio
async def test_login_attempt_window_limits_repeated_invalid_passwords():
    async with httpx.AsyncClient(base_url=BASE_URL) as client:
        email = f"absent_{uuid.uuid4().hex}@example.com"
        for _ in range(10):
            response = await client.post("/auth/login", json={"email": email, "password": "InvalidPassword123"})
            assert response.status_code == 401
        assert (await client.post("/auth/login", json={"email": email, "password": "InvalidPassword123"})).status_code == 429


@pytest.mark.asyncio
async def test_password_reset_requires_single_use_code_and_revokes_old_sessions(monkeypatch):
    from app.main import app
    from app.database import get_db
    from app.redis_client import get_redis
    from app import veyra, security
    user = SimpleNamespace(hashed_password=security.hash_password("BeforeReset123!"), token_version=4)
    result = SimpleNamespace(scalar_one_or_none=lambda: user)
    db = SimpleNamespace(execute=AsyncMock(return_value=result), commit=AsyncMock())
    consume = AsyncMock()
    monkeypatch.setattr(veyra, "consume_otp", consume)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_redis] = lambda: object()
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post("/auth/password/reset", json={"email": "person@example.com", "code": "123456", "new_password": "AfterReset123!"})
            assert response.status_code == 200
            assert security.verify_password("AfterReset123!", user.hashed_password)
            assert user.token_version == 5
            assert consume.await_args.args[3] == "reset"
            consume.side_effect = HTTPException(400, "Code is invalid, expired or already used.")
            reused = await client.post("/auth/password/reset", json={"email": "person@example.com", "code": "123456", "new_password": "UnwantedPassword123!"})
            assert reused.status_code == 400
            assert db.commit.await_count == 1
            assert security.verify_password("AfterReset123!", user.hashed_password)
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_reset_request_response_does_not_reveal_account_existence(monkeypatch):
    from app.main import app
    from app.database import get_db
    from app.redis_client import get_redis
    from app import veyra
    db = SimpleNamespace(execute=AsyncMock())
    redis = SimpleNamespace(set=AsyncMock(return_value=True))
    dispatch = AsyncMock()
    monkeypatch.setattr(veyra, "issue_otp", dispatch)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_redis] = lambda: redis
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            db.execute.return_value = SimpleNamespace(scalar_one_or_none=lambda: None)
            absent = await client.post("/auth/password/reset/request", json={"email": "nobody@example.com"})
            dispatch.assert_not_awaited()
            db.execute.return_value = SimpleNamespace(scalar_one_or_none=lambda: object())
            present = await client.post("/auth/password/reset/request", json={"email": "person@example.com"})
            assert absent.status_code == present.status_code == 200
            assert absent.json() == present.json()
            assert dispatch.await_args.args[2] == "reset"
    finally:
        app.dependency_overrides.clear()
