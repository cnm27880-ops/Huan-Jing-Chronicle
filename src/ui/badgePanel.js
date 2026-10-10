// ============================================================
// 生活徽章面板（裝備頁右欄）：神級與 500 次徽章的製作、改名、「我已經做過了」。
// 規則在 src/game/badges.js；原本在修整日的學習分頁，搬到裝備頁（徽章是裝備性質的收藏）。
// ============================================================
import { h, fmt } from './dom.js';
import { toast } from './controls.js';
import { logActivity } from '../state/activityLog.js';
import { LIFE_SKILLS } from '../game/rules.js';
import { usesSkillTable } from '../game/skillTable.js';
import { badgeStatus, craftBadge, renameBadge, markBadgeOwned, BADGE_COUNT, BADGE_NAME_MAX } from '../game/badges.js';

const LIFE_ICONS = { 採藥: '🌿', 狩獵: '🏹', 挖礦: '⛏️', 釣魚: '🎣', 調劑: '⚗️', 烹飪: '🍳', 鑄造: '🔨', 書寫: '✍️' };

/** 舊式存檔（沒用技能目錄）不能做徽章，回傳 null */
export function badgeCard({ getState, commit }) {
  const state = getState();
  if (!usesSkillTable(state)) return null;

  const done = (msg, text, skill) => { toast(msg); logActivity(getState(), { cat: 'learn', text, lines: [] }); commit(); };

  /** 一枚徽章的格子：狀態（已製作／可製作／未達成）＋ 500 次的進度條 ＋ 對應的按鈕 */
  function slot(skill, b) {
    const isGod = b.kind === '神級';
    const label = isGod ? '神級徽章' : `${BADGE_COUNT}次徽章`;
    const have = b.progress ? Math.min(b.progress.have, BADGE_COUNT) : 0;
    const stateKey = b.made ? 'made' : b.reached ? 'ready' : 'locked';
    const statusText = b.made ? '✓ 已製作' : b.reached ? '可製作' : isGod ? '未達成' : `${fmt(have)} / ${BADGE_COUNT}`;

    const rename = () => {
      const name = prompt(`幫「${b.item}」取新名字（最多 ${BADGE_NAME_MAX} 字）`, b.item);
      if (name === null) return;
      const r = renameBadge(getState(), skill, b.kind, name);
      if (!r.ok) return toast(r.error);
      done(`改名為 ${r.item}`, `徽章改名：${b.item} → ${r.item}`);
    };
    // 試算表／機器人已經加過等級的玩家：只記起來，不再加等級（背包有徽章物品的不會走到這裡，會直接算做過）
    const markOwned = () => {
      if (!confirm(`確定「${skill}」的${label}你已經做過、等級已經含它的 +1 嗎？\n按確定只會記成做過，不會再加等級，之後無法再製作這個徽章。`)) return;
      const r = markBadgeOwned(getState(), skill, b.kind);
      if (!r.ok) return toast(r.error);
      done('已記成做過，不會再加等級', `記錄已做過的徽章：${b.item}（技能等級不變）`);
    };
    const craft = () => {
      const name = prompt(`製作徽章：${skill}技能等級 +1，每種只能做一次。\n（如果你的等級已經含這個徽章的 +1，請取消，改按「記為已做過」。）\n名稱可以自己取（最多 ${BADGE_NAME_MAX} 字，之後也能改）：`, b.item);
      if (name === null) return;
      const r = craftBadge(getState(), skill, b.kind, name);
      if (!r.ok) return toast(r.error);
      done(`做出 ${r.item}，${skill}技能升到 ${r.level}`, `製作徽章：${r.item}，${skill}技能升到 ${r.level}`);
    };

    return h('div', { class: 'bslot', dataset: { state: stateKey } },
      h('div', { class: 'bslot__top' },
        h('span', { class: 'bslot__kind', text: isGod ? '神級' : `${BADGE_COUNT} 次` }),
        h('span', { class: 'bslot__status', text: statusText })),
      b.progress && !b.made ? h('div', { class: 'bslot__bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(BADGE_COUNT), 'aria-valuenow': String(have), 'aria-label': `${skill}${label}進度` },
        h('span', { style: `width:${(have / BADGE_COUNT) * 100}%` })) : null,
      b.made
        ? h('div', { class: 'bslot__made' },
            h('span', { class: 'bslot__name', title: b.item, text: b.item }),
            h('button', { type: 'button', class: 'bslot__mini', onclick: rename }, '改名'))
        : h('div', { class: 'bslot__act' },
            b.reached ? h('button', { type: 'button', class: 'btn btn--primary btn--small', onclick: craft }, `製作${label}`) : null,
            h('button', { type: 'button', class: 'bslot__mini', title: '技能等級已經含這個徽章的 +1（例如在試算表自己加過）', onclick: markOwned }, '記為已做過')));
  }

  return h('section', { class: 'card' }, h('h2', { class: 'section-title', text: '生活徽章' }),
    h('div', { class: 'badge-grid' }, LIFE_SKILLS.map((skill) => h('div', { class: 'bcard' },
      h('div', { class: 'bcard__head' },
        h('strong', { text: `${LIFE_ICONS[skill]} ${skill}` }),
        h('small', { class: 'num', text: `技能 ${state.lifeSkills[skill] ?? 0}` })),
      h('div', { class: 'bcard__slots' }, badgeStatus(state, skill).map((b) => slot(skill, b)))))));
}
