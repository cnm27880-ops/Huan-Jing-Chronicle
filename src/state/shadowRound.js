// ============================================================
// 暗影斗篷的回合推進：遭遇戰的回合數（房間伺服器的 enc.round）變了，隱身中的玩家就在新回合開始時聚集一次。
// 沒連房間時不會自動走（戰鬥頁的暗影斗篷區塊有「手動：新回合」）。規則在 src/game/shadowCloak.js。
// ============================================================
import { subscribeRoom, getEncounter, publish } from './rollLog.js';
import { advanceShadow, shadowOf } from '../game/shadowCloak.js';
import { playShadowFx } from '../ui/shadowFx.js';

export function createShadowWatcher({ getState, commit }) {
  subscribeRoom(() => {
    const state = getState();
    if (!shadowOf(state)) return; // 沒有在隱身或沒有聚集，最常見的情況
    const enc = getEncounter();
    if (!enc) return;
    const r = advanceShadow(state, enc.round ?? 0);
    if (!r) return;
    if (r.cleared) { commit(); return; } // 回合數倒退＝新的戰鬥，上一場的隱身結束
    if (r.gains.length) {
      const total = r.gains.reduce((a, g) => a + g.gain, 0);
      playShadowFx('gather', { n: total });
      publish({ who: state.name, kind: 'note', label: '暗影斗篷：回合開始聚集', lines: [`第 ${r.gains.map((g) => g.round).join('、')} 回合聚集 ${total} 點能量傷害（現在共 ${r.gathered}）`] });
    }
    if (r.ended) {
      playShadowFx('fade');
      publish({ who: state.name, kind: 'note', label: '暗影斗篷：隱身結束', lines: [`已聚集 ${r.gathered} 點，仍可現身爆發`] });
    }
    commit();
  });
}
