import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SaveStore } from './save-store.ts';
import { createInitialGame, startGame } from '../../packages/rules/src/index.ts';

test('Chinese saves round-trip full state and reject unsafe names', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'golden-road-save-test-'));
  try {
    const store = new SaveStore(directory);
    const game = startGame(createInitialGame(77));
    const summary = await store.save('驿道试玩-第一轮', game);
    assert.deepEqual(await store.load(summary.id), game);
    assert.equal((await store.list())[0].name, '驿道试玩-第一轮');
    await assert.rejects(store.save('../escape', game));
    await assert.rejects(store.load('../escape'));
    await assert.rejects(store.save('CON', game));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('automatic recovery is independent from named saves and preserves the latest state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'golden-road-recovery-test-'));
  try {
    const store = new SaveStore(directory);
    const game = startGame(createInitialGame(91));
    game.round = 4;
    await store.save('保留档案', game);
    await store.saveRecovery(game);
    assert.deepEqual(await store.loadRecovery(), game);
    assert.deepEqual((await store.list()).map((item) => item.name), ['保留档案']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('named save slots are independent, accept readable names, and only overwrite on request', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'golden-road-save-slots-'));
  try {
    const store = new SaveStore(directory);
    const first = startGame(createInitialGame(101));
    const second = startGame(createInitialGame(202, 'fixedRounds'));
    const firstSummary = await store.save('甲箱 试档（秋季）', first);
    const secondSummary = await store.save('官兵-方案_2', second);
    assert.notEqual(firstSummary.id, secondSummary.id);
    assert.equal((await store.list()).length, 2);
    await assert.rejects(store.save('甲箱 试档（秋季）', second), /同名存档已存在/);
    assert.deepEqual(await store.load(firstSummary.id), first);
    const updated = await store.save('甲箱 试档（秋季）', second, true);
    assert.equal(updated.id, firstSummary.id);
    assert.equal(updated.name, '甲箱 试档（秋季）');
    assert.deepEqual(await store.load(firstSummary.id), second);
    assert.deepEqual(await store.load(secondSummary.id), second);
    await assert.rejects(store.save('含/路径', first));
    assert.deepEqual(await store.load(secondSummary.id), second);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
