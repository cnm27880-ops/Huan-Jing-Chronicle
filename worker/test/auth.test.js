// 執行方式：在專案根目錄 npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { isAllowed } from '../src/index.js';
import { signToken, verifyToken } from '../src/crypto.js';

const SITE = 'https://huan-jing.yuci8660.uk';
const API = 'https://huan-jing-api.yuci8660.uk';
const env = {
  SITE_ORIGIN: SITE,
  DISCORD_CLIENT_ID: '111',
  DISCORD_CLIENT_SECRET: 'client-secret-xyz',
  DISCORD_REDIRECT_URI: `${API}/auth/callback`,
  DISCORD_ALLOWED_IDS: '',
  SESSION_SECRET: 'test-session-secret',
};
const call = (path, init = {}, e = env) => worker.fetch(new Request(API + path, init), e);
const cookieOf = (res, name) => {
  const line = res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
  return line ? line.split(';')[0].slice(name.length + 1) : null;
};

// 假的 Discord：回傳指定使用者，並記錄呼叫
function mockDiscord(user, { tokenOk = true } = {}) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/oauth2/token')) {
      return tokenOk ? Response.json({ access_token: 'AT-secret', token_type: 'Bearer' }) : new Response('no', { status: 400 });
    }
    return Response.json(user);
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}

async function startLogin() {
  const res = await call('/auth/login');
  const loc = new URL(res.headers.get('Location'));
  return { res, loc, state: loc.searchParams.get('state'), stateCookie: cookieOf(res, 'hj_state') };
}

async function fullLogin(user, e = env) {
  const { state, stateCookie } = await startLogin();
  const d = mockDiscord(user);
  try {
    const res = await call(`/auth/callback?code=abc&state=${state}`, { headers: { Cookie: `hj_state=${stateCookie}` } }, e);
    return { res, d };
  } finally { d.restore(); }
}

test('/health 回 ok', async () => {
  const res = await call('/health');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'ok' });
});

test('/auth/login：導向 Discord，scope 只有 identify，state 與 cookie 對應', async () => {
  const { res, loc, state, stateCookie } = await startLogin();
  assert.equal(res.status, 302);
  assert.equal(loc.origin + loc.pathname, 'https://discord.com/api/oauth2/authorize');
  assert.equal(loc.searchParams.get('scope'), 'identify');
  assert.equal(loc.searchParams.get('client_id'), '111');
  assert.equal(loc.searchParams.get('redirect_uri'), env.DISCORD_REDIRECT_URI);
  assert.ok(state && stateCookie);
  assert.ok(!res.headers.get('Location').includes('client-secret-xyz'));
});

test('cookie 屬性：HttpOnly、Secure、SameSite=Lax，且不設 Domain', async () => {
  const { res } = await startLogin();
  const login = await fullLogin({ id: '42', username: 'fude', avatar: null });
  for (const line of [...res.headers.getSetCookie(), ...login.res.headers.getSetCookie()]) {
    assert.match(line, /HttpOnly/);
    assert.match(line, /Secure/);
    assert.match(line, /SameSite=Lax/);
    assert.doesNotMatch(line, /Domain=/i);
  }
});

