// 存檔版本號、讀取失敗保護、寫入失敗提示（H1／H2／L20／L21）。一律用假的 localStorage，不碰任何真實存檔。
import test from 'node:test';
import assert from 'node:assert/strict';

const KEY = 'huanjing:character:v1';

function fakeStorage({ failSet = null } = {}) {
  const m = new Map();
  return {
    m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { if (failSet) throw failSet; m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}

async function fresh(storage) {
  globalThis.localStorage = storage;
  const store = await import('../src/state/store.js');
  const issue = await import('../src/state/storageIssue.js');
  issue._resetStorageIssue();
  const messages = [];
  issue.onStorageProblem((t) => messages.push(t));
  return { store, issue, messages };
}

// 一份舊格式存檔：沒有 version，也缺很多欄位
const oldSave = () => ({ name: '舊角色', gold: 123, hp: 5, inventory: {}, sortOrder: [] });

test('新存檔寫入後帶有 version', async () => {
  const st = fakeStorage();
  const { store } = await fresh(st);
  const c = store.loadCharacter();
  assert.equal(c.version, store.CURRENT_VERSION);
  assert.equal(store.saveCharacter(c), true);
  const saved = JSON.parse(st.m.get(KEY));
  assert.equal(saved.version, store.CURRENT_VERSION);
});

test('舊版存檔（無 version、缺欄位）能升級，資料保留，並被補上版本號寫回', async () => {
  const st = fakeStorage();
  st.m.set(KEY, JSON.stringify(oldSave()));
  const { store, messages } = await fresh(st);
  const c = store.loadCharacter();
  assert.equal(c.name, '舊角色');
  assert.equal(c.gold, 123);
  assert.equal(c.version, store.CURRENT_VERSION);
  assert.equal(c.migrated.version, store.CURRENT_VERSION); // 遷移記錄按版本（L20）
  assert.equal(JSON.parse(st.m.get(KEY)).version, store.CURRENT_VERSION); // 寫回了
  assert.equal(store.savedCharacterStatus(), 'ok');
  assert.equal(messages.length, 0);
});

test('同一份存檔連續載入兩次：數值不再變動（載入時不偷改）', async () => {
  const st = fakeStorage();
  st.m.set(KEY, JSON.stringify(oldSave()));
  const { store } = await fresh(st);
  const first = store.loadCharacter();
  const second = store.loadCharacter();
  assert.deepEqual(second, first);
  // 已有版本號的存檔，生命超過上限也不會在載入時被砍
  const raw = JSON.parse(st.m.get(KEY));
  raw.hp = 999999;
  st.m.set(KEY, JSON.stringify(raw));
  assert.equal(store.loadCharacter().hp, 999999);
});

test('JSON 壞掉：不覆蓋原文、另存副本、跳提示、不寫入、分得出「讀壞」與「沒存檔」', async () => {
  const st = fakeStorage();
  st.m.set(KEY, '{壞掉的存檔');
  const { store, messages } = await fresh(st);
  const c = store.loadCharacter();
  assert.ok(c.name); // 示範角色
  assert.equal(st.m.get(KEY), '{壞掉的存檔'); // 原文沒被動
  assert.equal(st.m.get(`${KEY}:corrupt`), '{壞掉的存檔'); // 另存一份
  assert.equal(store.savedCharacterStatus(), 'broken');
  assert.equal(store.hasSavedCharacter(), false);
  assert.equal(store.isLoadBroken(), true);
  assert.equal(messages.length, 1);
  assert.match(messages[0], /讀取失敗/);
  // 畫面上的示範角色存檔時不能蓋掉壞存檔
  assert.equal(store.saveCharacter(c), false);
  assert.equal(st.m.get(KEY), '{壞掉的存檔');
});

test('升級中丟錯也算讀壞：不換成示範角色後悄悄覆蓋', async () => {
  const st = fakeStorage();
  const raw = JSON.stringify({ ...oldSave(), version: 99 }); // 比網站新的版本
  st.m.set(KEY, raw);
  const { store } = await fresh(st);
  store.loadCharacter();
  assert.equal(store.savedCharacterStatus(), 'broken');
  assert.equal(st.m.get(KEY), raw);
  assert.equal(st.m.get(`${KEY}:corrupt`), raw);
});

test('完全沒存檔：狀態是 none，不跳提示', async () => {
  const st = fakeStorage();
  const { store, messages } = await fresh(st);
  store.loadCharacter();
  assert.equal(store.savedCharacterStatus(), 'none');
  assert.equal(messages.length, 0);
});

test('採用伺服器版（importCharacter）後解除寫入保護，壞存檔副本仍保留', async () => {
  const st = fakeStorage();
  st.m.set(KEY, '壞');
  const { store } = await fresh(st);
  const demo = store.loadCharacter();
  const state = store.importCharacter(demo);
  assert.equal(store.isLoadBroken(), false);
  assert.equal(JSON.parse(st.m.get(KEY)).version, state.version);
  assert.equal(st.m.get(`${KEY}:corrupt`), '壞');
});

test('容量滿：saveCharacter 回傳 false 並跳白話提示，不丟錯', async () => {
  const err = Object.assign(new Error('full'), { name: 'QuotaExceededError' });
  const st = fakeStorage({ failSet: err });
  const { store, messages } = await fresh(st);
  const c = store.loadCharacter();
  assert.equal(store.saveCharacter(c), false);
  assert.equal(messages.length, 1);
  assert.match(messages[0], /空間滿了/);
  store.saveCharacter(c); // 30 秒內不重複提示
  assert.equal(messages.length, 1);
});

test('其他寫入錯誤也有提示，不是空 catch', async () => {
  const st = fakeStorage({ failSet: new Error('boom') });
  const { store, messages } = await fresh(st);
  store.saveCharacter(store.loadCharacter());
  assert.equal(messages.length, 1);
  assert.match(messages[0], /存不進/);
});

test('多分頁：只有別的分頁改了角色存檔才提示（H3）', async () => {
  const { store } = await fresh(fakeStorage());
  assert.equal(store.isOtherTabCharacterSave({ key: KEY, newValue: '{}' }), true);
  assert.equal(store.isOtherTabCharacterSave({ key: KEY, newValue: null }), false); // 被刪除
  assert.equal(store.isOtherTabCharacterSave({ key: `${KEY}:corrupt`, newValue: 'x' }), false);
  assert.equal(store.isOtherTabCharacterSave({ key: 'huanjing:rolllog:v1', newValue: '[]' }), false);
  let called = 0;
  const handlers = {};
  const target = { addEventListener: (n, f) => { handlers[n] = f; }, removeEventListener: () => {} };
  store.watchOtherTabs(() => { called += 1; }, target);
  handlers.storage({ key: KEY, newValue: '{}' });
  handlers.storage({ key: 'other', newValue: '1' });
  assert.equal(called, 1);
});
