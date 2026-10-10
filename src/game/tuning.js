// ============================================================
// 戰鬥強度的評價、策略與自動調整（純函式，給 GM 的模擬戰面板用）。
// GM 的目標（使用者 2026-10-10 口述）：一場戰鬥 2～3 回合內結束；一次跑團約 2 場戰鬥，
// 所以每場戰鬥大約耗掉玩家一半的資源（每人的魔力、能量等資源與毒性都用掉約一半）。
// 「一半」是每一場戰鬥的消耗（兩場剛好用完）— 這是我的解讀，需向 GM 確認；改這裡的 TARGET 就能調整。
// 勝率門檻（至少 90%）是我補的，需驗證。
// ============================================================
export const TARGET = {
  roundsMin: 2, roundsMax: 3, // 平均回合數
  // 資源消耗只要「合理」就好（使用者 2026-10-10：不用一定耗到一半）。假設玩家的毒性 15 都在喝血藥，怪物可以兇一點，所以消耗落在 25～75% 都算合理
  drain: 0.5, drainTol: 0.25,
  winMin: 0.9, // 玩家勝率至少
  downMax: 0.6, // 任何一位玩家「至少倒地一次」的機率上限（我補的，需驗證）
  capWinMin: 0.85, // 第一名只出六成力時，隊伍勝率至少（公平性，我訂的，需驗證）
  topDrainMax: 0.7, // 第一名自己的資源消耗上限（不要每次都被逼著全力，需驗證）
  weakKills: 0.5, // 最弱的玩家平均至少打倒幾隻（需驗證）
  topDownRoundMin: 2, // 怪物集火第一名時，他平均至少要撐到第幾回合才倒（太早倒，團隊就少了最大的輸出；需驗證）
  outWinMin: 0.5, // 集火第一名時，第一名開場就倒，隊伍至少還要有這麼高的勝率（不要完全靠他；需驗證）
  concentrationMax: 1.6, // 受傷占生命比例最高的人，不要超過全隊平均的這麼多倍（攻擊集中打少數人，需驗證）
  battlesPerSession: 2,
};

/**
 * 自動調整的兩個方案（使用者 2026-10-10 要求「激進版／保守版」；兩邊的定義是我訂的，需向 GM 確認）。
 * 兩個方案都落在上面 TARGET 的範圍內，只是各自偏向一邊：
 *   保守版：偏輕鬆——回合偏長（2.5～3）、勝率至少 95%、倒地機率低、第一名只出六成力也要穩贏。適合新手團。
 *   激進版：偏緊繃（快攻戰）——回合偏短（2～2.5）、勝率 90% 以上、怪物攻擊兇、倒地機率可以高一些，血藥有存在感。
 */
export const PLANS = {
  conservative: { key: 'conservative', label: '保守版', note: '偏輕鬆：回合 2.5～3、勝率 95% 以上、第一名只出六成力也穩贏', roundsMin: 2.5, roundsMax: 3, drain: 0.4, drainTol: 0.15, winMin: 0.95, downMax: 0.4, capWinMin: 0.9, topDrainMax: 0.6, weakKills: 0.5, outWinMin: 0.6 },
  aggressive: { key: 'aggressive', label: '激進版', note: '偏緊繃（快攻）：回合 2～2.5、勝率 90% 以上、怪物攻擊兇、血藥有存在感', roundsMin: 2, roundsMax: 2.5, drain: 0.6, drainTol: 0.15, winMin: 0.9, downMax: 0.6, capWinMin: 0.8, topDrainMax: 0.7, weakKills: 0.5, outWinMin: 0.4 },
};

/** 判斷回合數用「打贏的場次」（沒有這欄位就用全部）；一位小數，和畫面顯示一致 */
const roundsOf = (sum) => Math.round((sum.avgRoundsWin ?? sum.avgRounds) * 10) / 10;

/** 倒地機率的最高值；怪物集火第一名時，第一名一定會倒，不算在內 */
const downMaxOf = (sum) => {
  const f = sum.focus === 'strongest' && sum.rank;
  return Math.max(0, ...(sum.downRate ?? []).filter((_, i) => !(f && i === sum.rank.strongest)).map((d) => d.rate));
};

