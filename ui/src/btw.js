(function (global) {
  'use strict';

  // /btw side questions. Each question gets a folded card in the chat; every topic of the project
  // stays in the notes panel (top bar "BTW"), searchable and apart from the conversation.
  // Answers come from a separate omp child on the IDE side; this file only shows them.
  let ctx = null;
  let mainSession = '';
  const topics = new Map();   // id -> topic
  const cards = new Map();    // id/turn -> card refs
  const items = new Map();    // id -> panel item refs
  let panel, list, search, onlyHere, badge, newInput;
  let shownIds = null;   // ids in the list, in order; same list = update in place
  function T(key, ...args) {
    return global.T ? global.T(key, ...args) : key;
  }


  function $(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(text, onClick) {
    const b = el('button', 'card-btn', text);
    b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); onClick(b); });
    return b;
  }

  function stateText(turn) {
    if (turn.state === 'running') return T('page.btw.receiving');
    if (turn.state === 'error') return T('page.btw.error');
    if (turn.state === 'stopped') return T('page.btw.stopped');
    return '';
  }

  function answer(turn) {
    const box = el('div', 'btw-answer');
    if (turn.a) {
      const body = el('div', 'markdown-body');
      body.innerHTML = global.Markdown.render(turn.a);
      box.appendChild(body);
    } else if (turn.state === 'running') {
      box.appendChild(el('div', 'btw-wait', T('page.btw.waiting')));
    }
    if (turn.error) box.appendChild(el('div', 'btw-error', turn.error));
    else if (turn.state === 'stopped' && !turn.a) box.appendChild(el('div', 'btw-wait', T('page.btw.stoppedParens')));
    return box;
  }

  // Textarea that sends a follow-up in the topic; Enter sends, Shift+Enter breaks the line.
  function followBox(id, placeholder) {
    const box = el('div', 'btw-follow');
    const input = el('textarea');
    input.rows = 1;
    input.placeholder = placeholder || T('page.btw.followPlaceholder');
    const send = () => {
      const text = input.value.trim();
      if (!text) return;
      const t = topics.get(id);
      if (t && t.turns.some(x => x.state === 'running')) return;
      ctx.post({ t: 'btw', text, topic: id });
      input.value = '';
    };
    input.addEventListener('keydown', e => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    box.appendChild(input);
    box.appendChild(button(T('page.btw.send'), send));
    return box;
  }

  function copyTopic(t, turnIndex) {
    const turns = turnIndex === undefined ? t.turns : [t.turns[turnIndex]];
    const text = turns.map(x => 'Q: ' + x.q + '\n\n' + (x.a || x.error || '')).join('\n\n---\n\n');
    ctx.post({ t: 'copy', text });
  }

  // ---- chat cards ----

  function renderCard(t, turnIndex) {
    const key = t.id + '/' + turnIndex;
    const turn = t.turns[turnIndex];
    let c = cards.get(key);
    if (!c) {
      const wasNear = ctx.isNearBottom();
      c = { root: el('details', 'btw-card') };
      const sum = el('summary');
      sum.appendChild(el('span', 'btw-tag', turnIndex ? T('page.btw.tagFollow') : T('page.btw.tag')));
      sum.appendChild(el('span', 'btw-q', turn.q));
      c.state = el('span', 'btw-state');
      sum.appendChild(c.state);
      // In the header, so it stays put while the answer streams below it.
      c.stop = button(T('page.btw.stop'), () => ctx.post({ t: 'btwStop', id: t.id }));
      c.stop.classList.add('btw-stop');
      sum.appendChild(c.stop);
      c.root.appendChild(sum);
      c.body = el('div', 'btw-body');
      c.root.appendChild(c.body);
      c.actions = el('div', 'card-actions');
      c.follow = followBox(t.id);
      c.follow.hidden = true;
      c.actions.appendChild(button(T('page.btw.follow'), () => {
        c.follow.hidden = !c.follow.hidden;
        if (!c.follow.hidden) c.follow.firstChild.focus();
      }));
      c.actions.appendChild(button(T('page.btw.copy'), () => copyTopic(topics.get(t.id) || t, turnIndex)));
      c.actions.appendChild(button(T('page.btw.viewInNotes'), () => open(t.id)));
      c.root.appendChild(c.actions);
      c.root.appendChild(c.follow);
      ctx.appendLog(c.root);
      cards.set(key, c);
      ctx.newContent(wasNear);
    }
    c.state.textContent = stateText(turn);
    c.root.classList.toggle('running', turn.state === 'running');
    c.root.classList.toggle('failed', turn.state === 'error');
    c.stop.hidden = turn.state !== 'running';
    c.body.replaceChildren(answer(turn));
  }

  // ---- notes panel ----

  function matches(t) {
    if (onlyHere.checked && t.mainSession !== mainSession) return false;
    const q = search.value.trim().toLowerCase();
    if (!q) return true;
    return t.turns.some(x => (x.q + '\n' + x.a).toLowerCase().includes(q));
  }

  function renderItem(t) {
    let it = items.get(t.id);
    if (!it) {
      it = { root: el('details', 'btw-topic') };
      it.root.dataset.id = t.id;
      const sum = el('summary');
      it.title = el('div', 'btw-q');
      it.meta = el('div', 'btw-meta');
      it.stop = button(T('page.btw.stop'), () => ctx.post({ t: 'btwStop', id: t.id }));
      it.stop.classList.add('btw-stop');
      const head = el('div', 'btw-topic-head');
      head.appendChild(it.title);
      head.appendChild(it.stop);
      sum.appendChild(head);
      sum.appendChild(it.meta);
      it.root.appendChild(sum);
      it.thread = el('div', 'btw-thread');
      it.root.appendChild(it.thread);
      it.follow = followBox(t.id);
      it.root.appendChild(it.follow);
      const actions = el('div', 'card-actions');
      actions.appendChild(button(T('page.btw.copy'), () => copyTopic(topics.get(t.id) || t)));
      actions.appendChild(button(T('page.btw.delete'), b => {
        if (b.dataset.armed) { ctx.post({ t: 'btwDelete', id: t.id }); return; }
        b.dataset.armed = '1';
        b.textContent = T('page.btw.deleteConfirm');
        setTimeout(() => { delete b.dataset.armed; b.textContent = T('page.btw.delete'); }, 3000);
      }));
      it.root.appendChild(actions);
      items.set(t.id, it);
    }
    const running = t.turns.some(x => x.state === 'running');
    it.title.textContent = t.turns[0].q;
    it.meta.textContent = [t.created, t.mainTitle || T('page.btw.untitled'),
      t.turns.length > 1 ? T('page.btw.questionCount', t.turns.length) : '', stateText(t.turns[t.turns.length - 1])]
      .filter(Boolean).join(' · ');
    it.stop.hidden = !running;
    it.root.classList.toggle('here', t.mainSession === mainSession);
    it.thread.replaceChildren(...t.turns.map(x => {
      const turn = el('div', 'btw-turn');
      turn.appendChild(el('div', 'btw-turn-q', x.q));
      turn.appendChild(el('div', 'btw-turn-meta', [x.asked, stateText(x)].filter(Boolean).join(' · ')));
      turn.appendChild(answer(x));
      return turn;
    }));
    return it;
  }

  // Re-attaching nodes while an answer streams would drop clicks and input focus, so the list is
  // rebuilt only when its topics or their order change.
  function renderList(changedId) {
    if (!panel) return;
    badge.textContent = topics.size ? String(topics.size) : '';
    if (panel.hidden) { shownIds = null; return; }
    const shown = [...topics.values()].sort((a, b) => (a.id < b.id ? 1 : -1)).filter(matches);
    const ids = shown.map(t => t.id).join('\n');
    if (ids === shownIds) {
      for (const t of shown) if (!changedId || t.id === changedId) renderItem(t);
      return;
    }
    shownIds = ids;
    list.replaceChildren(...shown.map(t => renderItem(t).root));
    if (!shown.length) list.appendChild(el('div', 'btw-empty',
      topics.size ? T('page.btw.noMatch') : T('page.btw.empty')));
  }

  function open(focusId) {
    panel.hidden = false;
    document.body.classList.add('btw-open');
    ctx.post({ t: 'btwList' });
    renderList();
    if (focusId && items.has(focusId)) {
      const it = items.get(focusId);
      it.root.open = true;
      it.root.scrollIntoView({ block: 'start' });
    } else {
      newInput.focus();
    }
  }

  function close() {
    panel.hidden = true;
    document.body.classList.remove('btw-open');
    global.ChatComposer.focus();
  }

  function wire(c) {
    ctx = c;
    panel = $('btw-panel');
    list = $('btw-list');
    search = $('btw-search');
    onlyHere = $('btw-only');
    badge = $('btw-count');
    newInput = $('btw-new-input');
    $('btw-btn').addEventListener('click', () => (panel.hidden ? open() : close()));
    $('btw-close').addEventListener('click', close);
    search.addEventListener('input', renderList);
    onlyHere.addEventListener('change', renderList);
    newInput.addEventListener('keydown', e => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Escape') { close(); return; }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const text = newInput.value.trim();
        if (text) { ctx.post({ t: 'btw', text }); newInput.value = ''; }
      }
    });
    ctx.post({ t: 'btwList' });
  }

  // One turn of a topic changed (asked, streaming, finished).
  function update(msg) {
    const t = msg.topic;
    if (!t || !Array.isArray(t.turns) || !t.turns[msg.turn]) return;
    topics.set(t.id, t);
    renderCard(t, msg.turn);
    renderList(t.id);
  }

  function setList(msg) {
    mainSession = msg.session || '';
    topics.clear();
    for (const t of msg.items || []) topics.set(t.id, t);
    for (const id of [...items.keys()]) if (!topics.has(id)) items.delete(id);
    renderList();
  }

  global.ChatBtw = {
    wire, update, setList, open, close,
    // The transcript was cleared: the cards go, the notes stay.
    clear: () => cards.clear()
  };
})(typeof window !== 'undefined' ? window : globalThis);
