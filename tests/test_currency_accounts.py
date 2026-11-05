"""Chosen onboarding currency and idempotent currency creation against the local ledger."""
import asyncio
import uuid
import httpx
import pytest
from test_api import BASE_URL, identity
from test_backend_invariants import email_code


@pytest.mark.asyncio
async def test_signup_opens_only_the_selected_currency_with_zero_balance():
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=20) as client:
        email = f"chosen_currency_{uuid.uuid4().hex}@example.com"
        assert (await client.post('/auth/otp/send', json={'email': email})).status_code == 200
        verified = await client.post('/auth/otp/verify', json={'email': email, 'code': await email_code(email, 'verification'), 'password': 'ChosenCurrency123!', 'full_name': 'Currency Test', 'primary_currency': 'CHF'})
        assert verified.status_code == 200, verified.text
        assert verified.json()['user']['settings']['primary_currency'] == 'CHF'
        headers = {'Authorization': 'Bearer ' + verified.json()['access_token']}
        accounts = (await client.get('/accounts/me', headers=headers)).json()
        assert len(accounts) == 1 and accounts[0]['currency'] == 'CHF' and accounts[0]['balance'] == 0
        for currency in ['AUD', 'CAD']:
            opened = await client.post('/accounts/currencies', headers=headers, json={'currency': currency})
            assert opened.status_code == 200 and opened.json()['balance'] == 0
        assert (await client.get('/auth/me', headers=headers)).json()['settings']['primary_currency'] == 'CHF'
        assert (await client.patch('/auth/settings', headers=headers, json={'primary_currency': 'CAD'})).status_code == 200
        assert (await client.get('/workspace', headers=headers)).json()['user']['settings']['primary_currency'] == 'CAD'


@pytest.mark.asyncio
async def test_currency_creation_serializes_retries_and_keeps_ownership():
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=20) as client:
        headers, user = await identity(client)
        results = await asyncio.gather(*(client.post('/accounts/currencies', headers=headers, json={'currency': 'CAD'}) for _ in range(4)))
        assert all(r.status_code == 200 for r in results)
        assert len({r.json()['id'] for r in results}) == 1
        assert all(r.json()['user_id'] == user['id'] and r.json()['balance'] == 0 for r in results)
        assert len((await client.get('/accounts/me', headers=headers)).json()) == 1
        assert (await client.post('/accounts/currencies', headers=headers, json={'currency': 'XYZ'})).status_code == 422
        assert (await client.post('/accounts/currencies', json={'currency': 'AUD'})).status_code in (401, 403)
