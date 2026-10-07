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
