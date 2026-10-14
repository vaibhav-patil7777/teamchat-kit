(function () {
  'use strict';
  const TC = window.TC;
  const { h, ic, S } = TC;
  const t = (...a) => TC.t(...a);

  const pageHead = (title, sub, right) => h('div', { class: 'page-head' }, h('div', null, h('h1', null, title), sub ? h('p', { class: 'muted' }, sub) : null), right || null);

  /* ================= People ================= */
  TC.route('/people', (view) => {
    const grid = h('div', { class: 'people-grid' });
    const search = h('input', { class: 'input', type: 'search', placeholder: t('common.searchPeople') });
    view.append(pageHead(t('nav.people'), t('people.sub')), h('div', { class: 'toolbar' }, h('div', { class: 'input-icon' }, ic('search', 18), search)), grid);
    const load = async () => {
      try {
        const r = await TC.api('/users?q=' + encodeURIComponent(search.value.trim()));
        grid.replaceChildren();
        if (!r.users.length) grid.appendChild(h('div', { class: 'empty-small' }, t('common.noResults')));
        r.users.forEach((u) => grid.appendChild(h('div', { class: 'person-card' },
          h('div', { class: 'avatar-wrap' }, TC.avatar(u.name, u.avatar, 56), TC.isOnline(u.id) ? h('i', { class: 'dot online' }) : null),
          h('div', { class: 'strong' }, u.name, u.role === 'admin' ? h('span', { class: 'badge-admin' }, t('chat.adminBadge')) : null),
          h('div', { class: 'muted small' }, [u.designation, u.department].filter(Boolean).join(' · ') || '@' + u.username),
          h('div', { class: 'muted small ellipsis2' }, u.about),
          h('button', { class: 'btn primary small', onclick: () => TC.openDirect(u.id) }, ic('chat', 16), t('people.message')))));
      } catch (e) { TC.fail(e); }
    };
    search.addEventListener('input', TC.debounce(load, 250));
    TC.on('presence', TC.debounce(load, 400));
    load();
  }, { name: 'people' });

  /* ================= Starred ================= */
  TC.route('/starred', (view) => {
    const list = h('div', { class: 'starred-list' });
    view.append(pageHead(t('nav.starred'), t('starred.sub')), list);
    if (!TC.can('star_messages')) { list.appendChild(h('div', { class: 'empty-state' }, h('p', { class: 'muted' }, t('err.feature_disabled')))); return; }
    TC.api('/starred').then((r) => {
      if (!r.messages.length) { list.appendChild(h('div', { class: 'empty-state' }, h('div', { class: 'empty-art' }, ic('star', 48)), h('p', { class: 'muted' }, t('starred.empty')))); return; }
      r.messages.forEach((m) => list.appendChild(h('a', { class: 'starred-item', href: '#/chats/' + m.chat_id },
        h('div', { class: 'row between' }, h('span', { class: 'strong' }, m.sender_name), h('span', { class: 'muted small' }, m.chat_name + ' · ' + TC.fmtDateTime(m.created_at))),
        h('div', null, m.body || (m.file ? m.file.name : ''))))); 
    }).catch(TC.fail);
  }, { name: 'starred' });

  /* ================= Settings ================= */
  const SETTINGS_TABS = [
    ['profile', 'user'], ['appearance', 'palette'], ['language', 'globe'], ['snippets', 'zap'], ['notifications', 'bell'], ['security', 'lock'], ['about', 'info'],
  ];
  TC.route('/settings', (v) => { location.hash = '#/settings/profile'; });
  TC.route('/settings/:tab', (view, p) => {
    const tab = SETTINGS_TABS.some((x) => x[0] === p.tab) ? p.tab : 'profile';
    const nav = h('nav', { class: 'settings-nav' }, SETTINGS_TABS.map(([k, icon]) => h('a', { class: 'sn-item' + (k === tab ? ' active' : ''), href: '#/settings/' + k }, ic(icon, 20), h('span', null, t('settings.' + k)))));
    const body = h('div', { class: 'settings-body' });
    view.append(pageHead(t('nav.settings')), h('div', { class: 'settings-layout' }, nav, body));
    ({ profile, appearance, language, snippets, notifications, security, about }[tab])(body);
  }, { name: 'settings' });

  const card = (title, ...kids) => h('section', { class: 'card' }, title ? h('h3', null, title) : null, kids);

  function profile(body) {
    const u = S.me;
    const canEdit = TC.can('change_profile');
    const name = h('input', { class: 'input', value: u.name, maxlength: '100', disabled: !canEdit });
    const about = h('input', { class: 'input', value: u.about || '', maxlength: '200', disabled: !canEdit });
    const f = h('input', { type: 'file', accept: 'image/*', class: 'hidden' });
    const avBox = h('div', { class: 'avatar-big' });
    const drawAv = () => avBox.replaceChildren(TC.avatar(S.me.name, S.me.avatar, 110));
    drawAv();
    f.addEventListener('change', async () => {
      if (!f.files[0]) return;
      const fd = new FormData(); fd.append('file', f.files[0]);
      try { const r = await TC.api('/me/avatar', { method: 'POST', form: fd }); TC.setMe(r.user); drawAv(); TC.toast(t('common.saved'), 'success'); } catch (e) { TC.fail(e); }
    });
    body.append(card(t('settings.profile'),
      h('div', { class: 'profile-top' }, avBox, canEdit ? h('div', { class: 'col gap-s' }, h('button', { class: 'btn primary small', onclick: () => f.click() }, ic('camera', 16), t('settings.changePhoto')),
        u.avatar ? h('button', { class: 'btn ghost small', onclick: async () => { try { const r = await TC.api('/me/avatar/remove', { method: 'POST', body: {} }); TC.setMe(r.user); drawAv(); } catch (e) { TC.fail(e); } } }, t('settings.removePhoto')) : null, f) : null),
      h('label', { class: 'label' }, t('settings.name')), name,
      h('label', { class: 'label' }, t('settings.about_me')), about,
      h('label', { class: 'label' }, t('settings.username')), h('input', { class: 'input', value: '@' + u.username, disabled: true }),
      u.designation || u.department ? [h('label', { class: 'label' }, t('settings.work')), h('input', { class: 'input', value: [u.designation, u.department].filter(Boolean).join(' · '), disabled: true })] : null,
      !canEdit ? h('p', { class: 'muted small' }, t('settings.profileLocked')) : h('div', { class: 'form-actions' }, h('button', { class: 'btn primary', onclick: async () => {
        try { const r = await TC.api('/me', { method: 'PATCH', body: { display_name: name.value, about: about.value } }); TC.setMe(r.user); TC.toast(t('common.saved'), 'success'); } catch (e) { TC.fail(e); }
      } }, t('common.save')))));
  }

  function chipGroup(options, current, onPick, labelFn) {
    const box = h('div', { class: 'chip-group' });
    const draw = (cur) => box.replaceChildren(...options.map((o) => h('button', { type: 'button', class: 'opt' + (cur === o ? ' active' : ''), onclick: () => { onPick(o); draw(o); } }, labelFn ? labelFn(o) : o)));
    draw(current);
    return box;
  }

  function appearance(body) {
    if (!TC.can('change_theme')) { body.append(card(t('settings.appearance'), h('p', { class: 'muted' }, t('settings.themeLocked')))); return; }
    const P = (k, d) => TC.pref(k, d);
    // theme grid
    const grid = h('div', { class: 'theme-grid' });
    const drawThemes = () => grid.replaceChildren(...TC.THEMES.map((th) => h('button', { type: 'button', class: 'theme-card' + (P('theme', 'light') === th.id ? ' active' : ''), onclick: () => { TC.setPref('theme', th.id); drawThemes(); } },
      h('div', { class: 'theme-prev', style: { background: th.bg, color: th.fg } }, h('i', { style: { background: th.ac } }), h('i', { class: 'l2', style: { background: th.fg, opacity: '.25' } }), h('i', { class: 'l3', style: { background: th.fg, opacity: '.15' } })),
      h('span', null, t('theme.' + th.id)), P('theme', 'light') === th.id ? h('span', { class: 'theme-check' }, ic('check', 14)) : null)));
    drawThemes();
    // accent
    const accents = ['', '#008069', '#0a84c6', '#7048e8', '#d6336c', '#e8590c', '#2e7d32', '#e1a100', '#364fc7'];
    const accBox = h('div', { class: 'swatches' });
    const drawAcc = () => accBox.replaceChildren(...accents.map((c) => h('button', { type: 'button', class: 'swatch' + (P('accent', '') === c ? ' active' : ''), title: c || t('common.default'), style: { background: c || 'conic-gradient(#008069,#0a84c6,#7048e8,#d6336c,#e8590c,#008069)' }, onclick: () => { TC.setPref('accent', c); drawAcc(); } }, P('accent', '') === c ? ic('check', 14) : null)),
      h('label', { class: 'swatch custom', title: t('settings.customColor') }, ic('plus', 14), h('input', { type: 'color', value: P('accent', '') || '#008069', oninput: (e) => TC.setPref('accent', e.target.value) })));
    drawAcc();
    // fonts
    const fontList = h('div', { class: 'font-list' });
    const drawFonts = () => fontList.replaceChildren(...TC.FONTS.map((f) => h('button', { type: 'button', class: 'font-item' + (P('font', 'system') === f.id ? ' active' : ''), style: { fontFamily: f.family + ', "Noto Sans Devanagari", sans-serif' }, onclick: () => { TC.setPref('font', f.id); drawFonts(); } },
      h('span', { class: 'fi-name' }, f.label), h('span', { class: 'fi-sample' }, t('settings.fontSample')))));
    drawFonts();
    // wallpapers
    const wpBox = h('div', { class: 'wp-grid' });
    const wpFile = h('input', { type: 'file', accept: 'image/*', class: 'hidden' });
    wpFile.addEventListener('change', () => {
      const f = wpFile.files[0]; if (!f) return;
      if (f.size > 1.5 * 1024 * 1024) { TC.toast(t('settings.wpTooBig'), 'error'); return; }
      const rd = new FileReader();
      rd.onload = () => { TC.LS.set('tc_wallpaper', rd.result); TC.setPref('wallpaper', 'custom'); drawWp(); };
      rd.readAsDataURL(f);
    });
    const drawWp = () => wpBox.replaceChildren(...TC.WALLPAPERS.map((w) => h('button', { type: 'button', class: 'wp-item' + (P('wallpaper', 'doodle') === w ? ' active' : ''), style: { background: w === 'custom' ? 'var(--surface-2)' : TC.wallpaperCSS(w) }, onclick: () => { if (w === 'custom') { wpFile.click(); return; } TC.setPref('wallpaper', w); drawWp(); } },
      w === 'custom' ? ic('upload', 20) : null, h('span', { class: 'wp-name' }, t('wp.' + w)))));
    drawWp();

    body.append(
      card(t('settings.theme'), grid, h('label', { class: 'label' }, t('settings.accent')), accBox),
      card(t('settings.font'), fontList,
        h('label', { class: 'label' }, t('settings.fontSize')), chipGroup(['sm', 'md', 'lg', 'xl'], P('size', 'md'), (v) => TC.setPref('size', v), (o) => t('size.' + o))),
      card(t('settings.layout'),
        h('label', { class: 'label' }, t('settings.density')), chipGroup(['comfortable', 'compact'], P('density', 'comfortable'), (v) => TC.setPref('density', v), (o) => t('density.' + o)),
        h('label', { class: 'label' }, t('settings.bubble')), chipGroup(['round', 'square'], P('bubble', 'round'), (v) => TC.setPref('bubble', v), (o) => t('bubble.' + o))),
      card(t('settings.wallpaper'), wpBox, wpFile),
      card(null, h('button', { class: 'btn ghost', onclick: () => { ['theme', 'font', 'size', 'accent', 'density', 'bubble', 'wallpaper'].forEach((k) => { delete S.prefs[k]; }); TC.LS.set('tc_prefs', S.prefs); TC.setPref('theme', 'light'); TC.resolve(); } }, ic('refresh', 16), t('settings.resetAppearance'))));
  }

  const LANGS = [['en', 'English'], ['hi', 'हिन्दी'], ['mr', 'मराठी']];
  function language(body) {
    const list = h('div', { class: 'lang-list' });
    const draw = () => list.replaceChildren(...LANGS.map(([k, name]) => h('button', { class: 'lang-item' + (TC.lang === k ? ' active' : ''), onclick: () => TC.setPref('lang', k) }, h('span', { class: 'strong' }, name), TC.lang === k ? ic('check', 20) : null)));
    draw();
    body.append(card(t('settings.language'), h('p', { class: 'muted' }, t('settings.languageSub')), list));
  }

  function snippets(body) {
    const sc = h('input', { class: 'input', maxlength: '30', placeholder: 'restart', autocapitalize: 'off' });
    const tx = h('textarea', { class: 'input', rows: '3', maxlength: '2000', placeholder: t('snippets.textPh') });
    const list = h('div', { class: 'snip-list' });
    const draw = () => {
      list.replaceChildren();
      if (!TC.snippets.length) { list.appendChild(h('div', { class: 'empty-small' }, ic('zap', 26), t('snippets.empty'))); return; }
      TC.snippets.forEach((sn) => list.appendChild(h('div', { class: 'snip-row' }, h('b', { class: 'mono' }, '/' + sn.shortcut), h('div', { class: 'grow muted ellipsis2' }, sn.text),
        h('button', { class: 'icon-btn danger', title: t('common.delete'), onclick: async () => { try { await TC.api('/snippets/' + sn.id, { method: 'DELETE' }); await TC.loadSnippets(); draw(); } catch (e) { TC.fail(e); } } }, ic('trash', 18)))));
    };
    body.append(card(t('settings.snippets'), h('p', { class: 'muted' }, t('snippets.sub')),
      h('label', { class: 'label' }, t('snippets.shortcut')), sc, h('label', { class: 'label' }, t('snippets.text')), tx,
      h('div', { class: 'form-actions' }, h('button', { class: 'btn primary', onclick: async () => {
        try { await TC.api('/snippets', { method: 'POST', body: { shortcut: sc.value, text: tx.value } }); sc.value = tx.value = ''; await TC.loadSnippets(); draw(); TC.toast(t('common.saved'), 'success'); } catch (e) { TC.fail(e); }
      } }, ic('plus', 16), t('snippets.add')))), card(null, list));
    draw();
  }

  function notifications(body) {
    const perm = 'Notification' in window ? Notification.permission : 'unsupported';
    const status = h('div', { class: 'muted small' }, t('settings.notifStatus.' + perm));
    body.append(card(t('settings.notifications'),
      TC.switchRow(t('settings.sound'), TC.pref('sound', true) !== false, (v) => TC.setPref('sound', v)),
      TC.switchRow(t('settings.enterToSend'), TC.pref('enterToSend', !window.matchMedia('(pointer: coarse)').matches), (v) => TC.setPref('enterToSend', v)),
      h('div', { class: 'setting-line' }, h('div', { class: 'grow' }, h('div', { class: 'strong' }, t('settings.browserNotif')), status),
        perm === 'default' ? h('button', { class: 'btn primary small', onclick: async () => { const r = await Notification.requestPermission(); status.textContent = t('settings.notifStatus.' + r); } }, t('settings.enable')) : null),
      h('button', { class: 'btn ghost small', onclick: () => { TC.beep(); } }, ic('bell', 16), t('settings.testSound'))));
  }

  function security(body) {
    const cur = h('input', { class: 'input', type: 'password', autocomplete: 'current-password' });
    const nw = h('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
    const nw2 = h('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
    const devices = h('div', { class: 'device-list' });
    const loadDevices = async () => {
      try {
        const r = await TC.api('/me/devices');
        devices.replaceChildren(...r.devices.map((d) => h('div', { class: 'device-row' }, h('span', { class: 'li-ic' }, ic('smartphone', 20)),
          h('div', { class: 'grow' }, h('div', { class: 'strong' }, d.device, d.current ? h('span', { class: 'pill ok' }, t('settings.thisDevice')) : null), h('div', { class: 'muted small' }, (d.ip || '') + ' · ' + t('settings.lastActive') + ' ' + TC.fmtDateTime(d.last_used))),
          d.current ? null : h('button', { class: 'btn ghost small danger', onclick: async () => { try { await TC.api('/me/devices/' + d.id, { method: 'DELETE' }); loadDevices(); } catch (e) { TC.fail(e); } } }, t('settings.signOut')))));
      } catch (e) { TC.fail(e); }
    };
    body.append(
      card(t('settings.changePassword'), h('label', { class: 'label' }, t('settings.currentPassword')), cur, h('label', { class: 'label' }, t('settings.newPassword')), nw, h('label', { class: 'label' }, t('settings.confirmPassword')), nw2,
        h('p', { class: 'muted small' }, t('settings.passwordHint')),
        h('div', { class: 'form-actions' }, h('button', { class: 'btn primary', onclick: async () => {
          if (nw.value !== nw2.value) { TC.toast(t('settings.passwordMismatch'), 'error'); return; }
          try { await TC.api('/auth/change-password', { method: 'POST', body: { current_password: cur.value, new_password: nw.value } }); cur.value = nw.value = nw2.value = ''; TC.toast(t('settings.passwordChanged'), 'success'); const m = Object.assign({}, S.me, { using_default_password: false, must_change_password: false }); TC.setMe(m); loadDevices(); } catch (e) { TC.fail(e); }
        } }, t('settings.updatePassword')))),
      card(t('settings.devices'), h('p', { class: 'muted small' }, t('settings.devicesSub')), devices));
    loadDevices();
  }

  function about(body) {
    const canInstall = !!TC.installEvt;
    body.append(card(t('settings.about'),
      h('div', { class: 'about-logo' }, h('img', { src: 'icons/icon-192.png', alt: '', width: 72, height: 72 }), h('div', null, h('h2', null, S.me.app_name || 'TeamChat'), h('p', { class: 'muted' }, t('about.tagline')))),
      h('div', { class: 'kv' }, h('span', null, t('about.version')), h('b', null, '1.0')),
      h('div', { class: 'kv' }, h('span', null, t('about.maxUpload')), h('b', null, (S.me.max_upload_mb || 100) + ' MB')),
      h('div', { class: 'kv' }, h('span', null, t('about.signedInAs')), h('b', null, '@' + S.me.username)),
      canInstall ? h('button', { class: 'btn primary', onclick: () => TC.installApp() }, ic('download', 16), t('pwa.install')) : h('p', { class: 'muted small' }, t('pwa.hint'))));
  }
})();
