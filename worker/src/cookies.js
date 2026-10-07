// Cookie 小工具。一律 HttpOnly + Secure + SameSite=Lax，且「不設 Domain」（host-only：
// 只有 huan-jing-api.yuci8660.uk 自己讀得到，st.yuci8660.uk 等其他子網域讀不到）。
export function parseCookies(header) {
  const out = {};
  for (const part of (header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k && !(k in out)) out[k] = part.slice(i + 1).trim();
  }
  return out;
}

export function setCookie(name, value, { path = '/', maxAge }) {
  return `${name}=${value}; Path=${path}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearCookie(name, { path = '/' } = {}) {
  return setCookie(name, '', { path, maxAge: 0 });
}
