export function createLibraryRenderer({ state, $, el, button, kinds, cardFace, showCardPreview }) {
  return function renderLibrary() {
    const grid = $('#library-grid');
    grid.replaceChildren();
    const search = $('#card-search').value.trim();
    const kind = $('#card-kind').value;
    const list = state.cards.filter((item) => (kind === 'all' || item.kind === kind)
      && (!search || item.name.includes(search) || item.text.includes(search)));
    $('#library-count').textContent = '共 ' + list.length + ' 张';
    for (const item of list) {
      const row = el('article', undefined, 'catalogue-card');
      row.append(cardFace(item));
      row.append(el('small', kinds[item.kind], 'eyebrow'));
      if (item.marketPrice) row.append(el('small', '市场价 ' + item.marketPrice + '官银'));
      if (item.rentalPrice) row.append(el('small', '租金 ' + item.rentalPrice + '官银 · 基础两次自身回合'));
      const look=button('放大查看',()=>showCardPreview(item));look.className='catalogue-preview-button';look.setAttribute('aria-label','放大查看'+item.name);row.append(look);
      grid.append(row);
    }
    if (!list.length) grid.append(el('p', '没有匹配的卡牌，试试其他关键词。', 'muted'));
  };
}
