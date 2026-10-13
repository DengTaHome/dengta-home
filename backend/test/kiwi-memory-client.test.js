const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
function fixture(fetchImpl) {
    const calls = [], logs = [];
    const context = { module: { exports: {} }, process: { env: { KIWI_MEM_URL: 'https://memory.invalid', KIWI_MEM_TOKEN: 'synthetic-only', KIWI_MEM_TIMEOUT_MS: '20' } },
        fetch: async (url, options) => { calls.push({ url, options }); return fetchImpl(url, options); },
        console: { error: (...args) => logs.push(args) }, AbortController, FormData, Blob, setTimeout, clearTimeout };
    vm.runInNewContext(fs.readFileSync(require.resolve('../services/kiwi-memory-client'), 'utf8'), context);
    return { api: context.module.exports, calls, logs };
}
const tenantA = { userId: 'account-a', companionId: 'companion-a' };
const tenantB = { userId: 'account-b', companionId: 'companion-b' };
const response = (scope, data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'X-Tenant-Id': scope } });
test('all memory paths fail closed before fetch when account or companion is absent', async () => {
    const { api, calls } = fixture(() => { throw new Error('must not fetch'); });
    for (const tenant of [null, { userId: 'a' }, { companionId: 'b' }, { userId: 'a:b', companionId: 'c' }, { userId: 'a\r\n', companionId: 'b' }]) {
        assert.equal(api.tenantIdFor(tenant), null);
        assert.equal((await api.storeMemory({ content: 'synthetic fact', tenant })).error, 'kiwi_mem_tenant_required');
        assert.equal((await api.reportChatTurn({ conversationId: 'fixture', userMessage: 'synthetic', tenant })).error, 'kiwi_mem_tenant_required');
        assert.equal((await api.importMemories({ memories: [{ content: 'synthetic' }], tenant })).error, 'kiwi_mem_tenant_required');
        assert.equal((await api.importMemoryFile({ filename: 'fixture.txt', fileBuffer: Buffer.from('synthetic'), tenant })).error, 'kiwi_mem_tenant_required');
        assert.equal((await api.checkKiwiMemoryHealth(tenant)).error, 'kiwi_mem_tenant_required');
        assert.equal((await api.recallMemories('synthetic', tenant)).length, 0);
    }
    assert.equal(calls.length, 0);
});
test('concurrent accounts and companions use separate outgoing and echoed scopes', async () => {
    const { api, calls } = fixture(async (_url, { headers }) => {
        const scope = headers['X-Tenant-Id'];
        await new Promise(resolve => setTimeout(resolve, scope.startsWith('account-a') ? 5 : 0));
        return response(scope, { memories: [{ id: scope, title: 'fixture', content: scope }] });
    });
    const scopes = [tenantA, tenantB, { ...tenantA, companionId: 'companion-c' }];
    const results = await Promise.all(scopes.map(tenant => api.recallMemories('synthetic', tenant)));
    results.forEach((rows, index) => { assert.equal(rows.length, 1); assert.equal(rows[0].summary, 'fixture：' + api.tenantIdFor(scopes[index])); });
    assert.equal(new Set(calls.map(c => c.options.headers['X-Tenant-Id'])).size, 3);
});
test('wrong or absent tenant echo never enters recall or passes a write receipt', async () => {
    for (const echo of ['', 'other:companion']) {
        const { api, logs } = fixture(() => response(echo, { memories: [{ id: 1, content: 'unrelated private fixture' }] }));
        assert.equal((await api.recallMemories('fixture', tenantA)).length, 0);
        assert.equal((await api.storeMemory({ content: 'synthetic', tenant: tenantA })).error, 'kiwi_mem_tenant_unverified');
        assert.ok(!JSON.stringify(logs).includes('unrelated private fixture'));
    }
});
test('HTTP and HTTP-200 logical failures are errors; writes never automatically repeat', async () => {
    for (const status of [401, 403, 429, 500]) {
        const { api, calls, logs } = fixture(() => response('account-a:companion-a', { error: 'private body fixture' }, status));
        const result = await api.reportChatTurn({ conversationId: 'private-conversation', userMessage: 'private-message', tenant: tenantA });
        assert.equal(result.error, `kiwi_mem_http_${status}`); assert.equal(calls.length, 1);
        assert.doesNotMatch(JSON.stringify(logs), /private-body|private body|private-conversation|private-message/);
    }
    const { api } = fixture(() => response('account-a:companion-a', { ok: false, error: 'private reason' }));
    assert.equal((await api.checkKiwiMemoryHealth(tenantA)).error, 'kiwi_mem_invalid_response');
    const disabled = fixture(() => response('account-a:companion-a', { ok: false, error: 'memory_disabled' }));
    assert.equal((await disabled.api.checkKiwiMemoryHealth(tenantA)).error, 'kiwi_mem_memory_disabled');
});
test('network errors and timeouts contain no private addresses or duplicate turns', async () => {
    const f = fixture(() => { throw new Error('https://private.invalid/token-secret'); });
    assert.equal((await f.api.reportChatTurn({ conversationId: 'fixture', userMessage: 'fixture', tenant: tenantA })).error, 'kiwi_mem_network_error');
    assert.equal(f.calls.length, 1); assert.doesNotMatch(JSON.stringify(f.logs), /private.invalid|token-secret/);
    const timed = fixture((_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('fixture', 'AbortError')))));
    assert.equal((await timed.api.recallMemories('fixture', tenantA)).length, 0);
    assert.equal(timed.calls.length, 1); assert.match(JSON.stringify(timed.logs), /timeout/);
});
test('health is scoped and identifies embedding degradation', async () => {
    const { api } = fixture((_url, { headers }) => response(headers['X-Tenant-Id'], { total_memories: 0, embedding_available: false }));
    const result = await api.checkKiwiMemoryHealth(tenantA);
    assert.equal(result.reachable, true); assert.equal(result.tenant_verified, true); assert.equal(result.ok, false);
});
