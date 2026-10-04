(function (global) {
  'use strict';

  // The model button under the message box: logo + short name. Its menu groups the models by
  // provider (provider logo + name), each row with the maker's logo, and filters as you type.
  let button, menu, search, list;
  let models = [];
  let providerNames = {};
  let current = '';
  let enabled = false;
  let rows = [];
  let active = -1;
  function T(key, ...args) { return global.T ? global.T(key, ...args) : key; }
  const B = () => global.ChatBrands;

  function shortName(selector) { return B().split(selector).model.split('/').pop(); }

  // "Anthropic (Claude Pro/Max)" -> "Anthropic"; unknown ids keep the id.
  function providerLabel(id) {
    const name = providerNames[id] || id;
    return name.replace(/\s*\(.*\)\s*$/, '') || id;
  }

  function renderButton() {
    button.innerHTML = '';
    if (current) button.appendChild(B().modelIcon(current));
    const label = document.createElement('span');
    label.className = 'model-name';
    label.textContent = current ? shortName(current) : T('page.modelpicker.none');
    button.appendChild(label);
    const arrow = document.createElement('span');
    arrow.className = 'model-arrow';
    arrow.textContent = '▾';
    button.appendChild(arrow);
    button.title = current ? T('page.modelpicker.title', current) : T('page.composer.modelTitle');
    button.disabled = !enabled;
  }

  function renderList() {
    const needle = search.value.trim().toLowerCase();
    list.innerHTML = '';
    rows = [];
    const known = models.includes(current) || !current ? models : [current].concat(models);
    let group = null;
    for (const sel of known) {
      if (needle && !sel.toLowerCase().includes(needle)) continue;
      const { provider } = B().split(sel);
      if (provider !== group) {
        group = provider;
        const head = document.createElement('div');
        head.className = 'model-group';
        head.appendChild(B().providerIcon(provider));
        const name = document.createElement('span');
        name.textContent = providerLabel(provider);
        head.appendChild(name);
        list.appendChild(head);
      }
      const row = document.createElement('div');
      row.className = 'popup-item model-row' + (sel === current ? ' current' : '');
      row.appendChild(B().modelIcon(sel));
      const name = document.createElement('span');
      name.className = 'popup-name';
      name.textContent = B().split(sel).model;
      row.appendChild(name);
      row.addEventListener('mousedown', e => { e.preventDefault(); choose(sel); });
      row.dataset.value = sel;
      list.appendChild(row);
      rows.push(row);
    }
    if (!rows.length) {
      const empty = document.createElement('div');
      empty.className = 'popup-empty';
      empty.textContent = T('page.modelpicker.noMatch');
      list.appendChild(empty);
    }
    setActive(Math.max(0, rows.findIndex(r => r.dataset.value === current)));
  }

  function setActive(index) {
    if (active >= 0 && rows[active]) rows[active].classList.remove('active');
    active = rows.length ? Math.min(Math.max(index, 0), rows.length - 1) : -1;
    if (active >= 0) {
      rows[active].classList.add('active');
      // The first row keeps its group heading in view.
      if (active === 0) list.scrollTop = 0; else rows[active].scrollIntoView({ block: 'nearest' });
    }
  }

  function open() {
    if (!enabled) return;
    menu.hidden = false;
    search.value = '';
    renderList();
    search.focus();
  }

  function close() { menu.hidden = true; }

  function choose(sel) {
    close();
    if (sel && sel !== current) global.chatPost({ t: 'setModel', value: sel });
  }

  function onKey(e) {
    if (e.key === 'ArrowDown') { setActive(active + 1); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { setActive(active - 1); e.preventDefault(); }
    else if (e.key === 'Enter') { if (rows[active]) choose(rows[active].dataset.value); e.preventDefault(); }
    else if (e.key === 'Escape') { close(); button.focus(); e.preventDefault(); e.stopPropagation(); }
  }

  function wire() {
    button = document.getElementById('model-btn');
    menu = document.getElementById('model-menu');
    search = document.getElementById('model-search');
    list = document.getElementById('model-list');
    button.addEventListener('click', () => (menu.hidden ? open() : close()));
    search.addEventListener('input', renderList);
    search.addEventListener('keydown', onKey);
    search.addEventListener('blur', () => setTimeout(close, 150));
    B().ready(renderButton);
    renderButton();
  }

  // From status: the selected model and whether it may change now.
  function status(model, canChange) {
    current = model || '';
    enabled = !!canChange;
    if (!enabled) close();
    renderButton();
  }

  function catalog(items, providers) {
    models = Array.isArray(items) ? items : [];
    providerNames = providers || {};
    if (!menu.hidden) renderList();
  }

  // The language changed: labels and titles are rebuilt.
  function relabel() { renderButton(); if (!menu.hidden) renderList(); }

  global.ChatModelPicker = { wire, status, catalog, relabel };
})(typeof window !== 'undefined' ? window : globalThis);
