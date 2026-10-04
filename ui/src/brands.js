(function (global) {
  'use strict';

  // Provider and model-maker logos (brands/*.svg, lobe-icons, MIT). brands/brands.json is the one
  // table of rules; the IDE side (RADAgent.BrandIcons) reads the same file. Model logos follow
  // the maker (ollama/nemotron -> NVIDIA); provider logos follow the service.
  let rules = null;
  const waiting = [];

  function load() {
    return fetch('brands/brands.json')
      .then(r => r.json())
      .then(data => {
        rules = data;
        rules.compiled = (data.models || []).map(([re, brand]) => [new RegExp(re), brand]);
        waiting.splice(0).forEach(fn => { try { fn(); } catch (e) { /* keep the others */ } });
      })
      .catch(() => { rules = { brands: {}, providers: {}, compiled: [] }; });
  }

  // Runs fn now if the table is loaded, else once it is.
  function ready(fn) { if (rules) fn(); else waiting.push(fn); }

  function forProvider(provider) {
    if (!rules || !provider) return null;
    const id = String(provider).toLowerCase();
    if (rules.providers[id]) return rules.providers[id];
    // Plan variants share the service's logo: gitlab-duo-agent -> gitlab-duo.
    let best = null;
    for (const key of Object.keys(rules.providers)) {
      if (id.startsWith(key + '-') && (!best || key.length > best.length)) best = key;
    }
    if (best) return rules.providers[best];
    return rules.brands[id] ? id : null;
  }

  // selector is "provider/model" (the model may itself contain "/", e.g. openrouter ids).
  function split(selector) {
    const s = String(selector || '');
    const at = s.indexOf('/');
    return at < 0 ? { provider: '', model: s } : { provider: s.slice(0, at), model: s.slice(at + 1) };
  }

  function forModel(selector) {
    if (!rules) return null;
    const { provider, model } = split(selector);
    const lower = model.toLowerCase();
    const name = lower.slice(lower.lastIndexOf('/') + 1);
    for (const [re, brand] of rules.compiled) if (re.test(name)) return brand;
    // Router ids carry the maker first: "meta-llama/llama-4", "anthropic/claude-x".
    const vendor = lower.includes('/') ? forProvider(lower.slice(0, lower.indexOf('/'))) : null;
    return vendor || forProvider(provider);
  }

  function spins(brand) { return !!(rules && rules.brands[brand] && rules.brands[brand].spin); }

  // A logo element; an unknown brand becomes a letter badge so every row still lines up.
  function icon(brand, fallbackText) {
    const el = document.createElement('span');
    const info = rules && brand ? rules.brands[brand] : null;
    if (!info) {
      el.className = 'brand letter';
      const text = String(fallbackText || '?').replace(/[^A-Za-z0-9]/g, '') || '?';
      el.textContent = text[0].toUpperCase();
      let hash = 0;
      for (const ch of text) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
      el.style.background = 'hsl(' + (hash % 360) + ', 45%, 45%)';
      return el;
    }
    const url = 'url("brands/' + brand + '.svg")';
    el.className = 'brand' + (info.mono ? ' mono' : '');
    if (info.mono) { el.style.webkitMaskImage = url; el.style.maskImage = url; } else el.style.backgroundImage = url;
    el.dataset.brand = brand;
    return el;
  }

  function modelIcon(selector) {
    const brand = forModel(selector);
    const el = icon(brand, split(selector).model || split(selector).provider);
    el.title = selector || '';
    return el;
  }

  function providerIcon(provider) { return icon(forProvider(provider), provider); }

  global.ChatBrands = { load, ready, forModel, forProvider, spins, icon, modelIcon, providerIcon, split };
})(typeof window !== 'undefined' ? window : globalThis);
