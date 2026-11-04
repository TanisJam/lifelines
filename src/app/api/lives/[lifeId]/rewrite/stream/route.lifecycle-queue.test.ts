import { it, expect, vi, beforeEach } from 'vitest';
import { lifecycleCreateQueueState, requestLifecycleCreateSlot } from '@/server/lifecycle-create-queue';
const m = vi.hoisted(() => ({ load: vi.fn(), rewrite: vi.fn(), create: vi.fn(), guard: vi.fn(), allocate: vi.fn() }));
vi.mock('@/server/abuse-guard', () => ({ guardSimulation: m.guard }));
vi.mock('@/server/lifecycle-read', () => ({ isLifecycleLife: () => true, resolveLifecycleBranch: () => ({ kind:'found', selected:{ binding:{ version:'root', capsuleDigest:'a'.repeat(64) } } }) }));
vi.mock('@/server/db', () => ({ getDb: () => ({}) }));
vi.mock('@/server/lifecycle-branch-store', () => ({ LifecycleBranchStore: class { decisionById() { return { kind:'absent' }; } } }));
vi.mock('@/server/lifecycle-repository', () => ({ LifecycleRepository: class { load = m.load; }, loadStoredLifecycleFork: vi.fn() }));
vi.mock('@/server/lifecycle-rewrite', () => ({ streamLifecycleRewrite: m.rewrite }));
vi.mock('@/server/lifecycle-life', () => ({ streamLifecycleLife: m.create }));
vi.mock('@/server/life-store', () => ({ getLife:vi.fn(), getLifeBranch:vi.fn(), listLifeBranches:vi.fn(), newLifeBranchId:m.allocate, newLifeId:()=> 'create-life', registerLife:vi.fn(), registerLifeBranch:vi.fn() }));
import { POST as create } from '../../../stream/route';
import { POST as rewrite } from './route';
const target = { id:'choice', year:1328, chosen:'old', options:[{id:'old'},{id:'new'}] };
const request = (signal?:AbortSignal) => new Request('http://local/rewrite', {method:'POST', body:JSON.stringify({branchId:'root',decisionId:'choice',optionId:'new'}),signal});
const ctx = {params: Promise.resolve({lifeId:'life'})};
const createReq = () => new Request('http://local/create', {method:'POST',body:JSON.stringify({name:'A',sex:'f',engine:'lifecycle'})});
const gate = () => { let release!:()=>void; const promise = new Promise<void>(r=>{release=r}); return {promise,release}; };
async function available() { const t = requestLifecycleCreateSlot(); const ac = new AbortController(); await t.ready(ac.signal); expect(lifecycleCreateQueueState()).toEqual({active:1,waiting:0}); t.release(); expect(lifecycleCreateQueueState()).toEqual({active:0,waiting:0}); }
beforeEach(() => { vi.clearAllMocks(); m.guard.mockResolvedValue({engine:{}}); m.allocate.mockReturnValue('child'); m.load.mockResolvedValue({capsule:{genesis:{},output:{owned:{decisions:[target]}}}}); m.rewrite.mockResolvedValue(undefined); });
it.each(['old', 'missing'])('absent index rejects invalid option %s before streaming', async (optionId) => {
 const response = await rewrite(new Request('http://local/rewrite', {method:'POST',body:JSON.stringify({branchId:'root',decisionId:'choice',optionId})}),ctx);
 expect(response.status).toBe(400);
 expect(m.allocate).not.toHaveBeenCalled();
 expect(m.rewrite).not.toHaveBeenCalled();
});

it('absent index rejects an unknown decision before streaming', async () => {
 const response = await rewrite(new Request('http://local/rewrite', {method:'POST',body:JSON.stringify({branchId:'root',decisionId:'missing',optionId:'new'})}),ctx);
 expect(response.status).toBe(400);
 expect(m.allocate).not.toHaveBeenCalled();
 expect(m.rewrite).not.toHaveBeenCalled();
});

it('actual create route blocks rewrite and queued request abort removes only its ticket', async () => { const g=gate(); m.create.mockImplementation(()=>g.promise); const a=await create(createReq()); expect(lifecycleCreateQueueState()).toEqual({active:1,waiting:0}); const ac=new AbortController(); const pending=rewrite(request(ac.signal),ctx); await vi.waitFor(() => expect(lifecycleCreateQueueState().waiting).toBe(1)); expect(lifecycleCreateQueueState()).toEqual({active:1,waiting:1}); expect(m.load).not.toHaveBeenCalled(); ac.abort(); await expect(pending).rejects.toThrow(); expect(lifecycleCreateQueueState()).toEqual({active:1,waiting:0}); g.release(); await a.text(); await available(); });
it('actual create route retains slot until finished and grants rewrite thereafter', async () => { const g=gate(); m.create.mockImplementation(()=>g.promise); const a=await create(createReq()); const pending=rewrite(request(),ctx); await vi.waitFor(() => expect(lifecycleCreateQueueState().waiting).toBe(1)); expect(m.load).not.toHaveBeenCalled(); expect(lifecycleCreateQueueState()).toEqual({active:1,waiting:1}); g.release(); await a.text(); const b=await pending; await b.text(); expect(m.load).toHaveBeenCalledOnce(); await available(); });
it('release after load and rewrite failures, pre-abort and full queue', async () => { m.load.mockRejectedValueOnce(new Error('load')); await expect(rewrite(request(),ctx)).rejects.toThrow('load'); await available(); m.rewrite.mockRejectedValueOnce(new Error('publish')); expect(await (await rewrite(request(),ctx)).text()).toContain('publish'); await available(); const ac=new AbortController(); ac.abort(); await expect(rewrite(request(ac.signal),ctx)).rejects.toThrow(); expect(m.load).toHaveBeenCalledTimes(2); await available(); const tickets=Array.from({length:5},()=>requestLifecycleCreateSlot()); try { expect((await rewrite(request(),ctx)).status).toBe(429); } finally { tickets.reverse().forEach(t=>t.release()); } await available(); });
it('stream cancellation retains ownership until rewrite settles then releases', async () => { const started=gate(), finish=gate(); let signal!:AbortSignal; m.rewrite.mockImplementation(async (arg) => { signal=arg.signal; started.release(); await finish.promise; }); const response=await rewrite(request(),ctx); await started.promise; await response.body!.cancel(); expect(signal.aborted).toBe(true); expect(lifecycleCreateQueueState()).toEqual({active:1,waiting:0}); const next=requestLifecycleCreateSlot(); expect(lifecycleCreateQueueState()).toEqual({active:1,waiting:1}); finish.release(); await next.ready(new AbortController().signal); next.release(); await available(); });
