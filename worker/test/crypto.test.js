// crypto.js 的獨立測試：簽名產生與驗證、竄改、過期、base64url
import test from 'node:test';
import assert from 'node:assert/strict';
import { signToken, verifyToken, randomToken, b64urlEncode, b64urlDecode } from '../src/crypto.js';

const SECRET = 'unit-test-secret';
const future = () => Date.now() + 60_000;

test('簽出的 token 可以驗證並取回內容', async () => {
  const t = await signToken({ uid: '1', exp: future() }, SECRET);
  const p = await verifyToken(t, SECRET);
  assert.equal(p.uid, '1');
  assert.match(t, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
});

test('換密鑰、竄改內容、竄改簽名都驗證失敗', async () => {
  const t = await signToken({ uid: '1', exp: future() }, SECRET);
  assert.equal(await verifyToken(t, 'other-secret'), null);
  const [body, sig] = t.split('.');
  const forged = b64urlEncode(new TextEncoder().encode(JSON.stringify({ uid: '2', exp: future() })));
  assert.equal(await verifyToken(`${forged}.${sig}`, SECRET), null);
  assert.equal(await verifyToken(`${body}.${sig.slice(0, -2)}AA`, SECRET), null);
});

test('已過期、沒有 exp、格式不對、非字串一律回 null', async () => {
  assert.equal(await verifyToken(await signToken({ uid: '1', exp: 1000 }, SECRET), SECRET, 2000), null);
  assert.equal(await verifyToken(await signToken({ uid: '1' }, SECRET), SECRET), null);
  for (const bad of ['', 'abc', 'a.b.c', 'a.', '.b', 123, null, undefined, {}]) assert.equal(await verifyToken(bad, SECRET), null);
});

test('base64url：來回一致，不合法字元丟錯', () => {
  const bytes = Uint8Array.from([0, 1, 250, 251, 252, 253, 254, 255]);
  assert.deepEqual([...b64urlDecode(b64urlEncode(bytes))], [...bytes]);
  assert.ok(!/[+/=]/.test(b64urlEncode(bytes)));
  assert.throws(() => b64urlDecode('a+b'));
});

test('randomToken：長度對、每次不同', () => {
  const a = randomToken(16); const b = randomToken(16);
  assert.notEqual(a, b);
  assert.equal(b64urlDecode(a).length, 16);
  assert.equal(b64urlDecode(randomToken(32)).length, 32);
});
