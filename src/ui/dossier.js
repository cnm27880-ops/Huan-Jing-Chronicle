// ============================================================
// 地點情報面板（桌機為右側卷軸，手機為底部抽屜）
// 一律用 textContent 放文字，不用 innerHTML：
// 之後內容由 GM 在後台輸入，這樣可避免惡意程式碼被塞進網頁（XSS）。
// ============================================================

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function img({ src, alt }, className) {
  const node = el('img', className);
  node.src = src;
  node.alt = alt ?? '';
  node.loading = 'lazy';
  node.decoding = 'async';
  return node;
}

export function createDossier({ panel, onClose }) {
  const body = panel.querySelector('[data-dossier-body]');
  const closeBtn = panel.querySelector('[data-dossier-close]');
  let lastFocus = null;

  closeBtn.addEventListener('click', () => close());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel.dataset.open === 'true') close();
  });

  function renderLocked(loc, region) {
    return [
      el('p', 'dossier__region', region.name),
      el('h2', 'dossier__title', loc.name),
      el('div', 'dossier__locked', '這裡的情報還沒公開。等劇情推進到這裡，GM 會揭露更多內容。'),
    ];
  }

  function renderFaction(f) {
    const box = el('section', 'faction');
    const head = el('header', 'faction__head');
    head.append(el('h4', 'faction__name', f.name));
    if (f.seat) head.append(el('p', 'faction__seat', `據點：${f.seat}`));
    box.append(head);
    if (f.image) box.append(img(f.image, 'faction__image'));
    if (f.style) box.append(el('p', 'faction__text', f.style));

    if (f.leader) {
      const leader = el('figure', 'leader');
      if (f.leader.image) leader.append(img(f.leader.image, 'leader__portrait'));
      const cap = el('figcaption', 'leader__caption');
      cap.append(el('p', 'leader__role', `宗主「${f.leader.title}」`));
      cap.append(el('p', 'leader__name', f.leader.name));
      if (f.leader.desc) cap.append(el('p', 'leader__desc', f.leader.desc));
      leader.append(cap);
      box.append(leader);
    }
    return box;
  }

  function renderRevealed(loc, region) {
    const nodes = [el('p', 'dossier__region', region.name), el('h2', 'dossier__title', loc.name)];
    if (loc.cover) nodes.push(img(loc.cover, 'dossier__cover'));
    (loc.body ?? []).forEach((p) => nodes.push(el('p', 'dossier__text', p)));
    if (loc.factions?.length) {
      nodes.push(el('h3', 'dossier__section', '坐落於此的勢力'));
      loc.factions.forEach((f) => nodes.push(renderFaction(f)));
    }
    return nodes;
  }

  function open(loc, region) {
    lastFocus = document.activeElement;
    panel.dataset.theme = region.theme;
    body.replaceChildren(...(loc.locked ? renderLocked(loc, region) : renderRevealed(loc, region)));
    body.scrollTop = 0;
    panel.dataset.open = 'true';
    panel.setAttribute('aria-hidden', 'false');
    closeBtn.focus({ preventScroll: true });
  }

  function close() {
    panel.dataset.open = 'false';
    panel.setAttribute('aria-hidden', 'true');
    onClose?.();
    lastFocus?.focus?.({ preventScroll: true });
  }

  return { open, close };
}
