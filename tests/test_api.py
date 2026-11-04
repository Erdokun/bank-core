"""Integration tests against the Compose PostgreSQL/Redis banking sandbox."""
import asyncio
import uuid
from datetime import datetime, timezone, timedelta
import os
import httpx
import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

BASE_URL = os.getenv('TEST_BASE_URL', 'http://127.0.0.1:8000')


async def identity(client):
    email = f'test_{uuid.uuid4().hex}@example.com'
    password = 'StrongPassword123!'
    r = await client.post('/auth/register', json=dict(email=email, password=password, full_name='Test Customer'))
    assert r.status_code == 201, r.text
    login = await client.post('/auth/login', json=dict(email=email, password=password))
    assert login.status_code == 200, login.text
    return {'Authorization': 'Bearer ' + login.json()['access_token']}, r.json()


async def account(client, headers, balance=0, currency='EUR', kind='current'):
    r = await client.post('/accounts', headers=headers, json=dict(currency=currency, kind=kind))
    assert r.status_code == 201, r.text
    item = r.json()
    if balance:
        r = await client.post('/sandbox/funding', headers=headers, json=dict(account_id=item['id'], amount=balance, idempotency_key=uuid.uuid4().hex))
        assert r.status_code == 200, r.text
    return item


async def sql(statement, params):
    engine = create_async_engine(os.getenv('DATABASE_URL', 'postgresql+asyncpg://bank_user:bank_password123@localhost:5432/bank_db'))
    try:
        async with engine.begin() as conn:
            result = await conn.execute(text(statement), params)
            return result.all() if result.returns_rows else None
    finally:
        await engine.dispose()


def transfer(src, dst, amount, key=None):
    return dict(source_account_id=src['id'], destination_account_id=dst['id'], amount=amount, idempotency_key=key or uuid.uuid4().hex)


@pytest.mark.asyncio
async def test_health_and_security_headers():
    async with httpx.AsyncClient(base_url=BASE_URL) as c:
        r = await c.get('/health')
        assert r.json() == {'status': 'healthy', 'service': 'bank-core'}
        assert r.headers['x-content-type-options'] == 'nosniff'
        assert r.headers['x-frame-options'] == 'DENY'
        assert 'x-request-id' in r.headers and 'x-process-time-ms' in r.headers
        assert (await c.get('/health/ready')).json()['status'] == 'ready'
        assert (await c.get('/system/capabilities')).json()['sandbox'] is True


@pytest.mark.asyncio
async def test_registration_normalization_and_privilege_escalation():
    async with httpx.AsyncClient(base_url=BASE_URL) as c:
        email = f'user_{uuid.uuid4().hex}@example.com'
        body = dict(email='  '+email.upper()+'  ', full_name='Test User', password='StrongPassword123!')
        r = await c.post('/auth/register', json=body)
        assert r.status_code == 201 and r.json()['email'] == email
        assert r.json()['role'] == 'CUSTOMER'
        assert (await c.post('/auth/register', json=body)).status_code == 409
        body['email'] = 'auditor_'+email; body['role'] = 'AUDITOR'
        assert (await c.post('/auth/register', json=body)).status_code == 422
        body['role'] = 'CUSTOMER'; body['email'] = 'not-an-email'
        assert (await c.post('/auth/register', json=body)).status_code == 422
        assert (await c.get('/auth/me', headers={'Authorization': 'Bearer forged.token'})).status_code == 401


@pytest.mark.asyncio
async def test_money_cannot_be_minted_during_account_creation():
    async with httpx.AsyncClient(base_url=BASE_URL) as c:
        h, _ = await identity(c)
        for initial in (1, 10000, -1):
            assert (await c.post('/accounts', headers=h, json={'initial_balance': initial})).status_code == 422
        a = await account(c, h, 10000)
        statement = (await c.get(f"/accounts/{a['id']}/statement", headers=h)).json()
        assert statement['current_balance'] == 10000
        assert len(statement['entries']) == 1
        assert statement['entries'][0]['kind'] == 'sandbox_funding'
        check = (await c.get(f"/accounts/{a['id']}/reconciliation", headers=h)).json()
        assert check['balanced'] is True and check['difference'] == 0


@pytest.mark.asyncio
async def test_durable_idempotency_payload_conflict_and_user_scope():
    async with httpx.AsyncClient(base_url=BASE_URL) as c:
        h, _ = await identity(c); other, _ = await identity(c)
        a = await account(c, h, 20000); b = await account(c, other, 5000)
        body = transfer(a, b, 7500)
        first = await c.post('/transfers', headers=h, json=body)
        replay = await c.post('/transfers', headers=h, json=body)
        assert first.status_code == replay.status_code == 200
        assert first.json()['transaction_id'] == replay.json()['transaction_id']
        assert 'already processed' in replay.json()['message']
        body['amount'] += 1
        assert (await c.post('/transfers', headers=h, json=body)).status_code == 409
        # A different user can safely use the same client-supplied key.
        reverse = await c.post('/transfers', headers=other, json=transfer(b, a, 100, body['idempotency_key']))
        assert reverse.status_code == 200 and reverse.json()['transaction_id'] != first.json()['transaction_id']
        assert (await c.get(f"/accounts/{a['id']}", headers=h)).json()['balance'] == 12600


