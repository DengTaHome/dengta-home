const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { createTakeoutChannel } = require('../services/takeout-channel');

const id = '00000000-0000-4000-8000-000000000001';
const scope = { userId: 'fixture-account', companionId: 'fixture-companion' };

// Execute the service's filters as real SQL, including atomic UPDATE predicates.
function clientFor(db, hooks = {}) {
  return { from(table) {
    assert.equal(table, 'takeout_commands');
    let patch, columns = '*'; const filters = [];
    const builder = {
      select(value) { columns = value; return builder; },
      update(value) { patch = value; return builder; },
      eq(key, value) { filters.push([key, [value]]); return builder; },
      in(key, values) { filters.push([key, values]); return builder; },
      async maybeSingle() {
        const args = []; const param = value => { args.push(value); return '$' + args.length; };
        const set = patch ? Object.entries(patch).map(([key, value]) => `${key}=${param(key === 'result' ? JSON.stringify(value) : value)}`).join(',') : '';
        const where = filters.map(([key, values]) => `${key} IN (${values.map(param).join(',')})`).join(' AND ');
        if (patch) await hooks.beforeUpdate?.(patch, filters);
        const { rows } = await db.query(patch ? `UPDATE takeout_commands SET ${set} WHERE ${where} RETURNING ${columns}` : `SELECT ${columns} FROM takeout_commands WHERE ${where}`, args);
        if (!patch) await hooks.afterRead?.();
        return { data: rows[0] || null, error: null };
      },
    };
    return builder;
  } };
}

test('SQL claims are exclusive and terminal results survive late callbacks and tenant changes', async () => {
  const db = new PGlite();
  try {
    await db.exec('CREATE TABLE takeout_commands (id uuid PRIMARY KEY, user_id text, companion_id text, status text, progress text, result jsonb, ack_at timestamptz, updated_at timestamptz, done_at timestamptz)');
    const reset = async status => { await db.exec('DELETE FROM takeout_commands'); await db.query('INSERT INTO takeout_commands(id,user_id,companion_id,status) VALUES($1,$2,$3,$4)', [id, scope.userId, scope.companionId, status]); };
    const row = async () => (await db.query('SELECT * FROM takeout_commands')).rows[0];
    await reset('pending');
    let reads = 0, release;
    const barrier = new Promise(resolve => { release = resolve; });
    const channel = createTakeoutChannel({ database: clientFor(db, { afterRead: async () => { if (++reads === 2) release(); await barrier; } }) });
    const claims = await Promise.allSettled([channel.ackCommand(scope, id), channel.ackCommand(scope, id)]);
    assert.equal(claims.filter(value => value.status === 'fulfilled').length, 1);
    assert.equal(claims.find(value => value.status === 'rejected').reason.code, 'takeout_command_not_pending');
    assert.equal((await row()).status, 'executing');
    await assert.rejects(channel.ackCommand(scope, id), { status: 409 });
    await channel.postProgress(scope, id, 'fixture progress');
    await channel.postResult(scope, id, { fixture: 'original' });
    await channel.postResult(scope, id, { fixture: 'duplicate must not overwrite' });
    await assert.rejects(channel.postFailure(scope, id, 'late failure'), { status: 409 });
    await assert.rejects(channel.postProgress(scope, id, 'late progress'), { status: 409 });
    await assert.rejects(channel.cancelCommand(scope, id), { status: 409 });
    assert.deepEqual((await row()).result, { fixture: 'original' });
    assert.equal((await row()).progress, 'fixture progress');
    for (const foreign of [{ ...scope, userId: 'other-account' }, { ...scope, companionId: 'other-companion' }]) {
      for (const [method, value] of [['ackCommand'], ['cancelCommand'], ['postResult', {}], ['postFailure', 'fixture'], ['postProgress', 'fixture']]) {
        await assert.rejects(channel[method](foreign, id, value), { status: 404 });
      }
    }
    await reset('executing');
    let raced = false;
    const racing = createTakeoutChannel({ database: clientFor(db, { beforeUpdate: async (patch, filters) => {
      assert.ok(filters.some(([key]) => key === 'user_id'));
      assert.ok(filters.some(([key]) => key === 'companion_id'));
      if (patch.status === 'cancelled' && !raced) {
        raced = true;
        await db.query("UPDATE takeout_commands SET status='done',result=$1 WHERE id=$2", [JSON.stringify({ fixture: 'won race' }), id]);
      }
    } }) });
    await assert.rejects(racing.cancelCommand(scope, id), { status: 409 });
    assert.deepEqual((await row()).result, { fixture: 'won race' });
    await reset('executing');
    await channel.cancelCommand(scope, id);
    await assert.rejects(channel.postResult(scope, id, {}), { status: 409 });
    assert.equal((await row()).status, 'cancelled');
    await reset('pending');
    await assert.rejects(channel.postFailure(scope, id, 'unclaimed'), { status: 409 });
    await channel.ackCommand(scope, id);
    await channel.postFailure(scope, id, 'fixture');
    await channel.postFailure(scope, id, 'duplicate');
    assert.deepEqual((await row()).result, { error: 'fixture' });
  } finally { await db.close(); }
});
