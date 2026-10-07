// ============================================================
// 登入 API（階段 1-A）：和 Cloudflare Worker 講話的唯一地方。
// 原則：任何失敗（沒網路、API 連不上、逾時）都當作「未登入」，網站照常以單機試玩運作，絕不丟錯。
// ============================================================
export const API_BASE = 'https://huan-jing-api.yuci8660.uk';
const TIMEOUT_MS = 4000;

const LOGIN_MESSAGES = {
  state: '登入驗證失敗（可能逾時），請再試一次。',
  cancelled: '已取消 Discord 登入。',
  denied: '這個 Discord 帳號不在允許名單內。',
  error: '登入時發生錯誤，請稍後再試。',
};

async function request(path, init = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(API_BASE + path, { credentials: 'include', signal: ctrl.signal, ...init });
  } finally {
    clearTimeout(timer);
  }
}

/** 回傳 { id, name, avatarUrl }；未登入或連不上回 null */
export async function getCurrentUser() {
  try {
    const res = await request('/auth/me');
    if (!res.ok) return null;
    const { user } = await res.json();
    if (!user || typeof user.id !== 'string' || typeof user.name !== 'string') return null;
    const avatarUrl = typeof user.avatarUrl === 'string' && user.avatarUrl.startsWith('https://cdn.discordapp.com/')
      ? user.avatarUrl : null;
    return { id: user.id, name: user.name, avatarUrl };
  } catch {
    return null;
  }
}

export const loginUrl = () => `${API_BASE}/auth/login`;

/** 登出；回傳是否成功（失敗時前端維持原狀） */
export async function logout() {
  try {
    const res = await request('/auth/logout', { method: 'POST' });
    return res.ok;
  } catch {
    return false;
  }
}

/** 讀取登入完成後導回網址上的 ?login=…，並把它從網址列拿掉。回傳要顯示的提示文字或 null */
export function consumeLoginResult() {
  try {
    const url = new URL(location.href);
    const result = url.searchParams.get('login');
    if (!result) return null;
    url.searchParams.delete('login');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
    return LOGIN_MESSAGES[result] ?? null;
  } catch {
    return null;
  }
}