@pytest.mark.asyncio
async def test_access_control_currency_and_overdraft_guards():
    async with httpx.AsyncClient(base_url=BASE_URL) as c:
        h, _ = await identity(c); other, _ = await identity(c)
        a = await account(c, h, 1000); b = await account(c, other); usd = await account(c, h, currency='USD')
        assert (await c.post('/transfers', headers=other, json=transfer(a,b,100))).status_code == 403
        assert (await c.get(f"/accounts/{a['id']}/statement", headers=other)).status_code == 403
        assert (await c.get(f"/accounts/{a['id']}/reconciliation", headers=other)).status_code == 404
        assert (await c.post('/transfers', headers=h, json=transfer(a,b,1001))).status_code == 400
        assert (await c.post('/transfers', headers=h, json=transfer(a,usd,100))).status_code == 400
        assert (await c.post('/transfers', headers=h, json=transfer(a,a,1))).status_code == 400
        for amount in (0,-1,0.5,True):
            assert (await c.post('/transfers', headers=h, json=transfer(a,b,amount))).status_code == 422


@pytest.mark.asyncio
async def test_auditor_role_is_provisioned_only_by_trusted_database_administration():
    async with httpx.AsyncClient(base_url=BASE_URL) as c:
        h, _ = await identity(c); auditor, info = await identity(c)
        await sql("UPDATE users SET role='AUDITOR' WHERE id=:id", {'id': info['id']})
        a = await account(c,h,500)
        assert (await c.get(f"/accounts/{a['id']}/statement", headers=auditor)).status_code == 200
        assert (await c.post('/transfers', headers=auditor, json=transfer(a,{'id':999999999},1))).status_code in (403,404)


@pytest.mark.asyncio
async def test_concurrent_debits_cannot_overdraw_and_replay_cannot_double_debit():
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=20) as c:
        h,_=await identity(c); a=await account(c,h,35000); b=await account(c,h)
        results=await asyncio.gather(*[c.post('/transfers',headers=h,json=transfer(a,b,5000)) for _ in range(10)])
        assert sum(r.status_code==200 for r in results)==7
        assert sum(r.status_code==400 for r in results)==3
        balances=(await c.get('/accounts/me',headers=h)).json()
        assert sum(a['balance'] for a in balances)==35000
        assert min(a['balance'] for a in balances)==0
        h,_=await identity(c); a=await account(c,h,10000); b=await account(c,h)
        body=transfer(a,b,5000)
        replays=await asyncio.gather(*[c.post('/transfers',headers=h,json=body) for _ in range(8)])
        assert all(r.status_code==200 for r in replays)
        assert len({r.json()['transaction_id'] for r in replays})==1
        assert (await c.get(f"/accounts/{a['id']}",headers=h)).json()['balance']==5000


@pytest.mark.asyncio
async def test_opposite_direction_transfers_preserve_money_without_deadlock():
    async with httpx.AsyncClient(base_url=BASE_URL,timeout=20) as c:
        h,_=await identity(c); other,_=await identity(c)
        a=await account(c,h,10000);b=await account(c,other,10000)
        results=await asyncio.gather(*[c.post('/transfers',headers=h if i%2 else other,json=transfer(a,b,100) if i%2 else transfer(b,a,100)) for i in range(12)])
        assert all(r.status_code==200 for r in results)
        assert (await c.get(f"/accounts/{a['id']}",headers=h)).json()['balance']==10000
        assert (await c.get(f"/accounts/{b['id']}",headers=other)).json()['balance']==10000


@pytest.mark.asyncio
async def test_transfer_limit_and_rate_limit():
    async with httpx.AsyncClient(base_url=BASE_URL) as c:
        h,_=await identity(c);a=await account(c,h,500000);b=await account(c,h)
        assert (await c.post('/transfers',headers=h,json=transfer(a,b,1500000))).status_code==422
        for _ in range(9):
            assert (await c.post('/transfers',headers=h,json=transfer(a,b,100))).status_code==200
        assert (await c.post('/transfers',headers=h,json=transfer(a,b,100))).status_code==429


