// ============================================================
// 長按連加／連減：按住按鈕不放，過一下子就開始連續執行，按越久越快。
// step() 每次執行一步；回傳 false 代表到上限／下限了，就停止連按。
// onEnd() 在放開（或停止）時呼叫一次，重畫畫面請放這裡（連按途中不要重畫，按鈕被換掉就收不到「放開」了）。
// 鍵盤（Enter／空白鍵）與螢幕閱讀器的點擊仍然是「點一下＝一步」。
// ============================================================
export function holdRepeat(btn, step, { onEnd, delay = 380, every = 90 } = {}) {
  let timer = null;
  let active = false;
  let t0 = 0;
  const stop = () => {
    clearTimeout(timer);
    timer = null;
    if (!active) return;
    active = false;
    onEnd?.();
  };
  const tick = () => {
    if (step() === false) return stop();
    const held = Date.now() - t0;
    timer = setTimeout(tick, held > 1800 ? 30 : held > 1000 ? 55 : every);
    return undefined;
  };
  btn.classList.add('hold');
  btn.addEventListener('pointerdown', (e) => {
    if (btn.disabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault(); // 不要選到文字、不要跳出長按選單
    active = true;
    t0 = Date.now();
    if (step() === false) return stop();
    timer = setTimeout(tick, delay);
    return undefined;
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => btn.addEventListener(ev, stop));
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  btn.addEventListener('click', (e) => { if (e.detail === 0) { step(); onEnd?.(); } }); // detail 0＝鍵盤觸發
}
