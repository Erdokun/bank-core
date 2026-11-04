"""Self-contained concurrency proof using newly provisioned sandbox accounts."""
import asyncio
import uuid
import httpx


async def run_stress_test():
    async with httpx.AsyncClient(base_url='http://127.0.0.1:8000',timeout=20) as client:
        email=f'load_{uuid.uuid4().hex}@example.com';password='ConcurrencyProof123!'
        registered=await client.post('/auth/register',json=dict(email=email,password=password,full_name='Concurrency Proof'))
        registered.raise_for_status()
        login=await client.post('/auth/login',json=dict(email=email,password=password));login.raise_for_status()
        headers={'Authorization':'Bearer '+login.json()['access_token']}
        accounts=[]
        for _ in range(2):
            r=await client.post('/accounts',headers=headers,json={});r.raise_for_status();accounts.append(r.json())
        source,destination=accounts
        funded=await client.post('/sandbox/funding',headers=headers,json=dict(account_id=source['id'],amount=35000,idempotency_key=uuid.uuid4().hex));funded.raise_for_status()
        results=await asyncio.gather(*[client.post('/transfers',headers=headers,json=dict(source_account_id=source['id'],destination_account_id=destination['id'],amount=5000,idempotency_key=uuid.uuid4().hex)) for _ in range(10)])
        successes=sum(r.status_code==200 for r in results);rejections=sum(r.status_code==400 for r in results)
        after=(await client.get('/accounts/me',headers=headers)).json()
        conserved=sum(a['balance'] for a in after)==35000
        nonnegative=all(a['balance']>=0 for a in after)
        print(f'10 parallel requests: {successes} settled, {rejections} rejected')
        print(f'Money conserved: {conserved}; no overdraft: {nonnegative}')
        if (successes,rejections)!=(7,3) or not conserved or not nonnegative:
            raise SystemExit('Concurrency invariant failed')
        print('PASS')


if __name__=='__main__':
    asyncio.run(run_stress_test())
