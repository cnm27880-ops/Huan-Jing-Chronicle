// ============================================================
// 暗影斗篷區塊（跑團頁左欄「招式」分頁最上面；學會暗影斗篷才出現）：進入隱身、現身爆發、（沒連房間時）手動補一回合。
// 規則在 src/game/shadowCloak.js；每回合聚集由 src/state/shadowRound.js 跟著遭遇戰回合自動做。
// ============================================================
import { h } from './dom.js';
import { toast } from './controls.js';
import { playShadowFx } from './shadowFx.js';
import { battleSel as sel } from './battleSelect.js';
import { publish, getEncounter } from '../state/rollLog.js';
import { moveFromCatalog, skillLevel } from '../game/skills.js';
import { isDowned } from '../game/combat.js';
import { SHADOW_SKILL, STEALTH_ROUNDS, STEALTH_COST, enterStealth, manualRound, shadowOf, gainPerRound, isHidden } from '../game/shadowCloak.js';
import { costText } from '../game/resources.js';

/** 目前遭遇戰回合：房間裡看伺服器的，沒連房間就是 0 */
export const currentRound = () => getEncounter()?.round ?? 0;

export function cloakCard(state, { commit }) {
  if (skillLevel(state, SHADOW_SKILL) < 1) return null;
  const sh = shadowOf(state);
  const hidden = isHidden(state);
  const online = getEncounter() !== null;

  const enter = () => {
    const r = enterStealth(state, currentRound());
    if (r.error) return toast(r.error);
    playShadowFx('enter');
    publish({ who: state.name, kind: 'note', label: '暗影斗篷：進入隱身', lines: [`花費 ${costText(STEALTH_COST)}`, `立刻聚集 ${r.gain} 點能量傷害（現在共 ${r.gathered}）`, `隱身 ${STEALTH_ROUNDS} 回合：無法被優先指定、無法使用其他攻擊`] });
    commit();
  };
  const reveal = () => {
    let m = state.moves.find((x) => x.skill === SHADOW_SKILL);
    if (!m) { m = { ...moveFromCatalog(SHADOW_SKILL), id: `m${Date.now().toString(36)}`, name: '暗影斗篷・現身' }; state.moves.push(m); }
    sel.moveId = m.id;
    toast('已選好「現身」招式，選目標後在中間按出招。');
    commit();
  };
  const manual = () => {
    const r = manualRound(state);
    if (!r) return;
    if (r.gains.length) {
      playShadowFx('gather', { n: r.gains[0].gain });
      publish({ who: state.name, kind: 'note', label: '暗影斗篷：回合開始聚集', lines: [`聚集 ${r.gains[0].gain} 點能量傷害（現在共 ${r.gathered}）`] });
    } else if (r.ended) { playShadowFx('fade'); publish({ who: state.name, kind: 'note', label: '暗影斗篷：隱身結束', lines: [`已聚集 ${r.gathered} 點，仍可現身爆發`] }); }
    commit();
  };

  return h('section', { class: `card cloak${hidden ? ' is-hidden' : ''}` },
    h('h2', { class: 'section-title', text: `🌑 暗影斗篷 Lv${skillLevel(state, SHADOW_SKILL)}` }),
    h('p', { class: 'hint', text: `每次聚集 ${gainPerRound(state)} 點能量傷害（2 + 等級÷2）。進入隱身花 ${costText(STEALTH_COST)}，立刻聚集一次，之後遭遇戰每個新回合開始再聚集（最多 ${STEALTH_ROUNDS} 回合）；隱身中無法被優先指定、不能用其他攻擊。` }),
    sh
      ? h('p', { class: 'cloak__now', text: hidden ? `隱身中：第 ${sh.rounds}／${STEALTH_ROUNDS} 回合・已聚集 +${sh.gathered} 能量傷害` : `隱身結束：已聚集 +${sh.gathered} 能量傷害，還可以現身爆發` })
      : null,
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn btn--primary btn--small', disabled: hidden || isDowned(state), onclick: enter }, `進入隱身（${costText(STEALTH_COST)}）`),
      h('button', { type: 'button', class: 'btn btn--small', disabled: !sh || isDowned(state), onclick: reveal }, '現身爆發（選招式）'),
      !online && hidden ? h('button', { type: 'button', class: 'btn btn--ghost btn--small', title: '沒連上房間時，用這個自己算一個新回合', onclick: manual }, '手動：新回合') : null));
}
