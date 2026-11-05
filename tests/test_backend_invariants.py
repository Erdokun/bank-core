"""PostgreSQL invariants and real local email onboarding flows."""
import asyncio
import os
import re
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock
import httpx
import pytest
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy.exc import DBAPIError
from test_api import BASE_URL, identity, account, sql


async def email_code(email, subject):
    # The local Mailpit sink never forwards these test addresses to the internet.
    async with httpx.AsyncClient(base_url=os.getenv('MAILPIT_URL','http://mailpit:8025')) as mail:
        for _ in range(10):
            found=await mail.get('/api/v1/search',params={'query':f'to:{email} subject:"{subject}"'})
            messages=found.json()['messages']
            if messages:
                message=(await mail.get('/api/v1/message/'+messages[0]['ID'])).json()
                return re.search(r'one-time code: (\d{6})',message['Text']).group(1)
            await asyncio.sleep(.1)
    raise AssertionError('No verification email reached Mailpit')


@pytest.mark.asyncio
async def test_email_registration_two_factor_login_and_password_reset_end_to_end():
    async with httpx.AsyncClient(base_url=BASE_URL,timeout=20) as c:
        email=f'email_flow_{uuid.uuid4().hex}@example.com';password='EmailFlowPassword123!'
        sent=await c.post('/auth/otp/send',json={'email':email});assert sent.status_code==200,sent.text
        code=await email_code(email,'verification')
        signup=dict(email=email,code=code,password=password,full_name='Email Flow',primary_currency='EUR')
        verified=await c.post('/auth/otp/verify',json=signup);assert verified.status_code==200,verified.text
        h={'Authorization':'Bearer '+verified.json()['access_token']}
        accounts=(await c.get('/accounts/me',headers=h)).json()
        assert len(accounts)==1 and accounts[0]['currency']=='EUR' and accounts[0]['balance']==0
        assert (await c.post('/auth/otp/verify',json=signup)).status_code==400
        two_factor={'two_factor':True,'password':password}
        assert (await c.patch('/auth/settings',headers=h,json=two_factor)).status_code==428
        two_factor['code']=await email_code(email,'security')
        assert (await c.patch('/auth/settings',headers=h,json=two_factor)).status_code==200
        login={'email':email,'password':password}
        assert (await c.post('/auth/login',json=login)).status_code==428
        login['code']=await email_code(email,'sign-in')
        result=await c.post('/auth/login',json=login);assert result.status_code==200,result.text
        assert (await c.post('/auth/login',json=login)).status_code==400
        assert (await c.post('/auth/password/reset/request',json={'email':email})).status_code==200
        reset={'email':email,'code':await email_code(email,'password'),'new_password':'ReplacementEmail123!'}
        assert (await c.post('/auth/password/reset',json=reset)).status_code==200
        assert (await c.get('/auth/me',headers=h)).status_code==401
        assert (await c.post('/auth/password/reset',json=reset)).status_code==400
        assert (await c.post('/auth/login',json={'email':email,'password':password})).status_code==401


@pytest.mark.asyncio
async def test_otp_attempt_limit_cannot_be_bypassed_with_a_correct_code():
    async with httpx.AsyncClient(base_url=BASE_URL) as c:
        email=f'otp_limit_{uuid.uuid4().hex}@example.com'
        assert (await c.post('/auth/otp/send',json={'email':email})).status_code==200
        code=await email_code(email,'verification');wrong='000000' if code!='000000' else '111111'
        body=dict(email=email,code=wrong,password='AttemptLimit123!',full_name='OTP Test')
        for _ in range(5):assert (await c.post('/auth/otp/verify',json=body)).status_code==400
        body['code']=code
        assert (await c.post('/auth/otp/verify',json=body)).status_code==400


@pytest.mark.asyncio
async def test_immutable_ledger_and_commit_time_balance_checks():
    async with httpx.AsyncClient(base_url=BASE_URL) as c:
        h,_=await identity(c);a=await account(c,h,1000)
        with pytest.raises(DBAPIError,match='immutable'):
            await sql('UPDATE ledger_entries SET amount=amount+1 WHERE account_id=:id',{'id':a['id']})
        with pytest.raises(DBAPIError,match='immutable'):
            await sql('DELETE FROM audit_events WHERE user_id=(SELECT user_id FROM accounts WHERE id=:id)',{'id':a['id']})
        with pytest.raises(DBAPIError,match='no journal entries'):
            await sql("INSERT INTO transactions (idempotency_key,status,kind,reference,created_at) VALUES (:key,'COMPLETED','transfer','',now())",{'key':uuid.uuid4().hex})
        with pytest.raises(DBAPIError,match='Unbalanced journal'):
            await sql("""WITH t AS (INSERT INTO transactions (idempotency_key,status,kind,reference,created_at) VALUES (:key,'COMPLETED','transfer','',now()) RETURNING id)
              INSERT INTO ledger_entries (transaction_id,account_id,amount,entry_type,created_at) SELECT id,:account,50,'CREDIT',now() FROM t""",{'key':uuid.uuid4().hex,'account':a['id']})
        assert (await c.get(f"/accounts/{a['id']}/reconciliation",headers=h)).json()['balanced']


