// js/range-panel.js — Range single-select panel (modland result pages)
import { S, elRefineRangeBtn, elRefineRangePanel } from './state.js';

let _onRangeChange = null;
export function setRangeChangeHandler(fn) { _onRangeChange = fn; }

export function getRangeSkip() { return S._currentRange; }

export function buildRangePanel(total, pageSize = 200) {
  const panel = elRefineRangePanel;
  panel.innerHTML = '';

  const title = document.createElement('div');
  title.className = 'panel-title';
  title.textContent = 'Range';
  panel.appendChild(title);

  if (total <= pageSize) {
    S._currentRange = 0;
    updateRangeBtn();
    return;
  }

  // Clamp current range to valid boundary
  if (S._currentRange > 0 && S._currentRange + pageSize > total) {
    S._currentRange = Math.max(total - pageSize, 0);
  }

  for (let i = 0; i < total; i += pageSize) {
    const end = Math.min(i + pageSize, total);
    const div = document.createElement('div');
    div.className = 'range-opt fmt-opt';
    div.textContent = `${i + 1}–${end}`;
    div.dataset.skip = String(i);
    if (i === S._currentRange) div.classList.add('selected');
    div.addEventListener('click', (e) => {
      e.stopPropagation();
      S._currentRange = parseInt(div.dataset.skip, 10);
      for (const el of panel.querySelectorAll('.range-opt')) el.classList.remove('selected');
      div.classList.add('selected');
      updateRangeBtn();
      elRefineRangePanel.hidden = true;
      _onRangeChange?.();
    });
    panel.appendChild(div);
  }

  updateRangeBtn();
}

export function updateRangeBtn() {
  const sel = elRefineRangePanel.querySelector('.range-opt.selected');
  if (sel) {
    elRefineRangeBtn.textContent = sel.textContent;
    elRefineRangeBtn.classList.add('active');
  } else {
    elRefineRangeBtn.textContent = '1..N';
    elRefineRangeBtn.classList.remove('active');
  }
}

export function clearRangeFilter() {
  S._currentRange = 0;
  for (const el of elRefineRangePanel.querySelectorAll('.range-opt')) el.classList.remove('selected');
  const first = elRefineRangePanel.querySelector('.range-opt');
  if (first) first.classList.add('selected');
  updateRangeBtn();
}

// ── event listeners ───────────────────────────────────
elRefineRangeBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  elRefineRangePanel.hidden = !elRefineRangePanel.hidden;
});

document.addEventListener('click', () => { elRefineRangePanel.hidden = true; });

elRefineRangePanel.addEventListener('click', (e) => e.stopPropagation());
