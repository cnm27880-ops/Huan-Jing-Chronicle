// ============================================================
// 戰鬥強度的評價、策略與自動調整（純函式，給 GM 的模擬戰面板用）。
// GM 的目標（使用者 2026-10-10 口述）：一場戰鬥 2～3 回合內結束；一次跑團約 2 場戰鬥，
// 所以每場戰鬥大約耗掉玩家一半的資源（每人的魔力、能量等資源與毒性都用掉約一半）。
// 「一半」是每一場戰鬥的消耗（兩場剛好用完）— 這是我的解讀，需向 GM 確認；改這裡的 TARGET 就能調整。
// 勝率門檻（至少 90%）是我補的，需驗證。
// ============================================================
export const TARGET = {
  roundsMin: 2, roundsMax: 3, // 平均回合數
  drain: 0.5, drainTol: 0.1, // 每場資源與毒性消耗比例：0.4～0.6 算剛好
  winMin: 0.9, // 玩家勝率至少
  downMax: 0.6, // 任何一位玩家「至少倒地一次」的機率上限（我補的，需驗證）
  battlesPerSession: 2,
};

/**
 * 自動調整的兩個方案（使用者 2026-10-10 要求「激進版／保守版」；兩邊的定義是我訂的，需向 GM 確認）。
 * 兩個方案都落在上面 TARGET 的範圍內，只是各自偏向一邊：
 *   保守版：偏輕鬆——回合偏長（2.5～3）、每場耗約 45%、勝率至少 95%、倒地機率低。玩家有餘裕，適合新手團或想讓玩家放大招爽打。
 *   激進版：偏緊繃——回合偏短（2～2.5）、每場耗約 55%、勝率至少 90%、倒地機率可以高一些。玩家要精打細算、藥水有存在感。
 */
export const PLANS = {
  conservative: { key: 'conservative', label: '保守版', note: '偏輕鬆：回合 2.5～3、每場耗約 45%、勝率 95% 以上', roundsMin: 2.5, roundsMax: 3, drain: 0.45, drainTol: 0.05, winMin: 0.95, downMax: 0.4 },
  aggressive: { key: 'aggressive', label: '激進版', note: '偏緊繃：回合 2～2.5、每場耗約 55%、勝率 90% 以上', roundsMin: 2, roundsMax: 2.5, drain: 0.55, drainTol: 0.05, winMin: 0.9, downMax: 0.6 },
};

const pct = (v) => `${Math.round(v * 100)}%`;
const fmtN = (v) => Math.round(v).toLocaleString('zh-TW');

/** 偏離目標的程度（0 = 三項都達標）；自動調整就是找讓它最小的敵人數值 */
export function penalty(sum, t = TARGET) {
  const rounds = Math.round(sum.avgRounds * 10) / 10; // 和畫面顯示的一位小數一致
  const pr = Math.max(0, t.roundsMin - rounds, rounds - t.roundsMax);
  const pc = Math.max(0, Math.abs(sum.avgDrain - t.drain) - t.drainTol) / t.drainTol;
  const pw = Math.max(0, t.winMin - sum.win) / 0.1;
  const downMax = Math.max(0, ...(sum.downRate ?? []).map((d) => d.rate));
  const pd = Math.max(0, downMax - t.downMax) / 0.2; // 幾乎每場都有人倒地：太兇
  return pr + pc + pw + pd;
}

/**
 * 評價：每個指標一列 { key, label, value, target, status: 'ok'|'low'|'high', text }，
 * 以及策略建議 advice（文字陣列）。sum = summarize() 的結果。
 */