test('登入成功：設 session cookie、導回網站、不保存 access token', async () => {
  const { res, d } = await fullLogin({ id: '42', username: 'fude', global_name: '福德', avatar: 'abc123' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('Location'), `${SITE}/?login=ok`);
  const session = cookieOf(res, 'hj_session');
  assert.ok(session);
  assert.ok(!res.headers.getSetCookie().join('\n').includes('AT-secret'));
  assert.ok(!session.includes('AT-secret'));
  assert.ok(d.calls.some((c) => c.url.endsWith('/oauth2/token')));

  const meRes = await call('/auth/me', { headers: { Cookie: `hj_session=${session}`, Origin: SITE } });
  const body = await meRes.json();
  assert.equal(body.user.id, '42');
  assert.equal(body.user.name, '福德');
  assert.equal(body.user.avatarUrl, 'https://cdn.discordapp.com/avatars/42/abc123.png?size=128');
  assert.ok(!JSON.stringify(body).includes('AT-secret'));
});

test('沒有自訂頭像時使用 Discord 預設頭像', async () => {
  const { res } = await fullLogin({ id: '42', username: 'fude', avatar: null });
  const meRes = await call('/auth/me', { headers: { Cookie: `hj_session=${cookieOf(res, 'hj_session')}` } });
  assert.match((await meRes.json()).user.avatarUrl, /^https:\/\/cdn\.discordapp\.com\/embed\/avatars\/\d\.png$/);
});

test('未登入：/auth/me 回 user: null', async () => {
  const body = await (await call('/auth/me')).json();
  assert.deepEqual(body, { user: null });
});

test('簽名被竄改：視為未登入', async () => {
  const { res } = await fullLogin({ id: '42', username: 'fude', avatar: null });
  const [body, sig] = cookieOf(res, 'hj_session').split('.');
  // 改 payload 成別人的 id，沿用舊簽名
  const forged = Buffer.from(JSON.stringify({ uid: '999', name: 'evil', avatar: null, exp: Date.now() + 1e9 })).toString('base64url');
  for (const bad of [`${forged}.${sig}`, `${body}.${sig.slice(0, -2)}AA`, `${body}.`, 'garbage', `${body}.${sig}.x`]) {
    const out = await (await call('/auth/me', { headers: { Cookie: `hj_session=${bad}` } })).json();
    assert.equal(out.user, null, bad);
  }
});

test('用別的密鑰簽的 session 無效', async () => {
  const token = await signToken({ uid: '42', name: 'x', avatar: null, exp: Date.now() + 1e6 }, 'other-secret');
  const out = await (await call('/auth/me', { headers: { Cookie: `hj_session=${token}` } })).json();
  assert.equal(out.user, null);
});

test('session 過期：視為未登入', async () => {
  const token = await signToken({ uid: '42', name: 'x', avatar: null, exp: Date.now() - 1000 }, env.SESSION_SECRET);
  const out = await (await call('/auth/me', { headers: { Cookie: `hj_session=${token}` } })).json();
  assert.equal(out.user, null);
  assert.deepEqual(await verifyToken(await signToken({ exp: 1000 }, "s"), "s", 999), { exp: 1000 });
  assert.equal(await verifyToken(await signToken({ exp: 1000 }, 's'), 's', 1000), null);
});

test('state 不符：不呼叫 Discord，導回 login=state', async () => {
  const { stateCookie } = await startLogin();
  const d = mockDiscord({ id: '42', username: 'fude' });
  try {
    const res = await call('/auth/callback?code=abc&state=WRONG', { headers: { Cookie: `hj_state=${stateCookie}` } });
    assert.equal(res.headers.get('Location'), `${SITE}/?login=state`);
    assert.equal(d.calls.length, 0);
    assert.equal(cookieOf(res, 'hj_session'), null);
  } finally { d.restore(); }
});

test('沒有 state cookie 或 state cookie 被竄改或過期：拒絕', async () => {
  const { state, stateCookie } = await startLogin();
  const expired = await signToken({ n: state, exp: Date.now() - 1 }, env.SESSION_SECRET);
  const [b, s] = stateCookie.split('.');
  const tampered = `${Buffer.from(JSON.stringify({ n: 'attacker', exp: Date.now() + 1e6 })).toString('base64url')}.${s}`;
  for (const [cookie, qs] of [[null, state], [expired, state], [tampered, 'attacker'], [`${b}.`, state]]) {
    const d = mockDiscord({ id: '42', username: 'fude' });
    try {
      const res = await call(`/auth/callback?code=abc&state=${qs}`, { headers: cookie ? { Cookie: `hj_state=${cookie}` } : {} });
      assert.equal(res.headers.get('Location'), `${SITE}/?login=state`);
      assert.equal(d.calls.length, 0);
    } finally { d.restore(); }
  }
});

test('使用者在 Discord 取消授權', async () => {
  const res = await call('/auth/callback?error=access_denied');
  assert.equal(res.headers.get('Location'), `${SITE}/?login=cancelled`);
});

test('Discord 換 token 失敗：導回 login=error，沒有 session', async () => {
  const { state, stateCookie } = await startLogin();
  const d = mockDiscord({}, { tokenOk: false });
  try {
    const res = await call(`/auth/callback?code=abc&state=${state}`, { headers: { Cookie: `hj_state=${stateCookie}` } });
    assert.equal(res.headers.get('Location'), `${SITE}/?login=error`);
    assert.equal(cookieOf(res, 'hj_session'), null);
  } finally { d.restore(); }
});

test('白名單：空 = 不限制；有名單時只放行名單內', async () => {
  assert.equal(isAllowed({ DISCORD_ALLOWED_IDS: '' }, '1'), true);
  assert.equal(isAllowed({ DISCORD_ALLOWED_IDS: ' , ' }, '1'), true);
  assert.equal(isAllowed({ DISCORD_ALLOWED_IDS: '1, 2' }, '2'), true);
  assert.equal(isAllowed({ DISCORD_ALLOWED_IDS: '1, 2' }, '3'), false);

  const e = { ...env, DISCORD_ALLOWED_IDS: '42' };
  const okLogin = await fullLogin({ id: '42', username: 'a' }, e);
  assert.equal(okLogin.res.headers.get('Location'), `${SITE}/?login=ok`);
  const denied = await fullLogin({ id: '43', username: 'b' }, e);
  assert.equal(denied.res.headers.get('Location'), `${SITE}/?login=denied`);
  assert.equal(cookieOf(denied.res, 'hj_session'), null);

  // 先登入、之後名單收緊：舊 session 也失效
  const token = cookieOf(okLogin.res, 'hj_session');
  const tight = { ...env, DISCORD_ALLOWED_IDS: '7' };
  const out = await (await call('/auth/me', { headers: { Cookie: `hj_session=${token}` } }, tight)).json();
  assert.equal(out.user, null);
});

test('CORS：網站來源帶 credentials；其他來源沒有 CORS 標頭', async () => {
  const ok = await call('/auth/me', { headers: { Origin: SITE } });
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), SITE);
  assert.equal(ok.headers.get('Access-Control-Allow-Credentials'), 'true');
  assert.match(ok.headers.get('Vary'), /Origin/);

  for (const origin of ['https://evil.example', 'https://st.yuci8660.uk', 'http://huan-jing.yuci8660.uk', 'null']) {
    const res = await call('/auth/me', { headers: { Origin: origin } });
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), null, origin);
    assert.equal(res.headers.get('Access-Control-Allow-Credentials'), null, origin);
  }
  const pre = await call('/auth/logout', { method: 'OPTIONS', headers: { Origin: SITE, 'Access-Control-Request-Method': 'POST' } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('Access-Control-Allow-Origin'), SITE);
  assert.equal(pre.headers.get('Access-Control-Allow-Credentials'), 'true');
  const badPre = await call('/auth/logout', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } });
  assert.equal(badPre.headers.get('Access-Control-Allow-Origin'), null);
});

