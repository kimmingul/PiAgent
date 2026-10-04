(function (global) {
  'use strict';

  // The composer's + menu: files/pictures, folders, and submenus for MCP servers
  // and plugins with on/off switches. The IDE lists them ("extensions") and applies changes.
  let menu, sub, button;
  let data = { mcpServers: [], plugins: [] };
  let openSub = '';
  function T(key, ...args) {
    return global.T ? global.T(key, ...args) : key;
  }


  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function post(msg) { global.chatPost(msg); }

  function close() {
    menu.hidden = true;
    sub.hidden = true;
    openSub = '';
  }

  function toggleMenu() {
    if (!menu.hidden) { close(); return; }
    menu.hidden = false;
    post({ t: 'listExtensions' });
  }

  function switchRow(item, onToggle) {
    const row = el('div', 'popup-item switch-row');
    row.appendChild(el('span', 'switch-icon', item.kind === 'extension' ? '⧉' : '⊞'));
    const name = el('span', 'popup-name', item.name);
    name.title = item.detail ? item.name + ' — ' + item.detail : item.name;
    row.appendChild(name);
    const sw = el('span', 'switch' + (item.enabled ? ' on' : ''));
    sw.appendChild(el('span', 'knob'));
    row.appendChild(sw);
    row.addEventListener('click', e => {
      e.stopPropagation();
      if (global.ChatComposer.isBusy()) return;
      item.enabled = !item.enabled;
      sw.classList.toggle('on', item.enabled);
      onToggle(item);
    });
    return row;
  }

  function renderSub() {
    if (!openSub) return;
    sub.innerHTML = '';
    const isMcp = openSub === 'mcpServers';
    const manage = el('div', 'popup-item', isMcp ? T('page.plusmenu.manageMcpServers') : T('page.plusmenu.managePlugins'));
    manage.addEventListener('click', () => { close(); post({ t: 'manageExtensions' }); });
    sub.appendChild(manage);
    sub.appendChild(el('div', 'popup-sep'));
    const items = isMcp ? data.mcpServers : data.plugins;
    if (!items.length) {
      sub.appendChild(el('div', 'popup-empty', isMcp ? T('page.plusmenu.emptyMcpServers') : T('page.plusmenu.emptyPlugins')));
    }
    for (const item of items) {
      sub.appendChild(switchRow(item, it => post(isMcp
        ? { t: 'toggleMcpServer', id: it.id, enabled: it.enabled }
        : { t: 'togglePlugin', id: it.id, kind: it.kind, enabled: it.enabled })));
    }
    if (!isMcp && items.length) {
      sub.appendChild(el('div', 'popup-empty', T('page.plusmenu.restartHint')));
    }
    const row = menu.querySelector('[data-sub="' + openSub + '"]');
    // Both popups sit above the composer; align the submenu's bottom with the chosen row.
    sub.style.bottom = 'calc(100% + ' + (6 + menu.offsetHeight - row.offsetTop - row.offsetHeight) + 'px)';
    sub.hidden = false;
    // Right of the menu when the pane is wide enough, otherwise overlapping it.
    const room = sub.parentElement.clientWidth - sub.offsetWidth;
    sub.style.left = Math.max(0, Math.min(menu.offsetWidth + 4, room)) + 'px';
  }

  function showSub(name) {
    openSub = name;
    for (const r of menu.querySelectorAll('.has-sub')) r.classList.toggle('active', r.dataset.sub === name);
    renderSub();
  }

  function setData(msg) {
    data = { mcpServers: msg.mcpServers || [], plugins: msg.plugins || [] };
    renderSub();
  }

  function wire() {
    menu = document.getElementById('plus-menu');
    sub = document.getElementById('sub-menu');
    button = document.getElementById('plus-btn');
    button.addEventListener('click', e => { e.stopPropagation(); toggleMenu(); });
    menu.addEventListener('click', e => {
      e.stopPropagation();
      const item = e.target.closest('.popup-item');
      if (!item) return;
      if (item.dataset.sub) { showSub(item.dataset.sub); return; }
      close();
      post({ t: item.dataset.action });
    });
    menu.addEventListener('mouseover', e => {
      const item = e.target.closest('.has-sub');
      if (item && item.dataset.sub !== openSub) showSub(item.dataset.sub);
    });
    sub.addEventListener('click', e => e.stopPropagation());
    document.addEventListener('click', () => { if (!menu.hidden) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !menu.hidden) close(); });
  }

  global.ChatPlusMenu = { wire, setData, close, isOpen: () => !document.getElementById('plus-menu').hidden };
})(typeof window !== 'undefined' ? window : globalThis);
