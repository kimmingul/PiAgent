(function (global) {
  'use strict';

  // Top bar (session title, project, new/export/settings), the connection banner and the
  // "working" line at the end of the transcript. State arrives as "status" messages.
  let working = null;
  function T(key, ...args) {
    return global.T ? global.T(key, ...args) : key;
  }


  function $(id) { return document.getElementById(id); }

  function status(msg) {
    const title = $('title-btn');
    title.textContent = msg.title || T('page.topbar.newChat');
    title.title = T('page.topbar.sessionListTitle') + ' · ' + [
      msg.project && T('page.topbar.projectLabel', msg.project),
      msg.pid ? 'pid ' + msg.pid : '',
      msg.cwd
    ].filter(Boolean).join(' · ');
    const chip = $('project-chip');
    chip.textContent = msg.project || '';
    chip.hidden = !msg.project;
    const idle = msg.connected && !msg.busy;
    $('title-btn').disabled = !idle;
    $('new-btn').disabled = !idle;
    $('export-btn').disabled = !msg.connected;

    const banner = $('banner');
    banner.hidden = msg.connected && !msg.error;
    banner.textContent = msg.state || '';
    banner.classList.toggle('error', !!msg.error);

    const log = $('log');
    if (!working) {
      working = document.createElement('div');
      working.id = 'working';
      working.innerHTML = '<span class="working-logo"></span><span class="working-text"></span>';
    }
    working.hidden = !msg.busy;
    if (msg.busy) {
      showLogo(working.firstChild, msg.model);
      working.lastChild.textContent = msg.activity || '';
      if (log.lastElementChild !== working) {
        const wasNear = global.ChatView.isNearBottom();
        log.appendChild(working);
        global.ChatView.newContent(wasNear);
      }
    }
  }

  // The running model's maker logo: Claude and OpenAI turn like their own apps' marks, the
  // others pulse. Without a known model it is the plain spark.
  function showLogo(holder, model) {
    if (holder.dataset.model === (model || '')) return;
    holder.dataset.model = model || '';
    holder.innerHTML = '';
    const brand = model ? global.ChatBrands.forModel(model) : null;
    if (!brand) {
      holder.className = 'working-logo spin';
      holder.innerHTML = '<span class="spark">✳</span>';
      return;
    }
    holder.className = 'working-logo ' + (global.ChatBrands.spins(brand) ? 'spin' : 'pulse');
    holder.appendChild(global.ChatBrands.modelIcon(model));
  }

  function wire() {
    $('title-btn').addEventListener('click', () => global.chatPost({ t: 'sessions' }));
    $('new-btn').addEventListener('click', () => global.chatPost({ t: 'newSession' }));
    $('export-btn').addEventListener('click', () => global.chatPost({ t: 'export' }));
    $('settings-btn').addEventListener('click', () => global.chatPost({ t: 'settings' }));
  }

  // The transcript was cleared; the indicator element must survive it.
  function detach() { if (working) working.remove(); }

  global.ChatTopbar = { wire, status, detach };
})(typeof window !== 'undefined' ? window : globalThis);