const pct = (v) => `${Math.round(v * 100)}%`;
const fmtN = (v) => Math.round(v).toLocaleString('zh-TW');

/** 偏離目標的程度（0 = 三項都達標）；自動調整就是找讓它最小的敵人數值 */
export function penalty(sum, t = TARGET) {
  const rounds = roundsOf(sum);
  const pr = Math.max(0, t.roundsMin - rounds, rounds - t.roundsMax);
  const pc = Math.max(0, Math.abs(sum.avgDrain - t.drain) - t.drainTol) / t.drainTol;
  const pw = Math.max(0, t.winMin - sum.win) / 0.1;
  // 公平性（有跑「第一名只出部分力」的情境才算）：第一名省力隊伍也要贏、第一名自己不要被逼到見底
  const pf = sum.capWin == null ? 0 : Math.max(0, (t.capWinMin ?? TARGET.capWinMin) - sum.capWin) / 0.1;
  const top = sum.rank ? sum.perPlayer?.[sum.rank.strongest] : null;
  const pt = top ? Math.max(0, (top.drain ?? 0) - (t.topDrainMax ?? TARGET.topDrainMax)) / 0.1 : 0;
  const focusTop = sum.focus === 'strongest' && sum.rank; // 集火第一名：他一定會倒，不算「太兇」；改看他撐到第幾回合
  const downMax = downMaxOf(sum);
  const pd = Math.max(0, downMax - t.downMax) / 0.2; // 幾乎每場都有人倒地：太兇
  const topP = focusTop ? sum.perPlayer?.[sum.rank.strongest] : null;
  const ps = topP && topP.downRound > 0 ? Math.max(0, (t.topDownRoundMin ?? TARGET.topDownRoundMin) - topP.downRound) / 1 : 0;
  const po = sum.outWin == null ? 0 : Math.max(0, (t.outWinMin ?? TARGET.outWinMin) - sum.outWin) / 0.1; // 第一名倒了隊伍就贏不了：太依賴他
  return pr + pc + pw + pd + pf + pt + ps + po;
}

/**
 * 評價：每個指標一列 { key, label, value, target, status: 'ok'|'low'|'high', text }，
 * 以及策略建議 advice（文字陣列）。sum = summarize() 的結果。
 */
