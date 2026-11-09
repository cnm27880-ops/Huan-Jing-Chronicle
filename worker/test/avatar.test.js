// avatar.js 的獨立測試：自訂頭像網址與預設頭像（依 Discord ID 分 6 種）
import test from 'node:test';
import assert from 'node:assert/strict';
import { avatarUrl } from '../src/avatar.js';

test('有自訂頭像：用 Discord CDN 的 png（128px）', () => {
  assert.equal(avatarUrl({ id: '42', avatar: 'abc123' }), 'https://cdn.discordapp.com/avatars/42/abc123.png?size=128');
});

test('沒有自訂頭像：用預設頭像，編號 = (id >> 22) % 6，涵蓋 0～5', () => {
  const seen = new Set();
  for (let i = 0; i < 6; i++) {
    const id = String(BigInt(i) << 22n);
    assert.equal(avatarUrl({ id, avatar: null }), `https://cdn.discordapp.com/embed/avatars/${i}.png`);
    seen.add(i);
  }
  assert.equal(seen.size, 6);
  assert.equal(avatarUrl({ id: String((6n << 22n) + 5n), avatar: '' }), 'https://cdn.discordapp.com/embed/avatars/0.png'); // 超過 6 繞回
});

test('很大的 Discord ID（超過 JS 安全整數）也能算', () => {
  assert.match(avatarUrl({ id: '693348255706251284', avatar: null }), /embed\/avatars\/[0-5]\.png$/);
});
