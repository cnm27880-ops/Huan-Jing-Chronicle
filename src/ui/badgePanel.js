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
  return h('section', { class: 'card' }, h('h2', { class: 'section-title', text: '生活徽章' }),
    h('ul', { class: 'badge-list' }, LIFE_SKILLS.map((skill) => h('li', { class: 'badge-row' },
      h('strong', { text: `${LIFE_ICONS[skill]} ${skill}　技能 ${state.lifeSkills[skill] ?? 0}` }),
      h('div', { class: 'badge-row__btns' }, badgeStatus(state, skill).map((b) => {
        const label = b.kind === '神級' ? '神級徽章' : `${BADGE_COUNT}次徽章（${fmt(Math.min(b.progress.have, BADGE_COUNT))}/${BADGE_COUNT}）`;
        if (b.made) {
          return h('div', { class: 'badge-made' },
            h('span', { class: 'badge-made__name', text: `✓ ${b.item}` }),
            h('button', {
              type: 'button', class: 'btn btn--ghost btn--small',
              onclick: () => {
                const name = prompt(`幫「${b.item}」取新名字（最多 ${BADGE_NAME_MAX} 字）`, b.item);
                if (name === null) return;
                const r = renameBadge(getState(), skill, b.kind, name);
                if (!r.ok) return toast(r.error);
                toast(`改名為 ${r.item}`);
                logActivity(getState(), { cat: 'learn', text: `徽章改名：${b.item} → ${r.item}`, lines: [] });
                commit();
              },
            }, '改名'));
        }
        // 試算表／機器人已經加過等級的玩家：只記起來，不再加等級（背包有徽章物品的不會走到這裡，會直接算做過）
        const owned = h('button', {
          type: 'button', class: 'btn btn--ghost btn--small', title: '技能等級已經含這個徽章的 +1（例如在試算表自己加過）',
          onclick: () => {
            if (!confirm(`確定「${skill}」的${label.split('（')[0]}你已經做過、等級已經含它的 +1 嗎？\n按確定只會記成做過，不會再加等級，之後無法再製作這個徽章。`)) return;
            const r = markBadgeOwned(getState(), skill, b.kind);
            if (!r.ok) return toast(r.error);
            toast('已記成做過，不會再加等級');
            logActivity(getState(), { cat: 'learn', text: `記錄已做過的徽章：${b.item}（技能等級不變）`, lines: [] });
            commit();
          },
        }, '我已經做過了');
        const craftBtn = b.reached
          ? h('button', {
              type: 'button', class: 'btn btn--primary btn--small',
              onclick: () => {
                const name = prompt(`製作徽章：${skill}技能等級 +1，每種只能做一次。\n（如果你的等級已經含這個徽章的 +1，請取消，改按「我已經做過了」。）\n名稱可以自己取（最多 ${BADGE_NAME_MAX} 字，之後也能改）：`, b.item);
                if (name === null) return;
                const r = craftBadge(getState(), skill, b.kind, name);
                if (!r.ok) return toast(r.error);
                toast(`做出 ${r.item}，${skill}技能升到 ${r.level}`);
                logActivity(getState(), { cat: 'learn', text: `製作徽章：${r.item}，${skill}技能升到 ${r.level}`, lines: [] });
                commit();
              },
            }, `製作${label}`)
          : h('button', { type: 'button', class: 'btn btn--small', disabled: true }, `${label} 未達成`);
        return h('div', { class: 'badge-cell' }, craftBtn, owned);
      }))))));
}