test('登出：只接受網站來源的 POST，並清除 session cookie', async () => {
  const bad = await call('/auth/logout', { method: 'POST', headers: { Origin: 'https://evil.example' } });
  assert.equal(bad.status, 403);
  assert.equal((await call('/auth/logout', { method: 'POST' })).status, 403);
  assert.equal((await call('/auth/logout')).status, 405);

  const res = await call('/auth/logout', { method: 'POST', headers: { Origin: SITE } });
  assert.equal(res.status, 200);
  assert.match(res.headers.getSetCookie()[0], /^hj_session=; .*Max-Age=0/);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), SITE);
});

test('缺少 Secrets：回 500 server_misconfigured，不洩漏內容', async () => {
  const res = await call('/auth/login', {}, { ...env, DISCORD_CLIENT_SECRET: undefined });
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: 'server_misconfigured' });
  assert.equal((await call('/health', {}, {})).status, 200);
});

test('未知路徑 404', async () => {
  assert.equal((await call('/nope')).status, 404);
});

// ---------- 滑動續期（30 天有效、剩 15 天內換發、90 天上限） ----------
const DAY = 24 * 3600 * 1000;
const sessionToken = (iatAgoDays, expInDays) => signToken({
  uid: '42', name: 'x', avatar: null, iat: Date.now() - iatAgoDays * DAY, exp: Date.now() + expInDays * DAY,
}, env.SESSION_SECRET);
const meWith = (token, e = env) => call('/auth/me', { headers: { Cookie: `hj_session=${token}` } }, e);
const maxAgeDays = (res) => Number(/Max-Age=(\d+)/.exec(res.headers.getSetCookie()[0])[1]) / 86400;