@pytest.mark.asyncio
async def test_card_controls_daily_aggregation_and_idempotency():
    async with httpx.AsyncClient(base_url=BASE_URL) as c:
        h,_=await identity(c);a=await account(c,h,10000)
        body=dict(account_id=a['id'],amount=600,idempotency_key=uuid.uuid4().hex,merchant='Coffee',channel='online')
        await c.patch('/auth/settings',headers=h,json={'card_frozen':True})
        assert (await c.post('/sandbox/card-payments',headers=h,json=body)).status_code==403
        await c.patch('/auth/settings',headers=h,json={'card_frozen':False,'online_payments':False})
        assert (await c.post('/sandbox/card-payments',headers=h,json=body)).status_code==403
        await c.patch('/auth/settings',headers=h,json={'online_payments':True,'daily_limit':1000,'contactless_limit':500,'atm_limit':300})
        r=await c.post('/sandbox/card-payments',headers=h,json=body);assert r.status_code==200,r.text
        # Replaying a settled purchase still succeeds even after freezing the card.
        await c.patch('/auth/settings',headers=h,json={'card_frozen':True})
        assert (await c.post('/sandbox/card-payments',headers=h,json=body)).json()['transaction_id']==r.json()['transaction_id']
        await c.patch('/auth/settings',headers=h,json={'card_frozen':False})
        body['idempotency_key']=uuid.uuid4().hex
        assert (await c.post('/sandbox/card-payments',headers=h,json=body)).status_code==422
        body.update(channel='contactless',amount=501,idempotency_key=uuid.uuid4().hex)
        assert (await c.post('/sandbox/card-payments',headers=h,json=body)).status_code==422
        body.update(channel='atm',amount=200,idempotency_key=uuid.uuid4().hex)
        assert (await c.post('/sandbox/card-payments',headers=h,json=body)).status_code==200
        body['idempotency_key']=uuid.uuid4().hex
        assert (await c.post('/sandbox/card-payments',headers=h,json=body)).status_code==422
        assert (await c.get(f"/accounts/{a['id']}/reconciliation",headers=h)).json()['balanced']


@pytest.mark.asyncio
async def test_beneficiaries_are_persistent_and_isolated():
    async with httpx.AsyncClient(base_url=BASE_URL) as c:
        h,_=await identity(c); other,_=await identity(c);a=await account(c,other)
        saved=await c.post('/beneficiaries',headers=h,json={'name':'Friend','account_id':a['id']});assert saved.status_code==201
        identifier=saved.json()['id']
        assert (await c.get('/beneficiaries',headers=h)).json()[0]['name']=='Friend'
        assert (await c.get('/beneficiaries',headers=other)).json()==[]
        assert (await c.delete(f'/beneficiaries/{identifier}',headers=other)).status_code==404
        assert (await c.delete(f'/beneficiaries/{identifier}',headers=h)).status_code==200
        assert (await c.get('/beneficiaries',headers=h)).json()==[]


@pytest.mark.asyncio
async def test_scheduled_payment_execution_cancellation_and_insufficient_funds():
    async with httpx.AsyncClient(base_url=BASE_URL,timeout=20) as c:
        h,_=await identity(c);other,_=await identity(c);a=await account(c,h,1000);b=await account(c,other)
        body=transfer(a,b,600);body['due_at']=(datetime.now(timezone.utc)+timedelta(hours=1)).isoformat()
        created=[]
        for _ in range(3):
            body['idempotency_key']=uuid.uuid4().hex
            r=await c.post('/payments/scheduled',headers=h,json=body);assert r.status_code==201,r.text;created.append(r.json()['id'])
        assert (await c.delete(f'/payments/scheduled/{created[0]}',headers=other)).status_code==404
        assert (await c.delete(f'/payments/scheduled/{created[0]}',headers=h)).status_code==200
        await sql("UPDATE scheduled_payments SET due_at=now()-interval '1 second' WHERE user_id=(SELECT user_id FROM accounts WHERE id=:id)",{'id':a['id']})
        for _ in range(30):
            rows=(await c.get('/payments/scheduled',headers=h)).json()
            if not any(r['status']=='PENDING' for r in rows):break
            await asyncio.sleep(.5)
        assert sorted(r['status'] for r in rows)==['CANCELLED','COMPLETED','FAILED']
        assert 'Insufficient' in next(r for r in rows if r['status']=='FAILED')['failure_reason']
        assert (await c.get(f"/accounts/{a['id']}",headers=h)).json()['balance']==400
        assert (await c.get('/audit/events',headers=other)).json() # account creation is audited
        actions={e['action'] for e in (await c.get('/audit/events',headers=h)).json()}
        assert {'schedule.created','schedule.cancelled','schedule.failed','payment.transfer'}<=actions


@pytest.mark.asyncio
async def test_database_constraints_and_balanced_journals():
    rows=await sql('''SELECT t.id, a.currency, sum(CASE WHEN l.entry_type='CREDIT' THEN l.amount ELSE -l.amount END)
      FROM transactions t JOIN ledger_entries l ON t.id=l.transaction_id JOIN accounts a ON a.id=l.account_id
      GROUP BY t.id,a.currency HAVING sum(CASE WHEN l.entry_type='CREDIT' THEN l.amount ELSE -l.amount END) <> 0''',{})
    assert rows==[]
    async with httpx.AsyncClient(base_url=BASE_URL) as c:
        h,_=await identity(c);a=await account(c,h)
        from sqlalchemy.exc import IntegrityError
        with pytest.raises(IntegrityError):
            await sql('UPDATE accounts SET balance=-1 WHERE id=:id',{'id':a['id']})


@pytest.mark.asyncio
async def test_otp_never_exposes_codes_or_email_html():
    async with httpx.AsyncClient(base_url=BASE_URL) as c:
        r=await c.post('/auth/otp/send',json={'email':f'otp_{uuid.uuid4().hex}@example.com'})
        assert r.status_code in (200,503)
        assert 'dev_otp' not in r.json() and 'html_preview' not in r.json()
