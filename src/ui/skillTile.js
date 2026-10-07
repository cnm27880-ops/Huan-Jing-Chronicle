// ============================================================
// 技能方格：三格並排的技能卡（修整日「學習」與裝備頁「技能」共用）。
// 效果文字：手機點方格打開面板看；電腦滑鼠移上去就浮動顯示（不用點）。
// ============================================================
import { h } from './dom.js';
import { SKILL_TABLE } from '../game/skillTable.js';

let tip = null;

function showTip(tile, name) {
  const t = SKILL_TABLE[name];
  if (!tip) {
    tip = h('div', { class: 'skill-tip', role: 'tooltip' });
    document.body.append(tip);
  }
  tip.replaceChildren(h('strong', { text: name }), h('p', { text: t.text }));
  tip.dataset.show = '1';
  const r = tile.getBoundingClientRect();
  const w = tip.offsetWidth;
  const hgt = tip.offsetHeight;
  const below = r.bottom + 8 + hgt <= innerHeight;
  tip.style.left = `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px`;
  tip.style.top = `${Math.max(8, below ? r.bottom + 8 : r.top - 8 - hgt)}px`;
}
const hideTip = () => { if (tip) tip.dataset.show = '0'; };

export const skillTag = (name) => {
  const t = SKILL_TABLE[name];
  return `${t.tier}・${t.kind}${t.school ? `・${t.school}` : ''}`;
};

/** 一格技能：名稱、類型、等級；footer 放額外內容（例如啟動開關） */
export function skillTile(name, { level, footer, note, onOpen }) {
  const open = () => { hideTip(); onOpen(); };
  const tile = h('div', {
    class: 'skill-tile', role: 'button', tabindex: '0', dataset: { tier: SKILL_TABLE[name].tier, learned: level ? '1' : '0' },
    'aria-label': `${name}，看效果`,
    onclick: open,
    onkeydown: (e) => { if (e.target === tile && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(); } },
    onpointerenter: (e) => { if (e.pointerType === 'mouse') showTip(tile, name); },
    onpointerleave: hideTip,
  },
  h('strong', { class: 'skill-tile__name', text: name }),
  h('small', { class: 'skill-tile__tag', text: skillTag(name) }),
  h('span', { class: 'skill-tile__lv num', text: level ? `${level} 級` : '未學會' }),
  note ? h('small', { class: 'skill-tile__note', text: note }) : null,
  footer ?? null);
  return tile;
}

/** 技能說明（面板裡用）：類型標籤＋效果全文 */
export const skillInfoBlock = (name) => h('div', { class: 'skill-info' },
  h('p', { class: 'skill-info__tag', text: skillTag(name) }),
  h('p', { class: 'skill-info__text', text: SKILL_TABLE[name].text }));
