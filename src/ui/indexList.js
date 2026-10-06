// ============================================================
// 地點索引：依區域分組列出所有地點，方便不想在地圖上找的人
// ============================================================

export function createIndexList({ container, onSelect, onRegionHover }) {
  function render(regions, locations) {
    const groups = regions
      .map((r) => ({ region: r, items: locations.filter((l) => l.region === r.id) }))
      .filter((g) => g.items.length);

    container.replaceChildren(
      ...groups.map(({ region, items }) => {
        const section = document.createElement('section');
        section.className = 'index-group';
        section.dataset.region = region.id;

        const h = document.createElement('h3');
        h.className = 'index-group__title';
        h.textContent = region.name;
        if (region.subtitle) {
          const sub = document.createElement('span');
          sub.className = 'index-group__sub';
          sub.textContent = region.subtitle;
          h.append(sub);
        }
        section.append(h);
        section.addEventListener('pointerenter', () => onRegionHover?.(region.id));
        section.addEventListener('pointerleave', () => onRegionHover?.(null));

        const ul = document.createElement('ul');
        ul.className = 'index-group__list';
        // 已揭露的排前面
        [...items]
          .sort((a, b) => Number(a.locked) - Number(b.locked))
          .forEach((l) => {
            const li = document.createElement('li');
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'index-item';
            btn.dataset.locked = String(l.locked);
            btn.textContent = l.name;
            if (l.locked) {
              const tag = document.createElement('span');
              tag.className = 'index-item__tag';
              tag.textContent = '未公開';
              btn.append(tag);
            }
            btn.addEventListener('click', () => onSelect(l.id));
            li.append(btn);
            ul.append(li);
          });
        section.append(ul);
        return section;
      })
    );
  }

  return { render };
}