test('登入簽發的 session 有效期 30 天，並記錄原始登入時間', async () => {
  const { res } = await fullLogin({ id: '42', username: 'a' });
  assert.match(res.headers.getSetCookie().find((c) => c.startsWith('hj_session=')), /Max-Age=2592000/);
  const payload = await verifyToken(cookieOf(res, 'hj_session'), env.SESSION_SECRET);
  assert.ok(Math.abs(payload.iat - Date.now()) < 5000);
  assert.ok(Math.abs(payload.exp - payload.iat - 30 * DAY) < 1000);
});

test('續期門檻：剩 16 天不換發；剩 14 天換發新 30 天 token 且保留原始登入時間', async () => {
  const before = await meWith(await sessionToken(14, 16));
  assert.equal((await before.json()).user.id, '42');
  assert.equal(before.headers.getSetCookie().length, 0);

  const old = await sessionToken(16, 14);
  const res = await meWith(old);
  assert.equal((await res.json()).user.id, '42');
  const line = res.headers.getSetCookie()[0];
  assert.match(line, /^hj_session=/);
  assert.match(line, /HttpOnly/); assert.match(line, /Secure/); assert.match(line, /SameSite=Lax/);
  assert.doesNotMatch(line, /Domain=/i);
  assert.ok(Math.abs(maxAgeDays(res) - 30) < 0.01);

  const renewed = await verifyToken(cookieOf(res, 'hj_session'), env.SESSION_SECRET);
  const original = await verifyToken(old, env.SESSION_SECRET);
  assert.equal(renewed.iat, original.iat);
  assert.ok(renewed.exp - Date.now() > 29.9 * DAY);
  // 新 token 本身可以繼續使用
  assert.equal((await (await meWith(cookieOf(res, 'hj_session'))).json()).user.id, '42');
});

test('90 天上限：到期日不超過原始登入 + 90 天；已達上限就不再續期', async () => {
  // 原始登入 80 天前，剩 10 天 → 只能續到第 90 天（剩 10 天），沒有可延長的空間 → 不換發
  const edge = await meWith(await sessionToken(80, 10));
  assert.equal((await edge.json()).user.id, '42');
  assert.equal(edge.headers.getSetCookie().length, 0);

  // 原始登入 70 天前，剩 5 天 → 換發，但新到期日封頂在第 90 天（約再 20 天）
  const capped = await meWith(await sessionToken(70, 5));
  assert.ok(Math.abs(maxAgeDays(capped) - 20) < 0.01);
  const payload = await verifyToken(cookieOf(capped, 'hj_session'), env.SESSION_SECRET);
  assert.ok(payload.exp - payload.iat <= 90 * DAY);

  // 原始登入超過 90 天（token 已過期）→ 未登入，必須重新登入
  const expired = await meWith(await sessionToken(91, -1));
  assert.equal((await expired.json()).user, null);
  assert.equal(expired.headers.getSetCookie().length, 0);
});

test('沒有原始登入時間的舊 token 不續期', async () => {
  const token = await signToken({ uid: '42', name: 'x', avatar: null, exp: Date.now() + 2 * DAY }, env.SESSION_SECRET);
  const res = await meWith(token);
  assert.equal((await res.json()).user.id, '42');
  assert.equal(res.headers.getSetCookie().length, 0);
});

test('每次 /auth/me 都重查白名單：未到期的 session 被移出名單即失效，且不續期', async () => {
  const e = { ...env, DISCORD_ALLOWED_IDS: '42' };
  const token = await sessionToken(16, 14); // 需要續期的 session
  assert.equal((await (await meWith(token, e)).json()).user.id, '42');

  const removed = await meWith(token, { ...env, DISCORD_ALLOWED_IDS: '7,8' });
  assert.equal((await removed.json()).user, null);
  assert.equal(removed.headers.getSetCookie().length, 0);

  // 名單清空 = 不限制，又恢復可用
  assert.equal((await (await meWith(token, { ...env, DISCORD_ALLOWED_IDS: '' })).json()).user.id, '42');
});
