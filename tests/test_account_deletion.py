"""Deletion uses disposable test identities and the local Mailpit sink only."""
import asyncio
import uuid
from datetime import datetime, timezone, timedelta
import httpx
import pytest
from test_api import BASE_URL, identity, account, sql, transfer
from test_backend_invariants import email_code

PASSWORD = "StrongPassword123!"


@pytest.mark.asyncio
async def test_deletion_requires_password_zero_balances_and_confirmation_code():
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=20) as c:
        h, user = await identity(c)
        a = await account(c, h, 100)
        assert (await c.post('/auth/account/deletion-code', headers=h, json={'password':'wrong'})).status_code == 401
        assert (await c.post('/auth/account/deletion-code', headers=h, json={'password':PASSWORD})).status_code == 409
        response = await c.request('DELETE', '/auth/account', headers=h, json={'password':PASSWORD,'code':'123456'})
        assert response.status_code == 409
        assert (await c.get('/auth/me', headers=h)).status_code == 200
        assert (await c.get('/accounts/me', headers=h)).json()[0]['balance'] == 100
        assert (await c.request('DELETE', '/auth/account', json={'password':PASSWORD,'code':'123456'})).status_code in (401,403)


@pytest.mark.asyncio
async def test_delete_anonymizes_profile_revokes_sessions_closes_accounts_and_preserves_journal():
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=20) as c:
        h, user = await identity(c)
        recipient_h, _ = await identity(c)
        source = await account(c, h, 150)
        dest = await account(c, recipient_h)
        assert (await c.post('/transfers', headers=h, json=transfer(source,dest,150))).status_code == 200
        await c.patch('/auth/settings', headers=h, json={'avatar':'sage','monthly_budget':10000})
        scheduled = await c.post('/payments/scheduled', headers=h, json={**transfer(source,dest,10),'due_at':(datetime.now(timezone.utc)+timedelta(days=1)).isoformat()})
        assert scheduled.status_code == 201
        journal_before = await sql('SELECT count(*) FROM ledger_entries WHERE account_id=:id', {'id':source['id']})
        assert (await c.post('/auth/account/deletion-code', headers=h, json={'password':PASSWORD})).status_code == 200
        code = await email_code(user['email'],'account deletion')
        body = {'password':PASSWORD,'code':code}
        assert (await c.request('DELETE','/auth/account',headers=h,json={'password':PASSWORD})).status_code == 422
        wrong = '000000' if code != '000000' else '111111'
        assert (await c.request('DELETE','/auth/account',headers=h,json={**body,'code':wrong})).status_code == 400
        deleted = await c.request('DELETE','/auth/account',headers=h,json=body)
        assert deleted.status_code == 200, deleted.text
        assert (await c.get('/auth/me',headers=h)).status_code == 401
        assert (await c.post('/auth/login',json={'email':user['email'],'password':PASSWORD})).status_code == 401
        assert (await c.request('DELETE','/auth/account',headers=h,json=body)).status_code == 401
        stored = (await sql('SELECT email,full_name,settings,deleted_at FROM users WHERE id=:id',{'id':user['id']}))[0]
        assert stored[0].endswith('@deleted.veyra.invalid') and stored[1] == 'Deleted Veyra member' and stored[2] == {} and stored[3] is not None
        assert (await sql('SELECT kind,owner_name,balance FROM accounts WHERE id=:id',{'id':source['id']}))[0] == ('closed','Deleted Veyra member',0)
        assert await sql('SELECT count(*) FROM ledger_entries WHERE account_id=:id',{'id':source['id']}) == journal_before
        assert (await sql('SELECT status FROM scheduled_payments WHERE id=:id',{'id':scheduled.json()['id']}))[0][0] == 'CANCELLED'
        assert (await c.get('/recipients/resolve',headers=recipient_h,params={'identifier':source['account_number']})).status_code == 404
        assert (await c.post('/transfers',headers=recipient_h,json=transfer(dest,source,10))).status_code == 409
        reused = await c.post('/auth/register',json={'email':user['email'],'password':PASSWORD,'full_name':'Fresh Identity'})
        assert reused.status_code == 201


@pytest.mark.asyncio
async def test_incoming_payment_and_deletion_serialize_without_losing_money():
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=20) as c:
        h, user = await identity(c)
        sender_h, _ = await identity(c)
        dest = await account(c,h)
        source = await account(c,sender_h,100)
        assert (await c.post('/auth/account/deletion-code',headers=h,json={'password':PASSWORD})).status_code == 200
        code = await email_code(user['email'],'account deletion')
        deleted, sent = await asyncio.gather(c.request('DELETE','/auth/account',headers=h,json={'password':PASSWORD,'code':code}),c.post('/transfers',headers=sender_h,json=transfer(source,dest,100)))
        assert (deleted.status_code,sent.status_code) in [(200,409),(409,200)]
        balances = await sql('SELECT sum(balance) FROM accounts WHERE id IN (:src,:dst)',{'src':source['id'],'dst':dest['id']})
        assert balances[0][0] == 100
