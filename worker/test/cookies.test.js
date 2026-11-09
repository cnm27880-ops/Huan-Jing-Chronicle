// cookies.js 的獨立測試：解析與屬性（HttpOnly、Secure、SameSite、不設 Domain）
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCookies, setCookie, clearCookie } from '../src/cookies.js';

test('parseCookies：多個 cookie、空白、值裡有等號、同名取第一個、空字串與壞片段', () => {
  assert.deepEqual(parseCookies('a=1; b=2;c=3'), { a: '1', b: '2', c: '3' });
  assert.deepEqual(parseCookies('t=x=y=z'), { t: 'x=y=z' });
  assert.deepEqual(parseCookies('a=1; a=2'), { a: '1' });
  assert.deepEqual(parseCookies(''), {});
  assert.deepEqual(parseCookies(null), {});
  assert.deepEqual(parseCookies('novalue; =x; ok=1'), { ok: '1' });
});

test('setCookie：HttpOnly、Secure、SameSite=Lax、有 Path 與 Max-Age，且絕不設 Domain', () => {
  const c = setCookie('s', 'v', { path: '/auth', maxAge: 600 });
  assert.match(c, /^s=v; /);
  for (const part of ['Path=/auth', 'Max-Age=600', 'HttpOnly', 'Secure', 'SameSite=Lax']) assert.ok(c.includes(part), part);
  assert.ok(!/domain/i.test(c));
  assert.match(setCookie('s', 'v', { maxAge: 1 }), /Path=\//); // 預設根路徑
});

test('clearCookie：Max-Age=0、值空、路徑可指定', () => {
  assert.match(clearCookie('s'), /^s=; Path=\/; Max-Age=0; HttpOnly; Secure/);
  assert.match(clearCookie('s', { path: '/auth' }), /Path=\/auth; Max-Age=0/);
});
