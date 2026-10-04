(function (global) {
  'use strict';

  // Messages sent while omp works. omp lists the ones it has not read yet (queue_update and
  // get_state, omp 18.4.4 and later); while listed, a message shows as waiting and can be called
  // off. Older omp lists nothing, and the message keeps its plain tag.
  let ctx = null;
  const T = (...args) => global.T(...args);
  const listOf = queue => (queue === 'followUp' ? 'followUp' : 'steering');
  const bubbles = selector => Array.from(document.querySelectorAll(selector));

  // sent: the text omp got, which its lists repeat.
  function mark(bubble, queue, sent) {
    const tag = document.createElement('div');
    tag.className = 'queue-tag';
    tag.textContent = T(queue === 'followUp' ? 'page.chat.queuedFollowUp' : 'page.chat.queuedSteer');
    bubble.appendChild(tag);
    bubble.dataset.queue = queue;
    bubble.dataset.sent = sent || '';
  }

  function setTag(bubble, key) {
    const tag = bubble.querySelector('.queue-tag');
    if (tag) tag.firstChild.textContent = T(key);
  }

  function waiting(bubble) {
    if (bubble.classList.contains('queue-waiting')) return;
    bubble.classList.add('queue-waiting');
    const cancel = document.createElement('button');
    cancel.className = 'notice-btn queue-cancel';
    cancel.textContent = T('page.chat.queueCancel');
    cancel.addEventListener('click', () => {
      cancel.disabled = true;
      bubble.classList.add('queue-cancelling');
      ctx.post({ t: 'cancelQueued', sent: bubble.dataset.sent, queue: bubble.dataset.queue });
    });
    bubble.querySelector('.queue-tag').appendChild(cancel);
  }

  // Out of omp's lists: read by omp, or lost with an omp that restarted. A message being called
  // off waits for omp's answer (removed).
  function left(bubble, lost) {
    bubble.classList.remove('queue-waiting');
    const cancel = bubble.querySelector('.queue-cancel');
    if (cancel) cancel.remove();
    if (bubble.classList.contains('queue-cancelling')) return;
    bubble.classList.add('queue-left');
    if (lost) { bubble.classList.add('queue-lost'); setTag(bubble, 'page.chat.queueLost'); }
  }

  // state: a get_state answer, which follows every change omp reported before it, so a waiting
  // message missing from it went with the omp that held it. Newest first: of two equal texts omp
  // reads the older one first.
  function update(msg) {
    const lists = { steering: (msg.steering || []).slice(), followUp: (msg.followUp || []).slice() };
    for (const bubble of bubbles('.user-bubble[data-queue]').reverse()) {
      if (bubble.classList.contains('queue-left')) continue;
      const list = lists[listOf(bubble.dataset.queue)];
      const at = list.indexOf(bubble.dataset.sent);
      if (at >= 0) { list.splice(at, 1); waiting(bubble); }
      else if (bubble.classList.contains('queue-waiting')) left(bubble, !!msg.state);
    }
  }

  function removed(msg) {
    const bubble = bubbles('.user-bubble.queue-cancelling').reverse()
      .find(b => b.dataset.sent === msg.sent && b.dataset.queue === msg.queue);
    if (!bubble) return;
    bubble.classList.remove('queue-cancelling');
    if (msg.removed) {
      left(bubble, false);
      bubble.classList.add('queue-cancelled');
      setTag(bubble, 'page.chat.queueCancelled');
    } else if (bubble.classList.contains('queue-waiting')) {
      const cancel = bubble.querySelector('.queue-cancel');
      if (cancel) cancel.disabled = false;
    } else {
      left(bubble, false);
    }
  }

  // After a stop omp keeps the follow-ups: they go out after the next message.
  function turnEnd(msg) {
    const count = bubbles('.user-bubble.queue-waiting').length;
    if (!msg.stopped || !count) return;
    const notice = document.createElement('div');
    notice.className = 'notice notice-info';
    notice.textContent = T('page.chat.queueAfterStop', count);
    ctx.appendLog(notice);
  }

  global.ChatQueue = { init: c => { ctx = c; }, mark, update, removed, turnEnd };
})(typeof window !== 'undefined' ? window : globalThis);
