// 執行方式：在專案根目錄 npm test
// 每日備份：資料表全部打包、檔名（台灣日期）、只保留最近 N 份、跑完一輪的流程
import test from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { RoomCore } from '../src/room-core.js';
import { dumpDatabase, backupKey, pickExpired, runBackup } from '../src/backup.js';
import { makeDb } from './helpers.js';

const env = { DISCORD_ALLOWED_IDS: '100', GM_DISCORD_IDS: '100', ADMIN_DISCORD_IDS: '' };

test('dumpDatabase 會帶出所有資料表與列', () => {
  const db = makeDb();
  const core = new RoomCore({ db, env, now: () => 5 });
  core.migrate();
  db.exec("INSERT INTO characters(uid, json, version, updated_at) VALUES ('100', '{\"name\":\"A\"}', 3, 9)");
  const dump = dumpDatabase(db, 123);
  assert.equal(dump.takenAt, 123);
  assert.deepEqual(Object.keys(dump.tables).sort(), ['activity', 'characters', 'events', 'images', 'mail', 'members', 'meta', 'presets', 'vitals']);
  assert.deepEqual(dump.tables.characters.map((r) => ({ ...r })), [{ uid: '100', json: '{"name":"A"}', version: 3, updated_at: 9 }]);
});

test('backupKey 用台灣日期（UTC+8）', () => {
  assert.equal(backupKey('main', Date.UTC(2026, 9, 11, 15, 59)), 'backup/main/2026-10-11.json.gz');
  assert.equal(backupKey('main', Date.UTC(2026, 9, 11, 16, 0)), 'backup/main/2026-10-12.json.gz');
});

test('pickExpired 只刪最舊的、不碰格式不符的檔案', () => {
  const keys = ['backup/main/2026-10-01.json.gz', 'backup/main/2026-10-03.json.gz', 'backup/main/2026-10-02.json.gz', 'backup/main/notes.txt', 'backup/other/2026-09-01.json.gz'];
  assert.deepEqual(pickExpired(keys, 'main', 2), ['backup/main/2026-10-01.json.gz']);
  assert.deepEqual(pickExpired(keys, 'main', 3), []);
});

test('runBackup：寫進 R2 的是可解壓縮的 JSON，並清掉過期的', async () => {
  const stored = new Map();
  for (let d = 1; d <= 3; d++) stored.set(`backup/main/2026-09-0${d}.json.gz`, 'old');
  const BACKUP = {
    put: async (k, body) => { stored.set(k, Buffer.from(body)); },
    list: async ({ prefix }) => ({ objects: [...stored.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }),
    delete: async (keys) => { for (const k of keys) stored.delete(k); },
  };
  const dump = { format: 1, takenAt: 1, tables: { meta: [{ key: 'gm', value: '100' }] } };
  const ROOM = { idFromName: (n) => n, get: () => ({ dumpAll: async () => dump }) };
  // runBackup 的保留份數是 30；這裡先塞 33 份舊的讓它剛好刪 4 份（含今天新增的共 34 份）
  for (let d = 1; d <= 30; d++) stored.set(`backup/main/2026-08-${String(d).padStart(2, '0')}.json.gz`, 'old');
  const done = await runBackup({ BACKUP, ROOM }, Date.UTC(2026, 9, 11, 0, 0));
  assert.deepEqual(done, [{ key: 'backup/main/2026-10-11.json.gz', deleted: 4 }]);
  assert.equal(stored.size, 30);
  assert.ok(stored.has('backup/main/2026-10-11.json.gz'));
  assert.deepEqual(JSON.parse(gunzipSync(stored.get('backup/main/2026-10-11.json.gz'))), dump);
});

test('沒綁 R2 時明確報錯（不要悄悄略過）', async () => {
  await assert.rejects(runBackup({ ROOM: {} }), /R2/);
});