export function assess(sum) {
  const items = [];
  const advice = [];
  const r = roundsOf(sum);
  const dmg = sum.avgDamagePerRound;
  const hp = sum.avgMonsterHp;

  const rStatus = r < TARGET.roundsMin ? 'low' : r > TARGET.roundsMax ? 'high' : 'ok';
  items.push({
    key: 'rounds', label: '回合數', value: `${r.toFixed(1)} 回合`, target: `${TARGET.roundsMin}～${TARGET.roundsMax} 回合`, status: rStatus,
    text: { low: '太快結束，玩家來不及出幾招', ok: '剛好', high: '拖太久' }[rStatus],
  });
  // 回合數的結構下限：每位玩家每回合通常只打倒 1 隻怪，怪物比玩家多很多時，不管血量多低都要打這麼多回合
  const floor = sum.playerCount > 0 ? Math.ceil((sum.avgMonsters ?? 0) / sum.playerCount) : 0;
  if (rStatus === 'high' && floor > TARGET.roundsMax) {
    advice.push(`怪物有 ${Math.round(sum.avgMonsters)} 隻、玩家只有 ${sum.playerCount} 位：每位玩家每回合通常只能處理 1 隻，就算把血量降到很低，最快也要約 ${floor} 回合。只調血量與攻擊降不下來，要減少怪物數量（或增加玩家人數／用多目標招式），自動調整會幫你試著減少怪物。`);
  }
  if (rStatus !== 'ok' && dmg > 0 && !(rStatus === 'high' && floor > TARGET.roundsMax)) {
    const atLeast = r < 1.5 ? '至少' : '約'; // 一回合就打完時，傷害被怪物血量截斷，實際火力比算出來的更高
    advice.push(`回合數 ${r.toFixed(1)}：全隊每回合${atLeast}打出 ${fmtN(dmg)} 傷害${r < 1.5 ? '（一回合就打完，實際更高）' : ''}，想在 ${TARGET.roundsMin}～${TARGET.roundsMax} 回合打完，怪物總血量大約要 ${fmtN(dmg * TARGET.roundsMin)}～${fmtN(dmg * TARGET.roundsMax)}（現在平均 ${fmtN(hp)}）。`);
  }

  const c = sum.avgDrain;
  const cStatus = c < TARGET.drain - TARGET.drainTol ? 'low' : c > TARGET.drain + TARGET.drainTol ? 'high' : 'ok';
  const perSession = Math.min(1, c * TARGET.battlesPerSession);
  items.push({
    key: 'drain', label: '資源與毒性消耗', value: `${pct(c)}（每場）`, target: `約 ${pct(TARGET.drain)}`, status: cStatus,
    text: { low: '玩家幾乎用不到資源', ok: `剛好，${TARGET.battlesPerSession} 場約耗 ${pct(perSession)}`, high: '消耗太兇，一場就快見底' }[cStatus],
  });
  if (cStatus === 'low') advice.push(`資源消耗偏低（${pct(c)}）：怪物太弱或太快倒，玩家不用喝藥、也不用放大招。可以調高怪物攻擊強度（玩家會多喝藥、毒性上升），或增加怪物數量；但要同時注意回合數不要超過 ${TARGET.roundsMax}。`);
  if (cStatus === 'high') advice.push(`資源消耗偏高（${pct(c)}）：${TARGET.battlesPerSession} 場下來玩家會見底。調低怪物攻擊強度（少喝藥）或縮短回合數。`);
  const tox = sum.drainBy?.毒性;
  if (tox != null && tox < 0.2 && cStatus !== 'high') advice.push(`毒性只有 ${pct(tox)}：玩家不太需要喝藥。怪物攻擊強度提高一點，藥水才有存在感。`);

  const w = sum.win;
  const wStatus = w < TARGET.winMin ? 'low' : 'ok';
  items.push({
    key: 'win', label: '玩家勝率', value: pct(w), target: `至少 ${pct(TARGET.winMin)}`, status: wStatus,
    text: wStatus === 'ok' ? '安全' : '團滅風險偏高',
  });
  if (wStatus === 'low') advice.push(`勝率只有 ${pct(w)}（敗 ${pct(sum.lose)}・平手 ${pct(sum.timeout)}）：怪物太強，降低攻擊強度或血量。`);

  const downMax = downMaxOf(sum);
  if (downMax > TARGET.downMax) advice.push(`有玩家 ${pct(downMax)} 的場次會倒地：防禦弱的角色壓力很大，可以調低攻擊強度，或準備更多回復藥水。`);

  // 公平性：第一名不用全力、最弱的玩家也有貢獻
  if (sum.capWin != null && sum.rank) {
    const cw = sum.capWin;
    const cStatus2 = cw < TARGET.capWinMin ? 'low' : 'ok';
    items.push({
      key: 'capWin', label: `第一名只出 ${pct(sum.capBudget ?? 0.6)} 力時的勝率`, value: pct(cw), target: `至少 ${pct(TARGET.capWinMin)}`, status: cStatus2,
      text: cStatus2 === 'ok' ? '第一名不必全力罩隊友' : '要靠第一名全力才贏，對他不公平',
    });
    if (cStatus2 === 'low') advice.push(`第一名省力（只出 ${pct(sum.capBudget ?? 0.6)}）時勝率只剩 ${pct(cw)}：這場靠他一個人撐。降低怪物攻擊強度，或把血量集中在 BOSS、小怪壓低，讓其他人也能分擔。`);
    const top = sum.perPlayer[sum.rank.strongest];
    const tStatus = top.drain > TARGET.topDrainMax ? 'high' : 'ok';
    items.push({ key: 'topDrain', label: `第一名（${top.name}）的資源消耗`, value: pct(top.drain), target: `不超過 ${pct(TARGET.topDrainMax)}`, status: tStatus, text: tStatus === 'ok' ? '有餘裕' : '被逼著全力消耗' });
    const weak = sum.perPlayer[sum.rank.weakest];
    const wStatus2 = weak.kills < TARGET.weakKills ? 'low' : 'ok';
    items.push({
      key: 'weak', label: `最弱（${weak.name}）平均打倒`, value: `${weak.kills.toFixed(1)} 隻・輸出占 ${pct(weak.share)}`, target: `至少 ${TARGET.weakKills} 隻`, status: wStatus2,
      text: wStatus2 === 'ok' ? '有參與感' : '幾乎沒貢獻，小怪血量或防禦對他太高',
    });
    if (wStatus2 === 'low') advice.push(`最弱的 ${weak.name} 平均只打倒 ${weak.kills.toFixed(1)} 隻：小怪血量調到他一次出手能打倒的程度（自動調整會這樣做），或降低小怪防禦。`);
  }

  // 集火第一名（GM 現在的打法）：他撐到第幾回合、倒地前打出多少輸出
  if (sum.focus === 'strongest' && sum.rank && sum.perPlayer?.[sum.rank.strongest]) {
    const top = sum.perPlayer[sum.rank.strongest];
    const round = top.downRound;
    const sStatus = round > 0 && round < TARGET.topDownRoundMin ? 'low' : 'ok';
    items.push({
      key: 'topSurvive', label: `集火第一名（${top.name}）撐到`, value: round > 0 ? `第 ${round.toFixed(1)} 回合倒地（倒地機率 ${pct(top.downRate)}）・輸出占 ${pct(top.share)}` : '整場沒倒地', target: `至少第 ${TARGET.topDownRoundMin} 回合`, status: sStatus,
      text: sStatus === 'ok' ? '輸出打得出來' : '太早被集火打倒，團隊少了最大的輸出',
    });
    if (sum.outWin != null) {
      const oStatus = sum.outWin < TARGET.outWinMin ? 'low' : 'ok';
      items.push({
        key: 'outWin', label: `${top.name} 開場就倒時的勝率`, value: pct(sum.outWin), target: `至少 ${pct(TARGET.outWinMin)}`, status: oStatus,
        text: oStatus === 'ok' ? '不完全靠他' : '他一倒，隊伍就贏不了',
      });
      if (oStatus === 'low') advice.push(`${top.name} 一旦倒地，隊伍勝率只剩 ${pct(sum.outWin)}：戰鬥太依賴他的輸出。降低怪物血量或攻擊強度，或讓隊友有辦法把他拉起來（先餵藥）。`);
    }
    if (sStatus === 'low') advice.push(`怪物集火 ${top.name}：他平均第 ${round.toFixed(1)} 回合就倒，只打出全隊 ${pct(top.share)} 的輸出。降低怪物攻擊強度，或讓隊友有餘裕先餵藥／上護盾；GM 也可以別一開場就集火他。`);
  }

  // 攻擊分散：誰承受特別多（受傷總量占自己生命上限的比例，比全隊平均高很多）
  if (sum.perPlayer?.length > 1 && sum.perPlayer.some((p) => p.takenPct != null)) {
    const avgPct = sum.perPlayer.reduce((a, p) => a + p.takenPct, 0) / sum.perPlayer.length;
    const worst = sum.perPlayer.reduce((a, p) => (p.takenPct > a.takenPct ? p : a), sum.perPlayer[0]);
    const mult = avgPct > 0 ? worst.takenPct / avgPct : 1;
    const spreadStatus = mult > TARGET.concentrationMax ? 'high' : 'ok';
    items.push({
      key: 'spread', label: '受傷是否集中', value: `${worst.name} 受傷 ${pct(worst.takenPct)} 生命（全隊平均 ${pct(avgPct)}）`, target: `不超過平均的 ${TARGET.concentrationMax} 倍`, status: spreadStatus,
      text: spreadStatus === 'ok' ? '壓力分散' : `${worst.name} 承受特別多（平均的 ${mult.toFixed(1)} 倍）`,
    });
    if (spreadStatus === 'high') advice.push(`${worst.name} 受的傷是全隊平均的 ${mult.toFixed(1)} 倍：攻擊集中在他身上（防禦偏低，或被打到的次數偏多）。跑團時讓怪物輪流打不同的人，或給他更多防禦／護盾。`);
  }

  const ok = items.every((i) => i.status === 'ok');
  if (ok) advice.unshift(`這組數值符合目標：${sum.avgRounds.toFixed(1)} 回合、每場耗 ${pct(c)} 資源、勝率 ${pct(w)}。`);
  return { items, advice, ok, perSession };
}

