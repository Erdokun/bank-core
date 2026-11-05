"""Database-backed workspace snapshots, maintenance and worker health."""
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock
import httpx
import pytest
import pytest_asyncio
from test_api import BASE_URL, identity, account, transfer, sql


@pytest_asyncio.fixture(autouse=True)
async def release_local_test_connections():
    # pytest uses a different event loop per test; pooled asyncpg connections
    # must be disposed in the loop that created them.
    yield
    from app.database import engine
    await engine.dispose()


@pytest.mark.asyncio
async def test_workspace_snapshot_and_selected_account_persist_with_ownership_checks():
    async with httpx.AsyncClient(base_url=BASE_URL) as c:
        h, _ = await identity(c)
        other_h, _ = await identity(c)
        first = await account(c,h,100)
        second = await account(c,h,200)
        foreign = await account(c,other_h)
        prefs = {'selected_account_id':second['id'],'theme':'light','monthly_budget':12345}
        saved = await c.patch('/auth/settings',headers=h,json=prefs)
        assert saved.status_code == 200, saved.text
        assert (await c.patch('/auth/settings',headers=h,json={'selected_account_id':foreign['id']})).status_code == 404
        snapshot = await c.get('/workspace',headers=h)
        assert snapshot.status_code == 200, snapshot.text
        data = snapshot.json()
        assert data['user']['settings']['selected_accounts']['EUR'] == second['id']
        assert data['user']['settings']['monthly_budget'] == 12345
        assert {a['id'] for a in data['accounts']} == {first['id'],second['id']}
        assert len(data['entries']) == 2
        assert all('account_id' in e and e['currency']=='EUR' for e in data['entries'])
        assert 'hashed_password' not in data['user']
        assert (await c.get('/workspace')).status_code in (401,403)


@pytest.mark.asyncio
async def test_snapshot_balances_match_its_journal_during_transfers():
    async with httpx.AsyncClient(base_url=BASE_URL,timeout=20) as c:
        h, _ = await identity(c)
        source = await account(c,h,100)
        dest = await account(c,h)
        async def move():
            for _ in range(5):
                assert (await c.post('/transfers',headers=h,json=transfer(source,dest,10))).status_code == 200
        async def inspect():
            for _ in range(5):
                result = await c.get('/workspace',headers=h)
                assert result.status_code == 200, result.text
                data = result.json()
                for a in data['accounts']:
                    journal = sum(e['amount']*(1 if e['entry_type']=='CREDIT' else -1) for e in data['entries'] if e['account_id']==a['id'])
                    assert journal == a['balance']
        await asyncio.gather(move(),inspect())


@pytest.mark.asyncio
async def test_sandbox_reset_reconciles_legacy_openings_without_touching_other_customers():
    from app.admin import reset_balances
    async with httpx.AsyncClient(base_url=BASE_URL) as c:
        h, user = await identity(c)
        other_h, _ = await identity(c)
        legacy = await account(c,h)
        funded = await account(c,h,250)
        untouched = await account(c,other_h,375)
        await sql('UPDATE accounts SET balance=50000 WHERE id=:id',{'id':legacy['id']})
        preview = await reset_balances([user['id']])
        assert preview['applied'] is False
        assert (await c.get('/accounts/'+str(legacy['id']),headers=h)).json()['balance'] == 50000
        result = await reset_balances([user['id']],apply=True)
        assert all(a['after_minor']==0 for a in result['accounts'])
        for a in [legacy,funded]:
            reconciled = await c.get('/accounts/'+str(a['id'])+'/reconciliation',headers=h)
            assert reconciled.json()['balanced'] and reconciled.json()['balance']==0
        assert (await c.get('/accounts/'+str(untouched['id']),headers=other_h)).json()['balance'] == 375
        before = await sql('SELECT count(*) FROM transactions WHERE user_id=:id',{'id':user['id']})
        await reset_balances([user['id']],apply=True)
        assert await sql('SELECT count(*) FROM transactions WHERE user_id=:id',{'id':user['id']}) == before


@pytest.mark.asyncio
async def test_balance_reset_refuses_production_and_unexplained_negative_openings(monkeypatch):
    from app.admin import reset_balances
    monkeypatch.setenv('APP_ENV','production')
    with pytest.raises(ValueError,match='non-production'):
        await reset_balances([1],apply=True)
    monkeypatch.setenv('APP_ENV','development')
    async with httpx.AsyncClient(base_url=BASE_URL) as c:
        h, user = await identity(c)
        a = await account(c,h,100)
        await sql('UPDATE accounts SET balance=0 WHERE id=:id',{'id':a['id']})
        try:
            with pytest.raises(ValueError,match='manual review'):
                await reset_balances([user['id']],apply=True)
        finally:
            await sql('UPDATE accounts SET balance=100 WHERE id=:id',{'id':a['id']})


@pytest.mark.asyncio
async def test_worker_reports_a_recent_successful_poll():
    async with httpx.AsyncClient(base_url=BASE_URL) as c:
        result = await c.get('/health/worker')
        assert result.status_code == 200, result.text
        assert result.json()['scheduler'] == 'up'


@pytest.mark.asyncio
async def test_cache_disconnect_returns_retryable_error_without_exposing_configuration():
    import redis.asyncio as redis
    from app.main import app
    from app.redis_client import get_redis
    fake = SimpleNamespace(set=AsyncMock(side_effect=redis.ConnectionError('private connection details')))
    app.dependency_overrides[get_redis] = lambda: fake
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as c:
            result = await c.post('/auth/otp/send',json={'email':'cache_probe_unique@example.com'})
            assert result.status_code == 503
            assert result.headers['Retry-After'] == '5'
            assert 'private connection' not in result.text
    finally:
        app.dependency_overrides.clear()
