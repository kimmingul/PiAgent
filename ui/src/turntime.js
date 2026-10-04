(function (global) {
  'use strict';

  // When a turn ended and how long it took, as a line under the turn's answer (live turns and
  // reloaded history alike: the IDE sends started/ended/stopped, ms since 1970), and when a
  // user message was sent, as its tooltip.
  function T(key, ...args) { return global.T ? global.T(key, ...args) : key; }
  function lang() { return document.documentElement.lang || undefined; }

  // Time of day; with the date when it was not today.
  function clock(ms) {
    const at = new Date(ms);
    return at.toDateString() === new Date().toDateString()
      ? at.toLocaleTimeString(lang()) : at.toLocaleString(lang());
  }

  function duration(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return T('page.turn.seconds', s);
    if (s < 3600) return T('page.turn.minutes', Math.floor(s / 60), s % 60);
    return T('page.turn.hours', Math.floor(s / 3600), Math.floor((s % 3600) / 60));
  }

  // Appends the line to parent when msg carries the times; true when it did.
  function append(parent, msg) {
    if (!parent || !msg || !msg.started || !msg.ended) return false;
    const line = document.createElement('div');
    line.className = 'turn-time' + (msg.stopped ? ' stopped' : '');
    line.textContent = T(msg.stopped ? 'page.turn.stopped' : 'page.turn.done',
      clock(msg.ended), duration(msg.ended - msg.started));
    line.title = T('page.turn.range', clock(msg.started), clock(msg.ended));
    parent.appendChild(line);
    return true;
  }

  function stamp(turn, ts) {
    if (turn && Number(ts) > 0) turn.title = T('page.turn.sent', clock(Number(ts)));
  }

  global.ChatTurnTime = { append, stamp, duration };
})(typeof window !== 'undefined' ? window : globalThis);