/**
 * 自訂強度敵人的縮放：BOSS 血量乘 kh、攻擊強度乘 ka（count 為 0 的組別保留但不上場）。
 * mobHp：有 BOSS 時，小怪血量固定成這個數字（菁英 2 倍），不跟著 kh 走——小怪依最弱玩家一次出手的傷害設，BOSS 負責補回合數；沒有 BOSS 時 kh 照常縮放全部。
 */
export const scaleSpecs = (specs, kh, ka, mobHp = null) => {
  const fixMobs = mobHp != null && specs.some((s) => s.kind === 'boss' && s.count > 0);
  return specs.map((s) => {
    // 有 mobHp 時 BOSS 血量至少是小怪的 2 倍（不然 BOSS 比小怪還脆）
    const own = s.kind === 'boss' || !fixMobs ? Math.max(Math.round(s.hp * kh), s.kind === 'boss' && fixMobs ? mobHp * 2 : 1) : Math.round(mobHp * (s.kind === 'elite' ? 2 : 1));
    return { ...s, hp: Math.max(1, own), atkPower: Math.max(1, Math.round(s.atkPower * ka)) };
  });
};

/** 自訂強度：拿掉一隻怪（最後一組小怪／菁英減 1，從小怪先拿；BOSS 不動）；沒得拿回傳 null。count 變 0 的組別留著，讓前後對照的位置不變 */
export function shrinkSpecs(specs) {
  for (const kind of ['mob', 'elite']) {
    for (let i = specs.length - 1; i >= 0; i--) {
      if ((specs[i].kind ?? 'mob') === kind && specs[i].count > 0) return specs.map((s, j) => (j === i ? { ...s, count: s.count - 1 } : s));
    }
  }
  return null;
}

