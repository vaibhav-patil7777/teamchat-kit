(function () {
  'use strict';
  const TC = window.TC;
  const { h, ic, S } = TC;
  const t = (...a) => TC.t(...a);
  const root = document.getElementById('app');
  let appName = 'TeamChat';

  const LANGS = [['en', 'English'], ['hi', 'हिन्दी'], ['mr', 'मराठी']];

  /* ================= PWA ================= */
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); TC.installEvt = e; TC.emit('installable'); });
  window.addEventListener('appinstalled', () => { TC.installEvt = null; TC.emit('installable'); });
  TC.installApp = async () => {
    if (!TC.installEvt) return;
    TC.installEvt.prompt();
    try { await TC.installEvt.userChoice; } catch (e) { /* ignore */ }
    TC.installEvt = null; TC.emit('installable');
  };
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));

  /* ================= login ================= */
  function renderLogin(reason) {
    document.body.classList.remove('in-chat');
    document.body.dataset.route = 'login';
    const user = h('input', { class: 'input lg', id: 'loginUser', autocomplete: 'username', autocapitalize: 'off', spellcheck: 'false', placeholder: t('login.usernamePh'), required: true });
    const pass = h('input', { class: 'input lg', id: 'loginPass', type: 'password', autocomplete: 'current-password', placeholder: t('login.passwordPh'), required: true });
    const err = h('div', { class: 'form-error hidden', role: 'alert' });
    const eye = h('button', { class: 'icon-btn eye', type: 'button', title: t('login.show'), onclick: () => { pass.type = pass.type === 'password' ? 'text' : 'password'; } }, ic('eye', 20));
    const btn = h('button', { class: 'btn primary lg block', type: 'submit' }, t('login.signIn'));
    const form = h('form', { class: 'login-form', novalidate: true },
      h('label', { class: 'label', for: 'loginUser' }, t('login.username')), h('div', { class: 'input-icon' }, ic('user', 18), user),
      h('label', { class: 'label', for: 'loginPass' }, t('login.password')), h('div', { class: 'input-icon' }, ic('lock', 18), pass, eye),
      err, btn);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.classList.add('hidden');
      if (!user.value.trim() || !pass.value) { err.textContent = t('login.required'); err.classList.remove('hidden'); return; }
      btn.disabled = true; btn.textContent = t('login.signingIn');
      try {
        const r = await TC.api('/auth/login', { method: 'POST', body: { username: user.value.trim(), password: pass.value }, noRedirect: true });
        TC.setSession(r.token, r.user);
        TC.setMe(r.user);
        TC.lang = TC.detectLang(); TC.applyPrefs();
        renderApp();
      } catch (ex) { err.textContent = TC.errMsg(ex); err.classList.remove('hidden'); btn.disabled = false; btn.textContent = t('login.signIn'); }
    });
    const langs = h('div', { class: 'login-langs' }, LANGS.map(([k, n]) => h('button', { type: 'button', class: TC.lang === k ? 'active' : '', onclick: () => TC.setPref('lang', k) }, n)));
    root.replaceChildren(h('div', { class: 'login-wrap' },
      h('div', { class: 'login-card' },
        h('div', { class: 'login-brand' }, h('img', { src: 'icons/icon-192.png', alt: '', width: 64, height: 64 }), h('h1', null, appName), h('p', { class: 'muted' }, t('login.subtitle'))),
        reason ? h('div', { class: 'notice' }, ic('info', 18), t('logout.' + reason)) : null,
        form, h('p', { class: 'login-hint' }, ic('shield', 16), t('login.adminOnly'))),
      langs));
    user.focus();
  }

  /* ================= shell ================= */
  function navItems() {
    const items = [
      { id: 'chats', path: '/chats', icon: 'chat', label: t('nav.chats'), badge: TC.totalUnread() },
      TC.can('status') ? { id: 'status', path: '/status', icon: 'status', label: t('nav.status') } : null,
      { id: 'people', path: '/people', icon: 'users', label: t('nav.people') },
      TC.can('star_messages') ? { id: 'starred', path: '/starred', icon: 'star', label: t('nav.starred') } : null,
      TC.can('tickets') ? { id: 'tickets', path: '/tickets', icon: 'clipboard', label: t('nav.tickets'), badge: TC.openTicketsForMe || 0 } : null,
      { id: 'settings', path: '/settings/profile', icon: 'settings', label: t('nav.settings') },
    ].filter(Boolean);
    const admin = TC.isAdmin() ? [
      { id: 'admin', path: '/admin', icon: 'grid', label: t('admin.dashboard') },
      { id: 'admin-users', path: '/admin/users', icon: 'users', label: t('admin.users') },
      { id: 'admin-permissions', path: '/admin/permissions', icon: 'sliders', label: t('admin.permissions') },
      { id: 'admin-groups', path: '/admin/groups', icon: 'layers', label: t('admin.groups') },
      { id: 'admin-webhooks', path: '/admin/webhooks', icon: 'link', label: t('admin.webhooks') },
      { id: 'admin-announce', path: '/admin/announce', icon: 'megaphone', label: t('admin.announce') },
      { id: 'admin-audit', path: '/admin/audit', icon: 'file-text', label: t('admin.audit') },
      { id: 'admin-storage', path: '/admin/storage', icon: 'drive', label: t('admin.storage') },
      { id: 'admin-settings', path: '/admin/settings', icon: 'settings', label: t('admin.appSettings') },
    ] : [];
    return { items, admin };
  }
  const isActive = (it, path) => (it.id === 'admin' ? path === '/admin' : it.id === 'chats' ? path.startsWith('/chats') : it.id === 'settings' ? path.startsWith('/settings') : path.startsWith(it.path));

  function renderApp() {
    document.body.classList.remove('in-chat');
    const me = S.me;
    appName = me.app_name || appName;

    const connPill = h('div', { class: 'conn', id: 'connPill' }, h('i', { class: 'dot' }), h('span', null));
    const drawConn = () => {
      const c = S.conn; connPill.className = 'conn ' + c;
      connPill.querySelector('span').textContent = t('conn.' + (c === 'idle' ? 'connecting' : c));
    };

    const searchBtn = h('button', { class: 'topbar-search', onclick: () => openGlobalSearch() }, ic('search', 18), h('span', null, t('search.placeholder')), h('kbd', null, 'Ctrl K'));
    const langBtn = h('button', { class: 'icon-btn', title: t('settings.language'), onclick: (e) => TC.menu(e.currentTarget, LANGS.map(([k, n]) => ({ icon: 'globe', label: n, check: TC.lang === k, onClick: () => TC.setPref('lang', k) })), { alignRight: true }) }, ic('globe', 20));
    const themeBtn = TC.can('change_theme') ? h('button', { class: 'icon-btn', title: t('settings.theme'), onclick: () => { const dark = ['dark', 'amoled', 'slate'].includes(TC.pref('theme', 'light')); TC.setPref('theme', dark ? 'light' : 'dark'); drawThemeIcon(); } }) : null;
    const drawThemeIcon = () => { if (!themeBtn) return; const dark = ['dark', 'amoled', 'slate'].includes(TC.pref('theme', 'light')); themeBtn.replaceChildren(ic(dark ? 'sun' : 'moon', 20)); };
    drawThemeIcon();
    const installBtn = h('button', { class: 'icon-btn hidden', title: t('pwa.install'), onclick: () => TC.installApp() }, ic('download', 20));
    const drawInstall = () => installBtn.classList.toggle('hidden', !TC.installEvt);
    drawInstall();

    const userBtn = h('button', { class: 'user-btn', onclick: (e) => TC.menu(e.currentTarget, [
      { icon: 'user', label: t('settings.profile'), onClick: () => TC.go('/settings/profile') },
      { icon: 'palette', label: t('settings.appearance'), onClick: () => TC.go('/settings/appearance') },
      TC.installEvt ? { icon: 'download', label: t('pwa.install'), onClick: () => TC.installApp() } : null,
      { divider: true },
      { icon: 'logout', label: t('nav.signOut'), danger: true, onClick: doLogout },
    ], { alignRight: true, header: h('div', { class: 'menu-user' }, TC.avatar(S.me.name, S.me.avatar, 40), h('div', null, h('div', { class: 'strong' }, S.me.name), h('div', { class: 'muted small' }, '@' + S.me.username + (TC.isAdmin() ? ' · ' + t('chat.adminBadge') : '')))) }) }, TC.avatar(me.name, me.avatar, 34));

    const topbar = h('header', { class: 'topbar' },
      h('a', { class: 'brand', href: '#/chats' }, h('img', { src: 'icons/icon-192.png', alt: '', width: 28, height: 28 }), h('span', null, appName)),
      searchBtn, h('div', { class: 'grow' }),
      connPill, installBtn, themeBtn, langBtn, userBtn);

    const side = h('nav', { class: 'sidenav', 'aria-label': 'Main' });
    const bottom = h('nav', { class: 'bottomnav', 'aria-label': 'Main' });
    const subnav = h('nav', { class: 'subnav' });
    const banner = h('div', { id: 'banner' });
    const view = h('main', { id: 'view', class: 'view' });

    const drawNav = () => {
      const path = TC.path();
      const { items, admin } = navItems();
      const link = (it, cls) => h('a', { class: cls + (isActive(it, path) ? ' active' : ''), href: '#' + it.path, title: it.label, 'aria-current': isActive(it, path) ? 'page' : null }, h('span', { class: 'nav-ic' }, ic(it.icon, 22), it.badge ? h('span', { class: 'nav-badge' }, it.badge > 99 ? '99+' : it.badge) : null), h('span', { class: 'nav-label' }, it.label));
      side.replaceChildren(...items.map((it) => link(it, 'nav-item')), admin.length ? h('div', { class: 'nav-section' }, ic('shield', 14), t('nav.admin')) : null, ...admin.map((it) => link(it, 'nav-item')));
      const mob = items.slice(0, 3).concat(admin.length ? [{ id: 'admin', path: '/admin', icon: 'shield', label: t('nav.admin') }] : [], items.slice(3));
      bottom.replaceChildren(...mob.map((it) => link(it, 'bn-item')));
      subnav.replaceChildren(...(path.startsWith('/admin') ? admin.map((it) => h('a', { class: 'sn-chip' + (isActive(it, path) ? ' active' : ''), href: '#' + it.path }, ic(it.icon, 16), it.label)) : []));
      subnav.classList.toggle('hidden', !path.startsWith('/admin'));
      const n = TC.totalUnread();
      document.title = (n ? '(' + n + ') ' : '') + appName;
    };
    const drawBanner = () => {
      banner.replaceChildren();
      if (S.me.using_default_password) banner.appendChild(h('div', { class: 'banner warn' }, ic('alert', 18), h('span', null, t('banner.defaultPassword')), h('a', { class: 'btn small primary', href: '#/settings/security' }, t('banner.change'))));
      if (!navigator.onLine) banner.appendChild(h('div', { class: 'banner info' }, ic('wifi', 18), h('span', null, t('banner.offline'))));
    };

    root.replaceChildren(h('div', { class: 'shell' }, topbar, h('div', { class: 'shell-body' }, side, h('div', { class: 'content' }, banner, subnav, view)), bottom));
    drawConn(); drawNav(); drawBanner();

    // global (persistent) listeners — replaced on every renderApp
    (renderApp.offs || []).forEach((f) => f());
    renderApp.offs = [
      TC.on('conn', drawConn, true), TC.on('route', drawNav, true), TC.on('chats', drawNav, true), TC.on('installable', drawInstall, true),
      TC.on('me', () => { drawNav(); drawBanner(); }, true),
    ];
    window.onoffline = window.ononline = drawBanner;

    TC.connectWS();
    TC.loadChats().catch(() => {});
    TC.loadSnippets();
    if (TC.refreshTicketBadge) TC.refreshTicketBadge();
    TC.resolve();
    if (!location.hash || location.hash === '#') location.hash = '#/chats';
    if (S.me.must_change_password) forcePasswordChange();
    TC.api('/me', { noRedirect: false }).then((r) => { TC.setMe(r.user); drawNav(); drawBanner(); if (r.user.must_change_password) forcePasswordChange(); }).catch(() => {});
  }

  function forcePasswordChange() {
    if (document.getElementById('forcePw')) return;
    const cur = h('input', { class: 'input', type: 'password', autocomplete: 'current-password' });
    const nw = h('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
    const nw2 = h('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
    const m = TC.modal({
      title: t('force.title'), dismissible: false,
      body: h('div', { id: 'forcePw' }, h('p', { class: 'muted' }, t('force.text')), h('label', { class: 'label' }, t('settings.currentPassword')), cur, h('label', { class: 'label' }, t('settings.newPassword')), nw, h('label', { class: 'label' }, t('settings.confirmPassword')), nw2, h('p', { class: 'muted small' }, t('settings.passwordHint'))),
      actions: [{ label: t('nav.signOut'), kind: 'ghost', onClick: () => { doLogout(); } }, { label: t('settings.updatePassword'), kind: 'primary', onClick: async () => {
        if (nw.value !== nw2.value) { TC.toast(t('settings.passwordMismatch'), 'error'); return false; }
        await TC.api('/auth/change-password', { method: 'POST', body: { current_password: cur.value, new_password: nw.value } });
        TC.setMe(Object.assign({}, S.me, { must_change_password: false, using_default_password: false }));
        TC.toast(t('settings.passwordChanged'), 'success');
      } }],
    });
    return m;
  }

  async function doLogout() {
    try { await TC.api('/auth/logout', { method: 'POST', body: {}, noRedirect: true }); } catch (e) { /* ignore */ }
    TC.clearSession();
    location.hash = '';
    renderLogin();
  }

  /* ================= global search ================= */
  function openGlobalSearch() {
    if (!TC.can('search')) { TC.toast(t('err.feature_disabled'), 'error'); return; }
    const inp = h('input', { class: 'input lg', type: 'search', placeholder: t('search.placeholder'), autocomplete: 'off' });
    const res = h('div', { class: 'gs-results' }, h('div', { class: 'empty-small' }, t('search.hint')));
    const m = TC.modal({ title: t('search.title'), body: [inp, res], wide: true });
    const go = (hash) => { m.close(); location.hash = hash; };
    inp.addEventListener('input', TC.debounce(async () => {
      const q = inp.value.trim();
      if (q.length < 2) { res.replaceChildren(h('div', { class: 'empty-small' }, t('search.hint'))); return; }
      try {
        const r = await TC.api('/search?q=' + encodeURIComponent(q));
        res.replaceChildren();
        if (r.people.length) res.appendChild(h('div', { class: 'gs-group' }, h('div', { class: 'section-title' }, t('nav.people')), r.people.map((u) => h('button', { class: 'gs-item', onclick: () => { m.close(); TC.openDirect(u.id); } }, TC.avatar(u.name, u.avatar, 34), h('div', { class: 'grow' }, h('div', { class: 'strong' }, u.name), h('div', { class: 'muted small' }, '@' + u.username))))));
        if (r.chats.length) res.appendChild(h('div', { class: 'gs-group' }, h('div', { class: 'section-title' }, t('filter.groups')), r.chats.map((c) => h('button', { class: 'gs-item', onclick: () => go('#/chats/' + c.id) }, TC.avatar(c.name, c.avatar, 34), h('div', { class: 'grow strong' }, c.name)))));
        if (r.messages.length) res.appendChild(h('div', { class: 'gs-group' }, h('div', { class: 'section-title' }, t('search.messages')), r.messages.map((x) => {
          const c = TC.chat(x.chat_id);
          return h('button', { class: 'gs-item col', onclick: () => go('#/chats/' + x.chat_id) }, h('div', { class: 'row between w100' }, h('span', { class: 'strong small' }, (c ? c.name : x.chat_name) + ' · ' + x.sender_name), h('span', { class: 'muted small' }, TC.fmtDateTime(x.created_at))), h('div', { class: 'ellipsis w100' }, x.body || (x.file && x.file.name)));
        })));
        if (!res.children.length) res.appendChild(h('div', { class: 'empty-small' }, t('common.noResults')));
      } catch (e) { TC.fail(e); }
    }, 300));
  }
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && S.token && S.me) { e.preventDefault(); openGlobalSearch(); }
  });

  /* ================= boot ================= */
  TC.on('logout', (reason) => { location.hash = ''; renderLogin(reason); }, true);
  TC.on('lang', () => { if (S.token && S.me) { renderApp(); } else renderLogin(); }, true);

  (async function boot() {
    TC.lang = TC.detectLang();
    TC.applyPrefs();
    try { const pub = await fetch(window.APP_CONFIG.API_BASE + '/public').then((r) => r.json()); if (pub && pub.app_name) appName = pub.app_name; } catch (e) { /* offline */ }
    if (S.token && S.me) {
      TC.setMe(S.me);
      TC.lang = TC.detectLang(); TC.applyPrefs();
      renderApp();
    } else renderLogin();
  })();
})();
