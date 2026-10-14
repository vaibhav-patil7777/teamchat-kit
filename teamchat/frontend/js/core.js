(function () {
  'use strict';
  const TC = (window.TC = window.TC || {});
  const CFG = window.APP_CONFIG;
  const t = (...a) => TC.t(...a);

  /* ================= storage ================= */
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };
  TC.LS = LS;

  /* ================= state + events ================= */
  const S = (TC.S = {
    token: LS.get('tc_token', ''),
    me: LS.get('tc_me', null),
    chats: [],
    chatsLoaded: false,
    msgs: {},
    online: new Set(),
    typing: {},
    activeChat: null,
    conn: 'idle',
    prefs: LS.get('tc_prefs', {}),
  });
  const listeners = {};
  TC.on = (evt, fn, persist) => { (listeners[evt] = listeners[evt] || new Set()).add(fn); const off = () => listeners[evt].delete(fn); if (!persist) TC._cleanups.push(off); return off; };
  TC.emit = (evt, data) => { (listeners[evt] || []).forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } }); };
  TC._cleanups = [];
  TC.onUnmount = (fn) => TC._cleanups.push(fn);

  /* ================= DOM helper ================= */
  ['replaceChildren', 'append', 'prepend'].forEach((fn) => {
    const orig = Element.prototype[fn];
    Element.prototype[fn] = function () {
      const args = Array.prototype.slice.call(arguments);
      const flat = [];
      (function walk(a) { a.forEach((x) => { if (Array.isArray(x)) walk(x); else if (x != null && x !== false) flat.push(x); }); })(args);
      return orig.apply(this, flat);
    };
  });
  function add(e, kids) {
    for (const c of kids) {
      if (c == null || c === false) continue;
      if (Array.isArray(c)) add(e, c);
      else e.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
    }
  }
  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
        else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'html') e.innerHTML = v;
        else if (k === 'for') e.htmlFor = v;
        else if (k in e && typeof v !== 'object' && k !== 'list') { try { e[k] = v; } catch (_) { e.setAttribute(k, v); } }
        else e.setAttribute(k, v === true ? '' : v);
      }
    }
    add(e, kids);
    return e;
  }
  TC.h = h;
  TC.$ = (s, el) => (el || document).querySelector(s);
  TC.$$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  TC.debounce = (fn, ms) => { let id; return (...a) => { clearTimeout(id); id = setTimeout(() => fn(...a), ms); }; };

  /* ================= formatting ================= */
  const LOCALES = { en: 'en-IN', hi: 'hi-IN', mr: 'mr-IN' };
  const loc = () => LOCALES[TC.lang] || 'en-IN';
  TC.fmtTime = (iso) => (iso ? new Date(iso).toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit' }) : '');
  TC.fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString(loc(), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
  TC.fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(loc(), { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  TC.sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
  TC.dayLabel = (iso) => {
    const d = new Date(iso), n = new Date(), y = new Date();
    y.setDate(n.getDate() - 1);
    if (d.toDateString() === n.toDateString()) return t('time.today');
    if (d.toDateString() === y.toDateString()) return t('time.yesterday');
    return TC.fmtDate(iso);
  };
  TC.listTime = (iso) => {
    if (!iso) return '';
    const d = new Date(iso), n = new Date(), y = new Date();
    y.setDate(n.getDate() - 1);
    if (d.toDateString() === n.toDateString()) return TC.fmtTime(iso);
    if (d.toDateString() === y.toDateString()) return t('time.yesterday');
    return d.toLocaleDateString(loc(), { day: 'numeric', month: 'short' });
  };
  TC.fmtSize = (b) => {
    if (!b) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0, n = b;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return (i === 0 ? n : n.toFixed(n < 10 ? 1 : 0)) + ' ' + u[i];
  };
  TC.fmtDuration = (s) => { s = Math.max(0, Math.round(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  TC.lastSeen = (iso) => {
    if (!iso) return t('chat.offline');
    const d = new Date(iso), n = new Date(), y = new Date();
    y.setDate(n.getDate() - 1);
    if (d.toDateString() === n.toDateString()) return t('chat.lastSeenToday', { time: TC.fmtTime(iso) });
    if (d.toDateString() === y.toDateString()) return t('chat.lastSeenYesterday', { time: TC.fmtTime(iso) });
    return t('chat.lastSeenOn', { date: TC.fmtDate(iso) });
  };

  const COLORS = ['#7c6cf0', '#e17055', '#00a383', '#2f8fe8', '#e0453f', '#e84393', '#d99a00', '#00a8a8', '#c0602b', '#a45bd1', '#3d9be0', '#20a35b'];
  TC.colorFor = (s) => { let x = 0; for (const c of String(s || '?')) x = (x * 31 + c.charCodeAt(0)) >>> 0; return COLORS[x % COLORS.length]; };
  TC.initials = (name) => {
    const p = String(name || '?').trim().split(/\s+/).filter(Boolean);
    return ((p[0] ? Array.from(p[0])[0] : '?') + (p[1] ? Array.from(p[1])[0] : '')).toUpperCase();
  };
  TC.avatar = (name, url, size, cls) => {
    size = size || 40;
    const el = h('div', { class: 'avatar ' + (cls || ''), style: { width: size + 'px', height: size + 'px', fontSize: Math.round(size * 0.4) + 'px', background: url ? 'transparent' : TC.colorFor(name) } });
    const ini = TC.initials(name);
    if (url) {
      const img = h('img', { src: url, alt: '', loading: 'lazy' });
      img.addEventListener('error', () => { img.remove(); el.style.background = TC.colorFor(name); el.textContent = ini; });
      el.appendChild(img);
    } else el.textContent = ini;
    return el;
  };

  const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g;
  TC.linkify = (text) => {
    const out = [];
    let last = 0, m;
    URL_RE.lastIndex = 0;
    while ((m = URL_RE.exec(text))) {
      if (m.index > last) out.push(text.slice(last, m.index));
      out.push(h('a', { href: m[0], target: '_blank', rel: 'noopener noreferrer' }, m[0]));
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  };
  TC.copy = async (text) => {
    try { await navigator.clipboard.writeText(text); }
    catch (e) {
      const ta = h('textarea', { value: text, style: { position: 'fixed', opacity: 0 } });
      document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (_) { /* ignore */ }
      ta.remove();
    }
    TC.toast(t('common.copied'), 'success');
  };

  /* ================= toast / modal / menu ================= */
  TC.toast = (msg, kind) => {
    let box = TC.$('#toasts');
    if (!box) { box = h('div', { id: 'toasts', 'aria-live': 'polite' }); document.body.appendChild(box); }
    const el = h('div', { class: 'toast ' + (kind || 'info') }, TC.ic(kind === 'error' ? 'alert' : kind === 'success' ? 'check-circle' : 'info', 18), h('span', null, msg));
    box.appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 250); }, kind === 'error' ? 5000 : 3000);
  };
  TC.errMsg = (e) => {
    if (!e) return t('err.generic');
    if (TC.lang !== 'en' && e.code) { const tr = TC.T[TC.lang] && TC.T[TC.lang]['err.' + e.code]; if (tr) return tr; }
    if (TC.lang === 'en' && e.code === 'network') return e.message;
    return e.message || t('err.generic');
  };
  TC.fail = (e) => TC.toast(TC.errMsg(e), 'error');

  TC.modal = (opts) => {
    const prevFocus = document.activeElement;
    const back = h('div', { class: 'modal-back' });
    const bodyEl = h('div', { class: 'modal-body' }, opts.body);
    const footer = h('div', { class: 'modal-foot' });
    const box = h('div', { class: 'modal' + (opts.wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true' },
      h('div', { class: 'modal-head' }, h('h3', null, opts.title || ''), h('button', { class: 'icon-btn', title: t('common.close'), onclick: () => api.close() }, TC.ic('x', 20))),
      bodyEl, opts.actions && opts.actions.length ? footer : null);
    const onKey = (e) => { if (e.key === 'Escape' && opts.dismissible !== false) api.close(); };
    const api = {
      el: box, body: bodyEl,
      close() { document.removeEventListener('keydown', onKey); back.remove(); if (opts.onClose) opts.onClose(); if (prevFocus && prevFocus.focus) try { prevFocus.focus(); } catch (_) { /* ignore */ } },
    };
    (opts.actions || []).forEach((a) => {
      const btn = h('button', { class: 'btn ' + (a.kind || 'ghost'), type: 'button' }, a.label);
      btn.addEventListener('click', async () => {
        if (btn.disabled) return;
        btn.disabled = true;
        try { const r = a.onClick ? await a.onClick(api) : undefined; if (r !== false) api.close(); }
        catch (e) { TC.fail(e); }
        finally { btn.disabled = false; }
      });
      footer.appendChild(btn);
    });
    back.appendChild(box);
    if (opts.dismissible !== false) back.addEventListener('mousedown', (e) => { if (e.target === back) api.close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(back);
    const first = box.querySelector('input,textarea,select');
    if (first && opts.autofocus !== false) setTimeout(() => { try { first.focus(); } catch (_) { /* ignore */ } }, 30);
    return api;
  };
  TC.confirm = (message, o) => new Promise((resolve) => {
    o = o || {};
    let done = false;
    const m = TC.modal({
      title: o.title || t('common.confirm'),
      body: h('p', { class: 'confirm-text' }, message),
      actions: [
        { label: t('common.cancel'), kind: 'ghost', onClick: () => { done = true; resolve(false); } },
        { label: o.okLabel || t('common.ok'), kind: o.danger ? 'danger' : 'primary', onClick: () => { done = true; resolve(true); } },
      ],
      onClose: () => { if (!done) resolve(false); },
    });
    return m;
  });

  let openMenu = null;
  TC.closeMenu = () => { if (openMenu) { openMenu.remove(); openMenu = null; } };
  TC.menu = (anchor, items, o) => {
    TC.closeMenu();
    o = o || {};
    const sheet = window.matchMedia('(max-width: 700px)').matches;
    const el = h('div', { class: 'menu' + (sheet ? ' sheet' : ''), role: 'menu' });
    if (o.header) el.appendChild(o.header);
    items.filter(Boolean).forEach((it) => {
      if (it.divider) { el.appendChild(h('div', { class: 'menu-div' })); return; }
      el.appendChild(h('button', { class: 'menu-item' + (it.danger ? ' danger' : ''), role: 'menuitem', type: 'button',
        onclick: (e) => { e.stopPropagation(); TC.closeMenu(); if (it.onClick) it.onClick(); } }, it.icon ? TC.ic(it.icon, 18) : null, h('span', null, it.label), it.check ? TC.ic('check', 16) : null));
    });
    const back = h('div', { class: 'menu-back' + (sheet ? ' dim' : '') });
    back.addEventListener('mousedown', (e) => { if (e.target === back) TC.closeMenu(); });
    back.addEventListener('touchstart', (e) => { if (e.target === back) TC.closeMenu(); }, { passive: true });
    back.appendChild(el);
    document.body.appendChild(back);
    openMenu = back;
    if (!sheet) {
      const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y, width: 0, height: 0 };
      el.style.visibility = 'hidden';
      const mw = el.offsetWidth, mh = el.offsetHeight;
      let left = o.alignRight ? r.right - mw : r.left;
      let top = r.bottom + 4;
      if (top + mh > innerHeight - 8) top = Math.max(8, r.top - mh - 4);
      left = Math.min(Math.max(8, left), innerWidth - mw - 8);
      el.style.left = left + 'px'; el.style.top = top + 'px'; el.style.visibility = '';
    }
    return el;
  };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') TC.closeMenu(); });

  /* ================= API ================= */
  class ApiError extends Error {
    constructor(msg, status, code, data) { super(msg); this.status = status; this.code = code; this.data = data; }
  }
  TC.ApiError = ApiError;

  function xhrUpload(path, o, headers) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      if (o.ref) o.ref.xhr = xhr;
      xhr.open(o.method || 'POST', CFG.API_BASE + path);
      Object.keys(headers).forEach((k) => xhr.setRequestHeader(k, headers[k]));
      xhr.upload.onprogress = (e) => { if (e.lengthComputable && o.onProgress) o.onProgress(e.loaded / e.total); };
      xhr.onload = () => {
        let data = null;
        try { data = JSON.parse(xhr.responseText); } catch (e) { /* ignore */ }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else {
          if (xhr.status === 401 && S.token) TC.forceLogout('expired');
          reject(new ApiError((data && data.error) || 'HTTP ' + xhr.status, xhr.status, (data && data.code) || 'error', data));
        }
      };
      xhr.onerror = () => reject(new ApiError(t('err.network'), 0, 'network'));
      xhr.onabort = () => reject(new ApiError('cancelled', 0, 'cancelled'));
      xhr.send(o.form);
    });
  }

  TC.api = async function (path, o) {
    o = o || {};
    const headers = {};
    if (S.token) headers.Authorization = 'Bearer ' + S.token;
    let body;
    if (o.form) body = o.form;
    else if (o.body !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(o.body); }
    if (o.form && o.onProgress) return xhrUpload(path, o, headers);
    let res;
    try { res = await fetch(CFG.API_BASE + path, { method: o.method || 'GET', headers, body }); }
    catch (e) { throw new ApiError(t('err.network'), 0, 'network'); }
    if (o.blob && res.ok) {
      const cd = res.headers.get('Content-Disposition') || '';
      const m = /filename="?([^"]+)"?/.exec(cd);
      return { blob: await res.blob(), filename: m ? m[1] : 'download' };
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* ignore */ }
    if (!res.ok) {
      if (res.status === 401 && S.token && !o.noRedirect) TC.forceLogout('expired');
      throw new ApiError((data && data.error) || 'HTTP ' + res.status, res.status, (data && data.code) || 'error', data);
    }
    return data;
  };
  TC.saveBlob = (blob, filename) => {
    const a = h('a', { href: URL.createObjectURL(blob), download: filename });
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  };

  /* ================= session ================= */
  TC.setSession = (token, me) => { S.token = token; S.me = me; LS.set('tc_token', token); LS.set('tc_me', me); };
  TC.setMe = (me) => { S.me = me; LS.set('tc_me', me); if (me.prefs && Object.keys(me.prefs).length) { S.prefs = Object.assign({}, S.prefs, me.prefs); LS.set('tc_prefs', S.prefs); } TC.applyPrefs(); TC.emit('me'); };
  TC.clearSession = () => {
    S.token = ''; S.me = null; S.chats = []; S.msgs = {}; S.chatsLoaded = false; S.typing = {}; S.activeChat = null;
    LS.del('tc_token'); LS.del('tc_me');
    TC.closeWS(true);
  };
  TC.forceLogout = (reason) => { if (!S.token) return; TC.clearSession(); TC.emit('logout', reason); };
  TC.can = (feature) => !S.me || S.me.role === 'admin' || !S.me.features || S.me.features[feature] !== false;
  TC.isAdmin = () => !!(S.me && S.me.role === 'admin');

  /* ================= preferences / themes / fonts ================= */
  TC.THEMES = [
    { id: 'light', bg: '#ffffff', fg: '#111b21', ac: '#008069' },
    { id: 'dark', bg: '#111b21', fg: '#e9edef', ac: '#00a884' },
    { id: 'amoled', bg: '#000000', fg: '#f1f1f1', ac: '#25d366' },
    { id: 'ocean', bg: '#eaf4fb', fg: '#0b2a3d', ac: '#0a84c6' },
    { id: 'forest', bg: '#eef5ee', fg: '#173321', ac: '#2e7d32' },
    { id: 'sunset', bg: '#fff3e8', fg: '#3a1d0d', ac: '#e8590c' },
    { id: 'purple', bg: '#f4effb', fg: '#26143d', ac: '#7048e8' },
    { id: 'rose', bg: '#fff0f4', fg: '#3d1420', ac: '#d6336c' },
    { id: 'slate', bg: '#1f2733', fg: '#e3e8ef', ac: '#4dabf7' },
  ];
  TC.FONTS = [
    { id: 'system', label: 'System default', family: 'system-ui', google: '' },
    { id: 'inter', label: 'Inter', family: '"Inter"', google: 'Inter:wght@400;500;600;700' },
    { id: 'poppins', label: 'Poppins', family: '"Poppins"', google: 'Poppins:wght@400;500;600;700' },
    { id: 'roboto', label: 'Roboto', family: '"Roboto"', google: 'Roboto:wght@400;500;700' },
    { id: 'nunito', label: 'Nunito', family: '"Nunito"', google: 'Nunito:wght@400;600;700' },
    { id: 'opensans', label: 'Open Sans', family: '"Open Sans"', google: 'Open+Sans:wght@400;600;700' },
    { id: 'montserrat', label: 'Montserrat', family: '"Montserrat"', google: 'Montserrat:wght@400;500;600;700' },
    { id: 'lato', label: 'Lato', family: '"Lato"', google: 'Lato:wght@400;700' },
    { id: 'noto', label: 'Noto Sans', family: '"Noto Sans"', google: 'Noto+Sans:wght@400;500;600;700' },
    { id: 'mukta', label: 'Mukta', family: '"Mukta"', google: 'Mukta:wght@400;500;600;700' },
    { id: 'merriweather', label: 'Merriweather (serif)', family: '"Merriweather", serif', google: 'Merriweather:wght@400;700' },
    { id: 'jetbrains', label: 'JetBrains Mono', family: '"JetBrains Mono", monospace', google: 'JetBrains+Mono:wght@400;500;700' },
  ];
  TC.WALLPAPERS = ['none', 'doodle', 'dots', 'grid', 'g1', 'g2', 'g3', 'g4', 'g5', 'custom'];
  const DOODLE = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='90' height='90'%3E%3Cg fill='none' stroke='%23888' stroke-opacity='.14' stroke-width='2' stroke-linecap='round'%3E%3Ccircle cx='15' cy='15' r='6'/%3E%3Cpath d='M55 12l9 9M64 12l-9 9'/%3E%3Crect x='12' y='55' width='14' height='14' rx='3'/%3E%3Cpath d='M58 66q7-12 14 0'/%3E%3C/g%3E%3C/svg%3E\")";
  const WP = {
    none: 'var(--chat-bg)',
    doodle: DOODLE + ' 0 0/90px 90px, var(--chat-bg)',
    dots: 'radial-gradient(color-mix(in srgb, var(--text) 12%, transparent) 1.3px, transparent 1.3px) 0 0/18px 18px, var(--chat-bg)',
    grid: 'linear-gradient(color-mix(in srgb, var(--text) 7%, transparent) 1px, transparent 1px) 0 0/24px 24px, linear-gradient(90deg, color-mix(in srgb, var(--text) 7%, transparent) 1px, transparent 1px) 0 0/24px 24px, var(--chat-bg)',
    g1: 'linear-gradient(135deg,#a8edea,#fed6e3)',
    g2: 'linear-gradient(135deg,#667eea,#764ba2)',
    g3: 'linear-gradient(135deg,#f093fb,#f5576c)',
    g4: 'linear-gradient(135deg,#43e97b,#38f9d7)',
    g5: 'linear-gradient(135deg,#fa709a,#fee140)',
  };
  TC.wallpaperCSS = (id) => {
    if (id === 'custom') { const d = LS.get('tc_wallpaper', ''); return d ? 'url("' + d + '") center/cover no-repeat' : WP.doodle; }
    return WP[id] || WP.doodle;
  };
  const loadedFonts = {};
  function loadFont(f) {
    if (!f || !f.google || loadedFonts[f.id]) return;
    loadedFonts[f.id] = true;
    document.head.appendChild(h('link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=' + f.google + '&display=swap' }));
  }
  let devaLoaded = false;
  function loadDevanagari() {
    if (devaLoaded) return;
    devaLoaded = true;
    document.head.appendChild(h('link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;500;600;700&family=Mukta:wght@400;500;600;700&display=swap' }));
  }
  function contrastText(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return '#ffffff';
    const n = parseInt(m[1], 16);
    const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    return lum > 0.62 ? '#111111' : '#ffffff';
  }
  TC.pref = (k, d) => (S.prefs[k] === undefined || S.prefs[k] === null ? d : S.prefs[k]);
  TC.applyPrefs = () => {
    const p = S.prefs, r = document.documentElement;
    r.dataset.theme = p.theme || 'light';
    r.dataset.density = p.density || 'comfortable';
    r.dataset.bubble = p.bubble || 'round';
    r.dataset.size = p.size || 'md';
    if (p.accent) { r.style.setProperty('--accent', p.accent); r.style.setProperty('--accent-text', contrastText(p.accent)); }
    else { r.style.removeProperty('--accent'); r.style.removeProperty('--accent-text'); }
    const f = TC.FONTS.find((x) => x.id === (p.font || 'system')) || TC.FONTS[0];
    loadFont(f);
    if (TC.lang === 'hi' || TC.lang === 'mr') loadDevanagari();
    r.style.setProperty('--font', f.family + ', "Noto Sans Devanagari", "Mukta", "Nirmala UI", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif');
    r.style.setProperty('--wallpaper', TC.wallpaperCSS(p.wallpaper || 'doodle'));
    r.lang = TC.lang || 'en';
    const meta = document.querySelector('meta[name=theme-color]');
    if (meta) { const hd = getComputedStyle(r).getPropertyValue('--header').trim(); if (hd) meta.setAttribute('content', hd); }
  };
  const savePrefsRemote = TC.debounce(() => {
    if (!S.token) return;
    TC.api('/me', { method: 'PATCH', body: { prefs: S.prefs }, noRedirect: true }).then((r) => { S.me = r.user; LS.set('tc_me', r.user); }).catch(() => {});
  }, 600);
  TC.setPref = (k, v) => {
    S.prefs[k] = v;
    LS.set('tc_prefs', S.prefs);
    if (k === 'lang') TC.lang = v;
    TC.applyPrefs();
    savePrefsRemote();
    if (k === 'lang') TC.emit('lang');
  };
  TC.detectLang = () => {
    const saved = S.prefs.lang;
    if (saved && TC.T[saved]) return saved;
    const nav = (navigator.language || 'en').toLowerCase();
    return nav.startsWith('hi') ? 'hi' : nav.startsWith('mr') ? 'mr' : 'en';
  };

  /* ================= router ================= */
  const routes = [];
  TC.route = (pattern, fn, opts) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:[a-z]+/gi, (m) => { keys.push(m.slice(1)); return '([^/]+)'; }) + '/?$');
    routes.push({ re, keys, fn, opts: opts || {} });
  };
  TC.path = () => (location.hash.replace(/^#/, '') || '/chats');
  TC.go = (p) => { if (TC.path() === p) TC.resolve(); else location.hash = '#' + p; };
  TC.resolve = () => {
    if (!S.token || !S.me) return;
    const path = TC.path();
    const view = TC.$('#view');
    if (!view) return;
    TC._cleanups.splice(0).forEach((fn) => { try { fn(); } catch (e) { /* ignore */ } });
    TC.closeMenu();
    for (const r of routes) {
      const m = r.re.exec(path);
      if (!m) continue;
      if (r.opts.admin && !TC.isAdmin()) { location.hash = '#/chats'; return; }
      const params = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      view.className = 'view' + (r.opts.cls ? ' ' + r.opts.cls : '');
      view.replaceChildren();
      document.body.dataset.route = r.opts.name || '';
      r.fn(view, params);
      TC.emit('route', path);
      return;
    }
    location.hash = '#/chats';
  };
  window.addEventListener('hashchange', () => TC.resolve());

  /* ================= WebSocket ================= */
  const W = { sock: null, tries: 0, timer: null, ping: null, everOpen: false };
  function setConn(c) { S.conn = c; TC.emit('conn', c); }
  TC.closeWS = (final) => {
    clearTimeout(W.timer); clearInterval(W.ping);
    if (W.sock) { W.sock.onclose = W.sock.onerror = W.sock.onmessage = null; try { W.sock.close(); } catch (e) { /* ignore */ } W.sock = null; }
    if (final) { W.tries = 0; W.everOpen = false; setConn('idle'); }
  };
  TC.connectWS = () => {
    if (!S.token) return;
    TC.closeWS(false);
    setConn('connecting');
    let ws;
    try { ws = new WebSocket(CFG.WS_URL + (CFG.WS_URL.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(S.token)); }
    catch (e) { retry(); return; }
    W.sock = ws;
    ws.onopen = () => {
      W.tries = 0; setConn('online');
      clearInterval(W.ping);
      W.ping = setInterval(() => { if (ws.readyState === 1) ws.send('{"type":"ping"}'); }, 25000);
      if (W.everOpen) TC.resync();
      W.everOpen = true;
    };
    ws.onmessage = (e) => { let p; try { p = JSON.parse(e.data); } catch (_) { return; } handleWS(p); };
    ws.onclose = () => { clearInterval(W.ping); if (!S.token) return; setConn('offline'); retry(); };
    ws.onerror = () => { try { ws.close(); } catch (e) { /* ignore */ } };
  };
  function retry() { clearTimeout(W.timer); W.timer = setTimeout(TC.connectWS, Math.min(15000, 1000 * Math.pow(2, W.tries++))); }
  TC.wsSend = (obj) => { if (W.sock && W.sock.readyState === 1) { W.sock.send(JSON.stringify(obj)); return true; } return false; };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && S.token) {
      if (!W.sock || W.sock.readyState > 1) { W.tries = 0; TC.connectWS(); }
      if (S.activeChat) TC.markReadSoon(S.activeChat);
    }
  });
  window.addEventListener('online', () => { if (S.token && (!W.sock || W.sock.readyState > 1)) { W.tries = 0; TC.connectWS(); } });

  /* ================= chat data layer ================= */
  const chatById = (id) => S.chats.find((c) => c.id === Number(id));
  TC.chat = chatById;
  const sortChats = () => S.chats.sort((a, b) => (b.my.pinned - a.my.pinned) || String(b.ts).localeCompare(String(a.ts)));
  TC.totalUnread = () => S.chats.reduce((n, c) => n + (c.my.muted || c.my.archived ? 0 : c.unread || 0), 0);

  TC.loadChats = async () => {
    const r = await TC.api('/chats');
    S.chats = r.chats; S.chatsLoaded = true; sortChats();
    TC.emit('chats');
    return S.chats;
  };
  TC.upsertChat = (c) => {
    const i = S.chats.findIndex((x) => x.id === c.id);
    if (i >= 0) { c.unread = S.activeChat === c.id ? 0 : Math.max(c.unread || 0, 0); S.chats[i] = c; } else S.chats.push(c);
    sortChats(); TC.emit('chats'); TC.emit('chat_changed', c.id);
  };
  TC.slot = (id) => S.msgs[id];
  TC.ensureMessages = async (id) => {
    let s = S.msgs[id];
    if (s && s.loaded) return s;
    const r = await TC.api('/chats/' + id + '/messages?limit=40');
    s = S.msgs[id] = { list: r.messages, hasMore: r.has_more, loaded: true };
    return s;
  };
  TC.loadOlder = async (id) => {
    const s = S.msgs[id];
    if (!s || !s.list.length || !s.hasMore) return 0;
    const r = await TC.api('/chats/' + id + '/messages?limit=40&before=' + s.list[0].id);
    s.list = r.messages.concat(s.list); s.hasMore = r.has_more;
    return r.messages.length;
  };
  TC.resync = async () => {
    try {
      await TC.loadChats();
      for (const id of Object.keys(S.msgs)) {
        const s = S.msgs[id];
        if (!s.loaded || !s.list.length) continue;
        const last = s.list[s.list.length - 1].id;
        const r = await TC.api('/chats/' + id + '/messages?after=' + last);
        r.messages.forEach((m) => { if (!s.list.some((x) => x.id === m.id)) s.list.push(m); });
        TC.emit('resync', Number(id));
      }
    } catch (e) { /* ignore */ }
  };
  TC.addMessage = (m, retried) => {
    const c = chatById(m.chat_id);
    if (!c) {
      if (!retried) TC.loadChats().then(() => TC.addMessage(m, true)).catch(() => {});
      return;
    }
    const s = S.msgs[m.chat_id];
    const fresh = !(s && s.list.some((x) => x.id === m.id));
    if (s && s.loaded && fresh) s.list.push(m);
    c.last_message = { id: m.id, kind: m.kind, body: m.body.slice(0, 120), deleted: m.deleted, sender_id: m.sender_id, sender_name: m.sender_name, file_name: m.file ? m.file.name : '', created_at: m.created_at };
    c.ts = m.created_at;
    const mine = m.sender_id === S.me.id;
    if (fresh && !mine) {
      const viewing = S.activeChat === c.id && document.visibilityState === 'visible';
      if (viewing) TC.markReadSoon(c.id);
      else { c.unread = (c.unread || 0) + 1; if (!c.my.muted) TC.notify(c, m); }
    }
    sortChats();
    TC.emit('chats');
    TC.emit('message', m);
  };
  TC.markRead = (id) => {
    const c = chatById(id);
    if (!c || !c.last_message) return;
    if (!c.unread && c.my.last_read_id >= c.last_message.id) return;
    c.unread = 0; c.my.last_read_id = c.last_message.id;
    TC.emit('chats');
    if (!TC.wsSend({ type: 'read', chat_id: c.id })) TC.api('/chats/' + c.id + '/read', { method: 'POST', body: {}, noRedirect: true }).catch(() => {});
  };
  TC.markReadSoon = TC.debounce((id) => TC.markRead(id), 250);
  TC.msgStatus = (m, c) => {
    const others = c.members.filter((x) => x.user.id !== S.me.id);
    if (!others.length) return 'sent';
    const rd = Math.min.apply(null, others.map((x) => x.last_read_id));
    const dl = Math.min.apply(null, others.map((x) => x.last_delivered_id));
    return m.id <= rd ? 'read' : m.id <= dl ? 'delivered' : 'sent';
  };
  TC.chatPreview = (c) => {
    const l = c.last_message;
    if (!l) return t('chat.noMessages');
    if (l.deleted) return t('chat.deleted');
    const icons = { image: '📷 ', video: '🎬 ', audio: '🎤 ', file: '📎 ', poll: '📊 ' };
    let txt = (icons[l.kind] || '') + (l.kind === 'text' || l.kind === 'system' ? l.body : (l.body || l.file_name || t('kind.' + l.kind)));
    txt = txt.replace(/\s+/g, ' ');
    if (c.kind === 'group' && l.kind !== 'system' && l.sender_id !== S.me.id) txt = (l.sender_name || '').split(' ')[0] + ': ' + txt;
    return txt;
  };
  TC.isOnline = (uid) => S.online.has(uid);

  function patchMessage(m) {
    const s = S.msgs[m.chat_id];
    if (s) { const i = s.list.findIndex((x) => x.id === m.id); if (i >= 0) { m.starred = s.list[i].starred; s.list[i] = m; } }
    const c = chatById(m.chat_id);
    if (c && c.last_message && c.last_message.id === m.id) { c.last_message.body = m.body.slice(0, 120); c.last_message.deleted = m.deleted; }
  }

  function handleWS(p) {
    switch (p.type) {
      case 'ready': S.online = new Set(p.online); TC.emit('presence'); break;
      case 'presence':
        if (p.online) S.online.add(p.user_id); else S.online.delete(p.user_id);
        if (p.last_seen) S.chats.forEach((c) => c.members.forEach((mm) => { if (mm.user.id === p.user_id) mm.user.last_seen = p.last_seen; if (c.other && c.other.id === p.user_id) c.other.last_seen = p.last_seen; }));
        TC.emit('presence', p); break;
      case 'message': TC.addMessage(p.message); break;
      case 'message_update': patchMessage(p.message); TC.emit('message_update', p.message); TC.emit('chats'); break;
      case 'message_hidden': {
        const s = S.msgs[p.chat_id];
        if (s) s.list = s.list.filter((x) => x.id !== p.message_id);
        TC.emit('message_hidden', p); break;
      }
      case 'reactions': {
        const s = S.msgs[p.chat_id];
        const m = s && s.list.find((x) => x.id === p.message_id);
        if (m) m.reactions = p.reactions;
        TC.emit('reactions', p); break;
      }
      case 'delivered': {
        const c = chatById(p.chat_id);
        if (c) { c.members.forEach((mm) => { if (p.user_ids.includes(mm.user.id)) mm.last_delivered_id = Math.max(mm.last_delivered_id, p.upto); }); TC.emit('receipts', p.chat_id); }
        break;
      }
      case 'read': {
        const c = chatById(p.chat_id);
        if (c) {
          c.members.forEach((mm) => { if (mm.user.id === p.user_id) { mm.last_read_id = Math.max(mm.last_read_id, p.upto); mm.last_delivered_id = Math.max(mm.last_delivered_id, p.upto); } });
          if (p.user_id === S.me.id) { c.my.last_read_id = Math.max(c.my.last_read_id, p.upto); if (!c.last_message || c.last_message.id <= p.upto) c.unread = 0; TC.emit('chats'); }
          TC.emit('receipts', p.chat_id);
        }
        break;
      }
      case 'typing': {
        const tp = (S.typing[p.chat_id] = S.typing[p.chat_id] || {});
        clearTimeout(tp[p.user_id] && tp[p.user_id].t);
        tp[p.user_id] = { name: p.name, t: setTimeout(() => { delete tp[p.user_id]; TC.emit('typing', p.chat_id); }, 3500) };
        TC.emit('typing', p.chat_id); break;
      }
      case 'chat_update': TC.upsertChat(p.chat); break;
      case 'chat_removed':
        S.chats = S.chats.filter((c) => c.id !== p.chat_id); delete S.msgs[p.chat_id];
        TC.emit('chats'); TC.emit('chat_removed', p.chat_id); break;
      case 'force_logout': TC.forceLogout(p.reason || 'signed_out'); break;
      case 'poll': {
        const sl = S.msgs[p.chat_id];
        const pm = sl && sl.list.find((x) => x.id === p.message_id);
        if (pm) pm.poll = p.poll;
        TC.emit('poll', p); break;
      }
      case 'ticket':
        TC.emit('ticket', p);
        if (S.me && p.assignee_id === S.me.id && p.by !== S.me.id && (p.event === 'created' || p.event === 'updated')) { TC.toast(t('tickets.assignedToYou', { n: p.ticket_id }), 'info'); TC.beep(); }
        break;
      case 'features_update': if (S.me) { S.me.features = p.features; LS.set('tc_me', S.me); TC.emit('me'); } break;
      case 'error': if (p.error === 'auth') TC.forceLogout('expired'); break;
      default: break;
    }
  }

  /* ================= quick replies ================= */
  TC.snippets = [];
  TC.loadSnippets = () => TC.api('/snippets', { noRedirect: true }).then((r) => { TC.snippets = r.snippets; TC.emit('snippets'); }).catch(() => {});

  /* ================= sound + notifications ================= */
  let actx;
  TC.beep = () => {
    if (TC.pref('sound', true) === false) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = 'sine'; o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, actx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.15, actx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + 0.25);
      o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime + 0.26);
    } catch (e) { /* ignore */ }
  };
  TC.notify = (c, m) => {
    TC.beep();
    try {
      if ('Notification' in window && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
        const body = m.deleted ? '' : m.kind === 'text' ? m.body : '[' + t('kind.' + m.kind) + '] ' + (m.file ? m.file.name : '');
        const n = new Notification(c.kind === 'group' ? c.name + ' · ' + m.sender_name : m.sender_name, { body, icon: 'icons/icon-192.png', tag: 'chat-' + c.id });
        n.onclick = () => { window.focus(); location.hash = '#/chats/' + c.id; n.close(); };
      }
    } catch (e) { /* ignore */ }
  };
})();