/** 固定敵人：拿掉最後一隻小怪（沒有小怪才拿菁英；BOSS 不動）；沒得拿回傳 null */
export function shrinkEncounter(enc) {
  const ms = enc.monsters ?? [];
  for (const pick of [(m) => m.kind !== 'boss' && m.rank !== 'elite', (m) => m.kind !== 'boss']) {
    for (let i = ms.length - 1; i >= 0; i--) if (pick(ms[i])) return { ...enc, monsters: ms.filter((_, j) => j !== i) };
  }
  return null;
}

const KH = [0.02, 6]; // 血量倍率搜尋範圍
const KA = [0.05, 8]; // 攻擊倍率搜尋範圍
const mid = (lo, hi) => Math.sqrt(lo * hi); // 倍率用對數二分

/**
 * 自動調整（重新設計 2026/10）：不再亂試倍率，而是照順序解三件事——
 *   1. 結構下限：回合數有下限（怪物數 ÷ 每回合打得死的數量），血量降到幾乎 0 還是超過目標，代表怪太多，一次拿掉一隻最弱的，直到有可能達標。
 *   2. 血量倍率：回合數隨血量單調增加，二分搜尋讓「打贏的場次」平均回合落在方案範圍的正中間。
 *   3. 攻擊倍率（外圈二分，每次內圈重新對準回合數）：攻擊越高，玩家越常喝藥、勝率越低；找到「勝率與倒地機率過關、資源消耗最接近目標」的倍率。
 * mobHp：小怪血量固定成這個數字（依最弱玩家一次出手的傷害，見 fairness.js），BOSS 血量負責補回合數。
 * evaluate(敵人, full) → summarize 的結果（full 為 false 時只需要回合數，可以省略公平性情境），必須用固定種子（同樣的敵人永遠算出同樣的結果），二分搜尋才不會被運氣干擾。
 * specs：自訂強度的敵人清單，或固定敵人 { monsters }（要一併傳 scale 與 shrink）。
 * 回傳 { specs, hpScale, atkScale, summary, penalty, removed（拿掉幾隻）, notes（給 GM 看的說明） }。
 */