export function assess(sum) {
  const items = [];
  const advice = [];
  const r = Math.round(sum.avgRounds * 10) / 10; // 以畫面顯示的一位小數判斷
  const dmg = sum.avgDamagePerRound;
  const hp = sum.avgMonsterHp;

  const rStatus = r < TARGET.roundsMin ? 'low' : r > TARGET.roundsMax ? 'high' : 'ok';
  items.push({
    key: 'rounds', label: '回合數', value: `${r.toFixed(1)} 回合`, target: `${TARGET.roundsMin}～${TARGET.roundsMax} 回合`, status: rStatus,
    text: { low: '太快結束，玩家來不及出幾招', ok: '剛好', high: '拖太久' }[rStatus],
  });
  if (rStatus !== 'ok' && dmg > 0) {
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

  const downMax = Math.max(0, ...(sum.downRate ?? []).map((d) => d.rate));
  if (downMax > TARGET.downMax) advice.push(`有玩家 ${pct(downMax)} 的場次會倒地：防禦弱的角色壓力很大，可以調低攻擊強度，或準備更多回復藥水。`);

  const ok = items.every((i) => i.status === 'ok');
  if (ok) advice.unshift(`這組數值符合目標：${sum.avgRounds.toFixed(1)} 回合、每場耗 ${pct(c)} 資源、勝率 ${pct(w)}。`);
  return { items, advice, ok, perSession };
}

/**
 * 自動調整：同時縮放全部敵人的血量與攻擊強度，找讓 penalty 最小的倍率（target 是 TARGET 或 PLANS 的其中一個方案）。
 * evaluate(specs) → summarize 的結果（呼叫端決定每次跑幾場）；specs 是自訂強度的敵人清單。
 * 回傳 { specs, hpScale, atkScale, summary, penalty }。每評估一次就 await 一下，畫面才不會卡住。
 */
export async function autoTune({ specs, evaluate, target = TARGET, onProgress = () => {}, yieldFn = () => new Promise((res) => setTimeout(res, 0)), maxIter = 12, build = null }) {
  // build(血量倍率, 攻擊倍率) 可以換成別的縮放方式（固定敵人用 scaleEncounter）；evaluate 收到的就是 build 的結果
  const apply = build ?? ((kh, ka) => specs.map((s) => ({ ...s, hp: Math.max(1, Math.round(s.hp * kh)), atkPower: Math.max(1, Math.round(s.atkPower * ka)) })));
  let best = { kh: 1, ka: 1 };
  let bestSum = evaluate(apply(1, 1));
  let bestPen = penalty(bestSum, target);
  let step = 1.6;
  for (let iter = 0; iter < maxIter && bestPen > 0 && step > 1.06; iter++) {
    onProgress((iter + 1) / maxIter, bestPen);
    let improved = false;
    // 每個方向試一步與兩步：怪物攻擊低於玩家防禦時傷害一直是 0，只動一小步看不出差別，要跳大一點才跳得出平原
    const hpMul = [step, step ** 2];
    const atkMul = [step, step ** 2, step ** 4, step ** 8]; // 攻擊要跳更遠：怪物攻擊遠低於玩家防禦時，要一次跳過去才有傷害
    const cands = [...hpMul.flatMap((m) => [[best.kh * m, best.ka], [best.kh / m, best.ka]]), ...atkMul.flatMap((m) => [[best.kh, best.ka * m], [best.kh, best.ka / m]])];
    for (const [kh, ka] of cands) {
      await yieldFn();
      const sum = evaluate(apply(kh, ka));
      const pen = penalty(sum, target);
      if (pen < bestPen - 1e-9) { best = { kh, ka }; bestSum = sum; bestPen = pen; improved = true; }
    }
    if (!improved) step = Math.sqrt(step);
  }
  return { specs: apply(best.kh, best.ka), hpScale: best.kh, atkScale: best.ka, summary: bestSum, penalty: bestPen };
}

/**
 * 固定敵人（場上的或預組，A/B/C 已經抽好）的縮放：血量乘 kh、每條軌道的攻擊骰數乘 ka（有骰的軌道至少 1 顆）。
 * 回傳新的 { monsters }，不改動原本的資料；BOSS 的 atk 是三種攻擊（陣列），小怪是單一份。
 */
export function scaleEncounter(enc, kh, ka) {
  const scaleDice = (d) => Object.fromEntries(Object.entries(d ?? {}).map(([t, v]) => [t, v > 0 ? Math.max(1, Math.round(v * ka)) : v]));
  return {
    ...enc,
    monsters: (enc.monsters ?? []).map((m) => {
      const maxHp = Math.max(1, Math.round(m.maxHp * kh));
      return { ...m, maxHp, hp: maxHp, atk: Array.isArray(m.atk) ? m.atk.map(scaleDice) : scaleDice(m.atk) };
    }),
  };
}
