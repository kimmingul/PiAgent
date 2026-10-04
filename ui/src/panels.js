(function (global) {
  'use strict';

  // Two overlays: a sheet over the chat with Markdown from the IDE (a subagent transcript, the
  // shortcut list, the subagent list) and the usage panel of the context ring (context window,
  // this session's tokens, the provider's plan limits).
  let sheet, sheetTitle, sheetBody, pop;
  let last = null;

  function $(id) { return document.getElementById(id); }
  function T(key, ...args) { return global.T ? global.T(key, ...args) : key; }
  function lang() { return document.documentElement.lang || undefined; }
  function num(n) { return Number(n || 0).toLocaleString(lang()); }
  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function showSheet(msg) {
    sheetTitle.textContent = msg.title || '';
    sheetBody.innerHTML = global.Markdown.render(msg.text || '');
    sheet.hidden = false;
    sheetBody.scrollTop = 0;
  }

  function closeSheet() { sheet.hidden = true; }

  function bar(fraction) {
    const track = el('div', 'usage-bar');
    const fill = el('div', 'usage-fill');
    const pct = Math.max(0, Math.min(1, fraction || 0));
    fill.style.width = (pct * 100).toFixed(1) + '%';
    fill.classList.toggle('high', pct >= 0.8);
    track.appendChild(fill);
    return track;
  }

  function row(label, detail, value) {
    const line = el('div', 'usage-row');
    line.appendChild(el('span', 'usage-label', label));
    line.appendChild(el('span', 'usage-detail', detail || ''));
    line.appendChild(el('span', 'usage-value', value));
    return line;
  }

  // "5 hours", "weekly · Fable", "weekly · all models", or omp's own names for other windows.
  function limitName(limit) {
    const group = limit.group || '';
    switch (limit.window) {
      case '5h': return group ? T('page.usage.fiveHourGroup', group) : T('page.usage.fiveHour');
      case '7d': case 'weekly': return T('page.usage.weekly', group || T('page.usage.allModels'));
      case '1d': case 'daily': return T('page.usage.daily', group || T('page.usage.allModels'));
      default: return [limit.windowLabel, group].filter(Boolean).join(' · ');
    }
  }

  function resetText(at) {
    if (!at) return '';
    const ms = at - Date.now();
    if (ms <= 60000) return T('page.usage.resetSoon');
    if (ms < 24 * 3600000) {
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      return T('page.usage.resetsIn', h > 0 ? T('page.usage.hoursMinutes', h, m) : T('page.usage.minutes', m));
    }
    const when = new Intl.DateTimeFormat(lang(), { weekday: 'short', hour: 'numeric', minute: '2-digit' });
    return T('page.usage.resetsAt', when.format(new Date(at)));
  }

  function pct(fraction) { return Math.round((fraction || 0) * 100) + '%'; }

  function renderUsage(msg) {
    pop.innerHTML = '';
    const stats = msg.stats || {};
    const ctx = stats.contextUsage;
    const fraction = ctx && ctx.contextWindow ? ctx.tokens / ctx.contextWindow : 0;
    pop.appendChild(row(T('page.usage.contextWindow'), '', ctx ? pct(fraction) : '–'));
    pop.appendChild(bar(fraction));
    if (ctx) pop.appendChild(el('div', 'usage-note', T('page.usage.contextTokens', num(ctx.tokens), num(ctx.contextWindow))));
    const tokens = stats.tokens;
    if (tokens && tokens.total > 0) {
      const parts = [T('page.usage.input', num(tokens.input)), T('page.usage.output', num(tokens.output)),
        T('page.usage.cache', num((tokens.cacheRead || 0) + (tokens.cacheWrite || 0)))];
      if (stats.cost > 0) parts.push('$' + stats.cost.toFixed(2));
      pop.appendChild(el('div', 'usage-note', T('page.usage.session') + ' · ' + parts.join(' · ')));
    }
    pop.appendChild(el('div', 'popup-sep'));
    const head = el('div', 'usage-head');
    const plan = msg.limits && msg.limits.plan;
    head.appendChild(el('span', '', T('page.usage.planLimits') + ((plan || msg.provider) ? ' · ' + (plan || msg.provider) : '')));
    head.appendChild(el('span', 'usage-more', '→'));
    head.title = T('page.usage.fullReport');
    head.addEventListener('click', () => { close(); global.chatPost({ t: 'runCommand', text: '/usage' }); });
    pop.appendChild(head);
    const limits = (msg.limits && msg.limits.limits) || [];
    if (limits.length) {
      for (const limit of limits) {
        pop.appendChild(row(limitName(limit), resetText(limit.resetsAt), pct(limit.used)));
        pop.appendChild(bar(limit.used));
      }
    } else {
      pop.appendChild(el('div', 'usage-note', msg.loading ? T('page.usage.loading') :
        msg.error || T('page.usage.noLimits', msg.provider || '')));
    }
  }

  function usage(msg) {
    last = msg;
    if (!pop.hidden) renderUsage(msg);
  }

  function open() {
    pop.hidden = false;
    if (last) renderUsage(last);
    else pop.textContent = T('page.usage.loading');
    global.chatPost({ t: 'usage' });
  }

  function close() { pop.hidden = true; }

  function wire() {
    sheet = $('sheet');
    sheetTitle = $('sheet-title');
    sheetBody = $('sheet-body');
    pop = $('usage-pop');
    $('sheet-close').addEventListener('click', closeSheet);
    const ring = $('ctx-ring');
    ring.addEventListener('click', e => { e.stopPropagation(); if (pop.hidden) open(); else close(); });
    pop.addEventListener('click', e => e.stopPropagation());
    document.addEventListener('click', close);
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if (!sheet.hidden) closeSheet();
      close();
    });
  }

  global.ChatPanels = { wire, sheet: showSheet, usage, isOpen: () => !sheet.hidden || !pop.hidden };
})(typeof window !== 'undefined' ? window : globalThis);