export async function autoTune({
  specs, evaluate, target = TARGET, onProgress = () => {}, yieldFn = () => new Promise((res) => setTimeout(res, 0)),
  scale = scaleSpecs, shrink = shrinkSpecs, build = null, mobHp = null,
}) {
  const upon = build ? (_, kh, ka) => build(kh, ka) : (base, kh, ka) => scale(base, kh, ka, mobHp); // build：舊的呼叫方式（只縮放，不拿掉怪物）
  const canShrink = build ? () => null : shrink;
  const notes = [];
  const total = 7 * 9; // 進度：外圈 7 × 內圈 8，兩段之間有點誤差沒關係
  let done = 0;
  const run = async (base, kh, ka, full = true) => { await yieldFn(); onProgress(Math.min(0.99, ++done / total), 0); const e = upon(base, kh, ka); return evaluate(Array.isArray(e) ? e.filter((x) => x.count > 0) : e, full); };

  // 1. 結構下限：血量壓到最低、攻擊壓到最低，玩家一定贏，這時的回合數就是下限
  let base = specs;
  let removed = 0;
  const roundsMid = (target.roundsMin + target.roundsMax) / 2;
  for (let guard = 0; guard < 40; guard++) {
    const probe = await run(base, KH[0], KA[0], false);
    if (roundsOf(probe) <= target.roundsMax) break;
    const next = canShrink(base);
    if (!next) { notes.push(`怪物只剩不能拿掉的（BOSS），血量壓到最低也要 ${roundsOf(probe).toFixed(1)} 回合，超過目標 ${target.roundsMax}：可能是怪物的防禦太高（玩家打不穿），或玩家太少。`); break; }
    base = next; removed++;
  }
  if (removed) notes.push(`怪物數量太多：每位玩家每回合打不倒那麼多隻，血量再低也超過 ${target.roundsMax} 回合，所以拿掉了 ${removed} 隻最弱的怪。`);

  // 2. 血量：讓回合數落在範圍中間
  const fitHp = async (ka) => {
    let lo = KH[0]; let hi = KH[1]; let best = null;
    for (let i = 0; i < 7; i++) {
      const kh = mid(lo, hi);
      const sum = await run(base, kh, ka, false); // 只看回合數：不跑「第一名省力」的情境，省一半時間
      best = { kh, sum };
      if (roundsOf(sum) > roundsMid) hi = kh; else lo = kh;
    }
    return { kh: best.kh, sum: await run(base, best.kh, ka, true) };
  };

  // 3. 攻擊：外圈二分（太兇＝勝率不夠、倒地太多、或消耗超標 → 降；消耗不夠 → 升）
  let lo = KA[0]; let hi = KA[1];
  let bestPick = null;
  for (let i = 0; i < 7; i++) {
    const ka = mid(lo, hi);
    const { kh, sum } = await fitHp(ka);
    const pen = penalty(sum, target);
    if (!bestPick || pen < bestPick.pen - 1e-9) bestPick = { kh, ka, sum, pen };
    const downMax = downMaxOf(sum);
    const topEarly = sum.focus === 'strongest' && sum.rank && sum.perPlayer?.[sum.rank.strongest]?.downRound > 0 && sum.perPlayer[sum.rank.strongest].downRound < (target.topDownRoundMin ?? TARGET.topDownRoundMin);
    const topD = sum.rank ? sum.perPlayer?.[sum.rank.strongest]?.drain ?? 0 : 0;
    const tooHard = (sum.outWin != null && sum.outWin < (target.outWinMin ?? 0)) || topEarly || topD > (target.topDrainMax ?? 1) || sum.win < target.winMin || (sum.capWin != null && sum.capWin < (target.capWinMin ?? 0)) || downMax > target.downMax || sum.avgDrain > target.drain + target.drainTol;
    if (tooHard) hi = ka; else if (sum.avgDrain < target.drain - target.drainTol) lo = ka; else break; // 消耗落在範圍內就收工
  }

  const final = bestPick;
  if (final.pen > 0) {
    const s = final.sum;
    if (roundsOf(s) > target.roundsMax || roundsOf(s) < target.roundsMin) notes.push(`回合數只能調到 ${roundsOf(s).toFixed(1)}（目標 ${target.roundsMin}～${target.roundsMax}）。`);
    if (s.avgDrain < target.drain - target.drainTol) notes.push(`資源消耗只能到 ${pct(s.avgDrain)}：怪物再兇就會輸、或有人頻繁倒地；要多耗資源，得靠更多／更難的戰鬥，不是怪物數值能解決的。`);
    if (s.avgDrain > target.drain + target.drainTol) notes.push(`資源消耗降不到 ${pct(target.drain + target.drainTol)} 以下（現在 ${pct(s.avgDrain)}）：玩家自己打出招式就會花掉這些資源，和怪物攻擊無關。`);
    if (s.outWin != null && s.outWin < (target.outWinMin ?? 0)) notes.push(`第一名開場就倒時，隊伍勝率只有 ${pct(s.outWin)}（目標 ${pct(target.outWinMin ?? 0)}）：這場太依賴第一名的輸出。`);
    if (s.win < target.winMin) notes.push(`勝率只有 ${pct(s.win)}，攻擊已經壓到最低仍打不贏：怪物防禦或血量可能對這組玩家太高。`);
  }
  // 結果不合理就不要推薦：血量被壓到搜尋下限（像 BOSS 只剩 21 血）、或拿掉的怪超過一半，通常是輸入有問題（玩家打不出傷害、怪物防禦太高）
  const monsterTotal = (Array.isArray(specs) ? specs.reduce((a, x) => a + (x.count ?? 0), 0) : (specs.monsters ?? []).length) || 1;
  const degenerate = final.kh <= KH[0] * 1.05 || removed > monsterTotal / 2;
  if (degenerate) notes.push('這組結果不合理（血量被壓到下限，或拿掉太多怪），不建議套用：請先確認玩家的角色資料都填好了、怪物防禦不要比玩家攻擊高太多。');
  return { specs: upon(base, final.kh, final.ka), hpScale: final.kh, atkScale: final.ka, summary: final.sum, penalty: final.pen, removed, notes, degenerate };
}

/**
 * 固定敵人（場上的或預組，A/B/C 已經抽好）的縮放：血量乘 kh、每條軌道的攻擊骰數乘 ka（有骰的軌道至少 1 顆）。
 * 回傳新的 { monsters }，不改動原本的資料；BOSS 的 atk 是三種攻擊（陣列），小怪是單一份。
 */
export function scaleEncounter(enc, kh, ka, mobHp = null) {
  const fixMobs = mobHp != null && (enc.monsters ?? []).some((m) => m.kind === 'boss');
  const scaleDice = (d) => Object.fromEntries(Object.entries(d ?? {}).map(([t, v]) => [t, v > 0 ? Math.max(1, Math.round(v * ka)) : v]));
  return {
    ...enc,
    monsters: (enc.monsters ?? []).map((m) => {
      const maxHp = Math.max(1, Math.round(m.kind === 'boss' || !fixMobs ? Math.max(m.maxHp * kh, m.kind === 'boss' && fixMobs ? mobHp * 2 : 1) : mobHp * (m.rank === 'elite' ? 2 : 1)));
      return { ...m, maxHp, hp: maxHp, atk: Array.isArray(m.atk) ? m.atk.map(scaleDice) : scaleDice(m.atk) };
    }),
  };
}