@pytest.mark.asyncio
async def test_concurrent_card_payments_obey_the_combined_daily_limit():
    async with httpx.AsyncClient(base_url=BASE_URL,timeout=20) as c:
        h,_=await identity(c);a=await account(c,h,10000)
        await c.patch('/auth/settings',headers=h,json={'daily_limit':1000})
        bodies=[dict(account_id=a['id'],amount=600,merchant='Concurrency store',channel='online',idempotency_key=uuid.uuid4().hex) for _ in range(2)]
        responses=await asyncio.gather(*[c.post('/sandbox/card-payments',headers=h,json=b) for b in bodies])
        assert sorted(r.status_code for r in responses)==[200,422]
        assert (await c.get(f"/accounts/{a['id']}",headers=h)).json()['balance']==9400


@pytest.mark.asyncio
async def test_fx_is_balanced_in_each_currency_and_replays_after_quote_expiry(monkeypatch):
    from app.main import app
    from app.database import get_db
    from app import veyra
    from app.redis_client import redis_client
    async with httpx.AsyncClient(base_url=BASE_URL) as c:
        h,_=await identity(c);a=await account(c,h,10000);b=await account(c,h,currency='USD')
    engine=create_async_engine(os.environ['DATABASE_URL']);sessions=async_sessionmaker(engine,expire_on_commit=False)
    async def database():
        async with sessions() as db:yield db
    app.dependency_overrides[get_db]=database
    rate_response=SimpleNamespace(raise_for_status=lambda:None,json=lambda:[{'rate':1.1,'date':'2026-11-01'}])
    rate_client=AsyncMock();rate_client.__aenter__.return_value=rate_client;rate_client.get.return_value=rate_response
    client=httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test')
    monkeypatch.setattr(veyra.httpx,'AsyncClient',lambda **kwargs:rate_client)
    try:
        async with client:
            q=await client.post('/fx/quote',headers=h,json=dict(source_account_id=a['id'],destination_account_id=b['id'],amount=1000))
            assert q.status_code==200,q.text
            assert q.json()['received']==1100
            body={'quote_id':q.json()['quote_id']}
            first=await client.post('/fx/swap',headers=h,json=body);assert first.status_code==200,first.text
            await redis_client.delete('veyra:fx:'+body['quote_id'])
            replay=await client.post('/fx/swap',headers=h,json=body)
            assert replay.status_code==200 and replay.json()['transaction_id']==first.json()['transaction_id']
            assert (await client.get(f"/accounts/{a['id']}",headers=h)).json()['balance']==9000
            assert (await client.get(f"/accounts/{b['id']}",headers=h)).json()['balance']==1100
            assert (await client.get(f"/accounts/{b['id']}/reconciliation",headers=h)).json()['balanced']
    finally:
        app.dependency_overrides.clear();await engine.dispose();await redis_client.aclose()

@pytest.mark.asyncio
async def test_scheduled_payment_creation_is_idempotent_and_rejects_payload_changes():
    from datetime import timedelta
    async with httpx.AsyncClient(base_url=BASE_URL,timeout=20) as c:
        h,_=await identity(c);a=await account(c,h);b=await account(c,h)
        body=dict(source_account_id=a['id'],destination_account_id=b['id'],amount=250,reference='Planned gift',due_at=(datetime.now(timezone.utc)+timedelta(hours=1)).isoformat(),idempotency_key=uuid.uuid4().hex)
        results=await asyncio.gather(*[c.post('/payments/scheduled',headers=h,json=body) for _ in range(3)])
        assert all(r.status_code==201 for r in results)
        assert len({r.json()['id'] for r in results})==1
        body['amount']=251
        assert (await c.post('/payments/scheduled',headers=h,json=body)).status_code==409
        assert len((await c.get('/payments/scheduled',headers=h)).json())==1
        await c.delete('/payments/scheduled/'+str(results[0].json()['id']),headers=h)
