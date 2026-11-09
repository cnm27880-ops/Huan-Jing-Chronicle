// M6：技能文字 → 自動產生招式的解析檢查。解析不到時「列出來」，不要靜靜少算加骰。
// 不改技能文字、不改數字：只回報「文字裡有『響應：…傷害骰』卻解析不出任何加骰」的技能，並把清單鎖成已知名單，
// 技能文字改版後如果清單變了，測試會失敗，提醒對照技能表逐項檢查。
import test from 'node:test';
import assert from 'node:assert/strict';
import { SKILL_TABLE } from '../src/data/skills.js';
import { generatedAttack, SKILL_CATALOG } from '../src/game/skills.js';

/** 有產生出攻擊招式、但文字裡寫了「響應：…增加…傷害骰」卻一個等級都沒解析到的技能 */
function unparsedResponses() {
  const bad = [];
  for (const [name, t] of Object.entries(SKILL_TABLE)) {
    if (SKILL_CATALOG[name]) continue; // 手寫目錄優先，不走解析
    const atk = generatedAttack(name);
    if (!atk) continue;
    const hasDiceResponse = (t.text ?? '').split('\n').some((l) => l.startsWith('響應：') && /增加\s*\d[^。]*傷害骰/.test(l));
    if (!hasDiceResponse) continue;
    const gained = [1, 5, 10].some((lv) => Object.keys(atk.extraAt(lv)).length > 0);
    if (!gained) bad.push(name);
  }
  return bad.sort();
}

test('技能響應加骰解析：解析不到的技能清單（已知名單，變動時要對照技能表）', () => {
  const bad = unparsedResponses();
  console.log(`[M6] 響應文字解析失敗的技能：${bad.length} 個${bad.length ? '：' + bad.join('、') : ''}`);
  // 2026-11-09 目前的名單：這兩個的響應是「增加 N 個『真實傷害骰』」，解析只認物理／能量／靈魂三軌，
  // 所以自動產生的招式不會加這些骰。是否另外有地方處理、實戰有沒有少算，需向 GM 確認（本測試不改任何數字）。
  // 清單變了：先對照技能表確認，再更新這裡
  const KNOWN = ['暗影刺客', '絕死詛咒'];
  assert.deepEqual(bad, KNOWN);
});

test('自動產生的招式：每個都有軌道與目標數，加骰函式不會丟錯', () => {
  let n = 0;
  for (const name of Object.keys(SKILL_TABLE)) {
    if (SKILL_CATALOG[name]) continue;
    const atk = generatedAttack(name);
    if (!atk) continue;
    n += 1;
    assert.ok(atk.tracks.length >= 1, name);
    assert.ok(atk.targets >= 1, name);
    for (let lv = 1; lv <= 10; lv++) assert.doesNotThrow(() => atk.extraAt(lv), name);
  }
  assert.ok(n > 0);
});
