(function () {
  'use strict';
  const TC = window.TC;
  const { h, ic, S } = TC;
  const t = (...a) => TC.t(...a);
  const A = { admin: true };
  const FEATURE_ICONS = { chat_direct: 'chat', create_groups: 'users', send_files: 'paperclip', voice_notes: 'mic', reactions: 'smile', reply_forward: 'reply', edit_messages: 'edit', delete_messages: 'trash', star_messages: 'star', search: 'search', export_chat: 'download', tickets: 'clipboard', polls: 'chart', schedule_messages: 'clock', status: 'status', change_profile: 'user', change_theme: 'palette' };

  const head = (title, sub, right) => h('div', { class: 'page-head' }, h('div', null, h('h1', null, title), sub ? h('p', { class: 'muted' }, sub) : null), right || null);
  const card = (title, ...kids) => h('section', { class: 'card' }, title ? h('h3', null, title) : null, kids);
  const loader = () => h('div', { class: 'loading' }, h('i', { class: 'spinner' }));
  const run = async (fn) => { try { return await fn(); } catch (e) { TC.fail(e); return undefined; } };

  function credentialsModal(username, password, title) {
    const text = t('admin.credText', { app: S.me.app_name || 'TeamChat', url: location.origin + location.pathname, user: username, pass: password });
    TC.modal({
      title: title || t('admin.credentials'),
      body: [h('p', { class: 'muted' }, t('admin.credHint')),
        h('div', { class: 'cred-box' }, h('div', { class: 'kv' }, h('span', null, t('login.username')), h('b', null, username)), h('div', { class: 'kv' }, h('span', null, t('login.password')), h('b', { class: 'mono' }, password)))],
      actions: [{ label: t('common.close'), kind: 'ghost' }, { label: t('admin.copyCred'), kind: 'primary', onClick: () => { TC.copy(text); return false; } }],
    });
  }

  /* ================= dashboard ================= */
  TC.route('/admin', (view) => {
    view.append(head(t('admin.dashboard'), t('admin.dashboardSub')), loader());
    run(async () => {
      const d = await TC.api('/admin/stats');
      view.replaceChildren(head(t('admin.dashboard'), t('admin.dashboardSub'), h('button', { class: 'btn ghost', onclick: () => TC.resolve() }, ic('refresh', 16), t('common.refresh'))));
      const stat = (icon, label, val, tone) => h('div', { class: 'stat ' + (tone || '') }, h('div', { class: 'stat-ic' }, ic(icon, 22)), h('div', null, h('div', { class: 'stat-val' }, val), h('div', { class: 'muted small' }, label)));
      view.appendChild(h('div', { class: 'stats' },
        stat('users', t('admin.totalUsers'), d.users_total), stat('check-circle', t('admin.activeUsers'), d.users_active, 'ok'), stat('wifi', t('admin.onlineNow'), d.online_now, 'live'),
        stat('chat', t('admin.messagesToday'), d.messages_today), stat('layers', t('admin.groups'), d.groups), stat('drive', t('admin.storageUsed'), TC.fmtSize(d.storage_bytes))));
      // chart
      const max = Math.max(5, ...d.series.map((x) => x.messages));
      const W = 560, H = 180, bw = W / d.series.length;
      const svg = ['<svg viewBox="0 0 ' + W + ' ' + (H + 26) + '" class="chart" role="img">'];
      d.series.forEach((x, i) => {
        const bh = Math.round((x.messages / max) * H);
        svg.push('<rect x="' + (i * bw + 5) + '" y="' + (H - bh) + '" width="' + (bw - 10) + '" height="' + Math.max(bh, 2) + '" rx="4" class="bar"><title>' + x.date + ': ' + x.messages + '</title></rect>');
        svg.push('<text x="' + (i * bw + bw / 2) + '" y="' + (H + 16) + '" text-anchor="middle" class="axis">' + x.date.slice(8) + '</text>');
      });
      svg.push('</svg>');
      view.appendChild(h('div', { class: 'grid-2' },
        card(t('admin.messages14'), h('div', { html: svg.join('') })),
        card(t('admin.topUsers'), d.top_users.length ? d.top_users.map((u, i) => h('div', { class: 'rank-row' }, h('span', { class: 'rank' }, i + 1), h('a', { class: 'grow strong', href: '#/admin/users/' + u.id }, u.name), h('span', { class: 'pill' }, u.count + ' ' + t('admin.msgs')))) : h('div', { class: 'empty-small' }, t('admin.noActivity')))));
      view.appendChild(card(t('admin.recentLogins'), h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null, [t('login.username'), t('admin.result'), 'IP', t('admin.when')].map((x) => h('th', null, x)))),
        h('tbody', null, d.recent_logins.map((e) => h('tr', null, h('td', null, e.username), h('td', null, h('span', { class: 'pill ' + (e.success ? 'ok' : 'bad') }, e.success ? t('admin.success') : t('admin.failed'))), h('td', { class: 'muted' }, e.ip || ''), h('td', { class: 'muted' }, TC.fmtDateTime(e.at)))))))));
    });
  }, Object.assign({ name: 'admin' }, A));

  /* ================= users list ================= */
  TC.route('/admin/users', (view) => {
    const search = h('input', { class: 'input', type: 'search', placeholder: t('common.searchPeople') });
    const status = h('select', { class: 'input' }, [['', t('admin.all')], ['active', t('admin.active')], ['disabled', t('admin.disabled')]].map(([v, l]) => h('option', { value: v }, l)));
    const tbody = h('tbody');
    view.append(head(t('admin.users'), t('admin.usersSub'), h('button', { class: 'btn primary', onclick: () => createUser() }, ic('user-plus', 18), t('admin.addUser'))),
      h('div', { class: 'toolbar' }, h('div', { class: 'input-icon grow' }, ic('search', 18), search), status),
      h('div', { class: 'card table-wrap' }, h('table', { class: 'table' }, h('thead', null, h('tr', null, [t('admin.user'), t('admin.department'), t('admin.status'), t('admin.lastLogin'), t('admin.devices'), ''].map((x) => h('th', null, x)))), tbody)));
    const load = () => run(async () => {
      const r = await TC.api('/admin/users?q=' + encodeURIComponent(search.value.trim()) + '&status=' + status.value);
      tbody.replaceChildren();
      if (!r.users.length) { tbody.appendChild(h('tr', null, h('td', { colspan: 6 }, h('div', { class: 'empty-small' }, t('admin.noUsers'))))); return; }
      r.users.forEach((u) => tbody.appendChild(h('tr', { class: 'clickable', onclick: () => { location.hash = '#/admin/users/' + u.id; } },
        h('td', null, h('div', { class: 'row gap-s' }, h('div', { class: 'avatar-wrap' }, TC.avatar(u.name, u.avatar, 38), TC.isOnline(u.id) ? h('i', { class: 'dot online' }) : null), h('div', null, h('div', { class: 'strong' }, u.name), h('div', { class: 'muted small' }, '@' + u.username)))),
        h('td', null, [u.designation, u.department].filter(Boolean).join(' · ') || '—'),
        h('td', null, u.locked ? h('span', { class: 'pill bad' }, t('admin.locked')) : h('span', { class: 'pill ' + (u.is_active ? 'ok' : 'bad') }, u.is_active ? t('admin.active') : t('admin.disabled')), u.template_name ? h('span', { class: 'pill' }, u.template_name) : null),
        h('td', { class: 'muted' }, u.last_login ? TC.fmtDateTime(u.last_login) : t('admin.never')),
        h('td', null, u.device_count),
        h('td', null, ic('right', 18)))));
    });
    search.addEventListener('input', TC.debounce(load, 250));
    status.addEventListener('change', load);
    load();
  }, Object.assign({ name: 'admin' }, A));

  async function createUser() {
    const r = await run(() => TC.api('/admin/templates'));
    if (!r) return;
    const f = {
      name: h('input', { class: 'input', maxlength: '100' }), username: h('input', { class: 'input', maxlength: '30', autocapitalize: 'off' }),
      password: h('input', { class: 'input', placeholder: t('admin.autoGen'), autocomplete: 'new-password' }),
      dept: h('input', { class: 'input', maxlength: '80' }), desig: h('input', { class: 'input', maxlength: '80' }),
      tpl: h('select', { class: 'input' }, h('option', { value: '' }, t('admin.noTemplate')), r.templates.map((x) => h('option', { value: x.id }, x.name))),
      force: h('input', { type: 'checkbox', class: 'switch', checked: true }),
    };
    TC.modal({
      title: t('admin.addUser'), wide: true,
      body: h('div', { class: 'form-grid' },
        h('div', null, h('label', { class: 'label' }, t('admin.fullName')), f.name), h('div', null, h('label', { class: 'label' }, t('login.username')), f.username),
        h('div', null, h('label', { class: 'label' }, t('login.password')), f.password), h('div', null, h('label', { class: 'label' }, t('admin.template')), f.tpl),
        h('div', null, h('label', { class: 'label' }, t('admin.department')), f.dept), h('div', null, h('label', { class: 'label' }, t('admin.designation')), f.desig),
        h('label', { class: 'switch-row span-2' }, h('span', { class: 'grow' }, t('admin.forceChange')), f.force)),
      actions: [{ label: t('common.cancel'), kind: 'ghost' }, { label: t('admin.createUser'), kind: 'primary', onClick: async () => {
        const res = await TC.api('/admin/users', { method: 'POST', body: { display_name: f.name.value, username: f.username.value, password: f.password.value, department: f.dept.value, designation: f.desig.value, template_id: f.tpl.value || null, must_change_password: f.force.checked } });
        TC.toast(t('admin.userCreated'), 'success');
        credentialsModal(res.user.username, res.password);
        if (TC.path() === '/admin/users') TC.resolve(); else location.hash = '#/admin/users/' + res.user.id;
      } }],
    });
  }

  /* ================= user detail ================= */
  TC.route('/admin/users/:id', (view, p) => {
    view.appendChild(loader());
    run(async () => {
      const [d, tpl] = await Promise.all([TC.api('/admin/users/' + p.id), TC.api('/admin/templates')]);
      const u = d.user;
      view.replaceChildren();
      const f = { name: h('input', { class: 'input', value: u.name }), username: h('input', { class: 'input', value: u.username }), dept: h('input', { class: 'input', value: u.department || '' }), desig: h('input', { class: 'input', value: u.designation || '' }),
        tpl: h('select', { class: 'input' }, h('option', { value: '' }, t('admin.noTemplate')), tpl.templates.map((x) => h('option', { value: x.id, selected: x.id === u.template_id }, x.name))) };
      const overrides = Object.assign({}, u.feature_overrides);
      const eff = () => { const tp = tpl.templates.find((x) => String(x.id) === f.tpl.value); const base = Object.assign({}, tpl.defaults, tp ? tp.flags : {}); return Object.assign(base, overrides); };
      const featBox = h('div', { class: 'feature-grid' });
      const drawFeat = () => {
        const cur = eff();
        featBox.replaceChildren(...tpl.features.map((k) => h('label', { class: 'feature-card' + (cur[k] ? ' on' : '') }, h('span', { class: 'f-ic' }, ic(FEATURE_ICONS[k] || 'check', 20)), h('span', { class: 'grow' }, h('b', null, t('feat.' + k)), h('small', { class: 'muted' }, t('featdesc.' + k))),
          h('input', { type: 'checkbox', class: 'switch', checked: !!cur[k], onchange: (e) => { overrides[k] = e.target.checked; drawFeat(); } }))));
      };
      f.tpl.addEventListener('change', () => { Object.keys(overrides).forEach((k) => delete overrides[k]); drawFeat(); });
      drawFeat();
      view.append(
        h('div', { class: 'crumbs' }, h('a', { href: '#/admin/users' }, t('admin.users')), ic('right', 14), h('span', null, u.name)),
        h('div', { class: 'user-hero card' }, h('div', { class: 'avatar-wrap' }, TC.avatar(u.name, u.avatar, 72), TC.isOnline(u.id) ? h('i', { class: 'dot online' }) : null),
          h('div', { class: 'grow' }, h('h2', null, u.name), h('div', { class: 'muted' }, '@' + u.username + ' · ' + t('admin.joined') + ' ' + TC.fmtDate(u.created_at)),
            h('div', { class: 'row gap-s wrap' }, h('span', { class: 'pill ' + (u.is_active ? 'ok' : 'bad') }, u.is_active ? t('admin.active') : t('admin.disabled')), u.locked ? h('span', { class: 'pill bad' }, t('admin.locked')) : null, h('span', { class: 'pill' }, u.message_count + ' ' + t('admin.msgs')))),
          h('div', { class: 'row gap-s wrap' },
            h('button', { class: 'btn ghost', onclick: () => TC.openDirect(u.id) }, ic('chat', 16), t('people.message')),
            h('button', { class: 'btn ghost', onclick: () => resetPw(u) }, ic('key', 16), t('admin.resetPassword')),
            h('button', { class: 'btn ' + (u.is_active ? 'ghost danger' : 'primary'), onclick: () => run(async () => { await TC.api('/admin/users/' + u.id, { method: 'PATCH', body: { is_active: !u.is_active } }); TC.toast(t('common.saved'), 'success'); TC.resolve(); }) }, ic(u.is_active ? 'ban' : 'check-circle', 16), t(u.is_active ? 'admin.disable' : 'admin.enable')))),
        card(t('admin.profile'), h('div', { class: 'form-grid' }, h('div', null, h('label', { class: 'label' }, t('admin.fullName')), f.name), h('div', null, h('label', { class: 'label' }, t('login.username')), f.username), h('div', null, h('label', { class: 'label' }, t('admin.department')), f.dept), h('div', null, h('label', { class: 'label' }, t('admin.designation')), f.desig)),
          h('p', { class: 'muted small' }, t('admin.usernameHint'))),
        card(t('admin.permissions'), h('p', { class: 'muted' }, t('admin.permSub')), h('label', { class: 'label' }, t('admin.template')), f.tpl, featBox),
        h('div', { class: 'sticky-save' }, u.locked ? h('button', { class: 'btn ghost', onclick: () => run(async () => { await TC.api('/admin/users/' + u.id, { method: 'PATCH', body: { unlock: true } }); TC.resolve(); }) }, ic('unlock', 16), t('admin.unlock')) : null,
          h('button', { class: 'btn primary', onclick: () => run(async () => { await TC.api('/admin/users/' + u.id, { method: 'PATCH', body: { display_name: f.name.value, username: f.username.value, department: f.dept.value, designation: f.desig.value, template_id: f.tpl.value || null, feature_overrides: overrides } }); TC.toast(t('common.saved'), 'success'); TC.resolve(); }) }, ic('check', 16), t('admin.saveChanges'))),
        h('div', { class: 'grid-2' },
          card(t('admin.devices'), d.devices.length ? d.devices.map((x) => h('div', { class: 'device-row' }, h('span', { class: 'li-ic' }, ic('smartphone', 20)), h('div', { class: 'grow' }, h('div', { class: 'strong' }, x.device), h('div', { class: 'muted small' }, (x.ip || '') + ' · ' + TC.fmtDateTime(x.last_used))),
            h('button', { class: 'btn ghost small danger', onclick: () => run(async () => { await TC.api('/admin/users/' + u.id + '/devices/' + x.id, { method: 'DELETE' }); TC.resolve(); }) }, t('settings.signOut')))) : h('div', { class: 'empty-small' }, t('admin.noDevices')),
            d.devices.length ? h('button', { class: 'btn ghost danger small', onclick: () => run(async () => { await TC.api('/admin/users/' + u.id + '/sign-out', { method: 'POST', body: {} }); TC.toast(t('common.saved'), 'success'); TC.resolve(); }) }, ic('logout', 16), t('admin.signOutAll')) : null),
          card(t('admin.loginHistory'), h('div', { class: 'timeline' }, d.logins.length ? d.logins.slice(0, 12).map((e) => h('div', { class: 'tl-row' }, h('i', { class: 'tl-dot ' + (e.success ? 'ok' : 'bad') }), h('div', { class: 'grow' }, h('div', { class: 'small' }, e.success ? t('admin.signedIn') : t('admin.failedAttempt') + (e.reason ? ' (' + e.reason + ')' : '')), h('div', { class: 'muted small' }, (e.ip || '') + ' · ' + TC.fmtDateTime(e.at))))) : h('div', { class: 'empty-small' }, t('admin.noHistory'))))),
        h('div', { class: 'card danger-zone' }, h('div', { class: 'grow' }, h('b', null, t('admin.deleteUser')), h('p', { class: 'muted small' }, t('admin.deleteUserSub'))),
          h('button', { class: 'btn danger', onclick: async () => { if (await TC.confirm(t('admin.deleteUserConfirm', { name: u.name }), { danger: true, okLabel: t('common.delete') })) run(async () => { await TC.api('/admin/users/' + u.id, { method: 'DELETE' }); TC.toast(t('common.deleted'), 'success'); location.hash = '#/admin/users'; }); } }, ic('trash', 16), t('common.delete'))));
    });
  }, Object.assign({ name: 'admin' }, A));

  function resetPw(u) {
    const pw = h('input', { class: 'input', placeholder: t('admin.autoGen'), autocomplete: 'new-password' });
    const force = h('input', { type: 'checkbox', class: 'switch', checked: true });
    TC.modal({ title: t('admin.resetFor', { name: u.name }), body: [h('p', { class: 'muted' }, t('admin.resetSub')), h('label', { class: 'label' }, t('admin.newPassword')), pw, h('label', { class: 'switch-row' }, h('span', { class: 'grow' }, t('admin.forceChange')), force)],
      actions: [{ label: t('common.cancel'), kind: 'ghost' }, { label: t('admin.resetPassword'), kind: 'primary', onClick: async () => { const r = await TC.api('/admin/users/' + u.id + '/reset-password', { method: 'POST', body: { password: pw.value, must_change_password: force.checked } }); credentialsModal(r.username, r.password, t('admin.newCredentials')); } }] });
  }

  /* ================= permissions / templates ================= */
  TC.route('/admin/permissions', (view) => {
    view.append(head(t('admin.permissions'), t('admin.permPageSub'), h('button', { class: 'btn primary', onclick: () => editTemplate() }, ic('plus', 18), t('admin.newTemplate'))), loader());
    const load = () => run(async () => {
      const r = await TC.api('/admin/templates');
      view.replaceChildren(head(t('admin.permissions'), t('admin.permPageSub'), h('button', { class: 'btn primary', onclick: () => editTemplate(r) }, ic('plus', 18), t('admin.newTemplate'))));
      view.appendChild(card(t('admin.featureCatalog'), h('div', { class: 'feature-catalog' }, r.features.map((k) => h('div', { class: 'fc-item' }, h('span', { class: 'f-ic' }, ic(FEATURE_ICONS[k] || 'check', 20)), h('div', null, h('b', null, t('feat.' + k)), h('div', { class: 'muted small' }, t('featdesc.' + k))))))));
      const grid = h('div', { class: 'tpl-grid' });
      if (!r.templates.length) grid.appendChild(h('div', { class: 'empty-small' }, t('admin.noTemplates')));
      r.templates.forEach((tp) => grid.appendChild(h('div', { class: 'card tpl-card' }, h('div', { class: 'row between' }, h('h3', null, tp.name), h('span', { class: 'pill' }, tp.users + ' ' + t('admin.usersN'))), h('p', { class: 'muted small' }, tp.description || ''),
        h('div', { class: 'chips' }, r.features.map((k) => h('span', { class: 'chip ' + (tp.flags[k] ? 'on' : 'off') }, ic(tp.flags[k] ? 'check' : 'x', 12), t('feat.' + k)))),
        h('div', { class: 'row gap-s' }, h('button', { class: 'btn ghost small', onclick: () => editTemplate(r, tp) }, ic('edit', 14), t('common.edit')), h('button', { class: 'btn ghost small danger', onclick: async () => { if (await TC.confirm(t('admin.deleteTplConfirm', { name: tp.name }), { danger: true })) run(async () => { await TC.api('/admin/templates/' + tp.id, { method: 'DELETE' }); load(); }); } }, ic('trash', 14), t('common.delete'))))));
      view.appendChild(h('h3', { class: 'section-h' }, t('admin.templates')));
      view.appendChild(grid);
    });
    function editTemplate(r, tp) {
      const go = async (r2) => {
        const name = h('input', { class: 'input', value: tp ? tp.name : '', maxlength: '60' });
        const desc = h('input', { class: 'input', value: tp ? tp.description : '', maxlength: '200' });
        const flags = Object.assign({}, r2.defaults, tp ? tp.flags : {});
        const grid2 = h('div', { class: 'feature-grid' });
        const draw = () => grid2.replaceChildren(...r2.features.map((k) => h('label', { class: 'feature-card' + (flags[k] ? ' on' : '') }, h('span', { class: 'f-ic' }, ic(FEATURE_ICONS[k] || 'check', 20)), h('span', { class: 'grow' }, h('b', null, t('feat.' + k))), h('input', { type: 'checkbox', class: 'switch', checked: !!flags[k], onchange: (e) => { flags[k] = e.target.checked; draw(); } }))));
        draw();
        TC.modal({ title: tp ? t('admin.editTemplate') : t('admin.newTemplate'), wide: true, body: [h('label', { class: 'label' }, t('admin.templateName')), name, h('label', { class: 'label' }, t('group.description')), desc, h('label', { class: 'label' }, t('admin.permissions')), grid2],
          actions: [{ label: t('common.cancel'), kind: 'ghost' }, { label: t('common.save'), kind: 'primary', onClick: async () => {
            if (tp) await TC.api('/admin/templates/' + tp.id, { method: 'PATCH', body: { name: name.value, description: desc.value, flags } });
            else await TC.api('/admin/templates', { method: 'POST', body: { name: name.value, description: desc.value, flags } });
            load();
          } }] });
      };
      if (r) go(r); else run(async () => go(await TC.api('/admin/templates')));
    }
    load();
  }, Object.assign({ name: 'admin' }, A));

  /* ================= groups ================= */
  TC.route('/admin/groups', (view) => {
    view.append(head(t('admin.groups'), t('admin.groupsSub')));
    const tbody = h('tbody');
    view.appendChild(h('div', { class: 'card table-wrap' }, h('table', { class: 'table' }, h('thead', null, h('tr', null, [t('group.name'), t('group.members'), t('admin.messages'), t('admin.createdBy'), t('admin.created'), ''].map((x) => h('th', null, x)))), tbody)));
    const load = () => run(async () => {
      const r = await TC.api('/admin/groups');
      tbody.replaceChildren();
      if (!r.groups.length) tbody.appendChild(h('tr', null, h('td', { colspan: 6 }, h('div', { class: 'empty-small' }, t('admin.noGroups')))));
      r.groups.forEach((g) => tbody.appendChild(h('tr', null,
        h('td', null, h('div', { class: 'row gap-s' }, TC.avatar(g.name, g.avatar, 36), h('div', null, h('div', { class: 'strong' }, g.name), h('div', { class: 'muted small ellipsis' }, g.description)))),
        h('td', null, g.members), h('td', null, g.messages), h('td', null, g.created_by || '—'), h('td', { class: 'muted' }, TC.fmtDate(g.created_at)),
        h('td', null, h('div', { class: 'row gap-s' }, h('button', { class: 'btn ghost small', onclick: () => groupMembers(g, load) }, ic('users', 14), t('group.members')),
          h('button', { class: 'btn ghost small danger', onclick: async () => { if (await TC.confirm(t('admin.deleteGroupConfirm', { name: g.name }), { danger: true })) run(async () => { await TC.api('/admin/groups/' + g.id, { method: 'DELETE' }); load(); }); } }, ic('trash', 14)))))));
    });
    load();
  }, Object.assign({ name: 'admin' }, A));

  async function groupMembers(g, reload) {
    const d = await run(() => TC.api('/admin/groups/' + g.id));
    if (!d) return;
    const list = h('div', null);
    const draw = (members) => list.replaceChildren(...members.map((m) => h('div', { class: 'member-row' }, TC.avatar(m.user.name, m.user.avatar, 36), h('div', { class: 'grow' }, h('div', { class: 'strong' }, m.user.name), h('div', { class: 'muted small' }, '@' + m.user.username)), m.is_admin ? h('span', { class: 'pill' }, t('group.admin')) : null,
      h('button', { class: 'icon-btn danger', title: t('group.remove'), onclick: () => run(async () => { await TC.api('/admin/groups/' + g.id + '/members/' + m.user.id, { method: 'DELETE' }); const x = await TC.api('/admin/groups/' + g.id); draw(x.group.members); reload(); }) }, ic('user-minus', 18)))));
    draw(d.group.members);
    TC.modal({ title: g.name, body: [list], actions: [{ label: t('common.close'), kind: 'ghost' }, { label: t('group.addMembers'), kind: 'primary', onClick: async () => {
      const ids = await TC.pickUsers({ title: t('group.addMembers'), multi: true, exclude: [] });
      if (ids) { for (const id of ids) await TC.api('/admin/groups/' + g.id + '/members', { method: 'POST', body: { user_id: id } }); reload(); }
    } }] });
  }

  /* ================= announcements ================= */
  TC.route('/admin/announce', (view) => {
    const text = h('textarea', { class: 'input', rows: '5', maxlength: '1000', placeholder: t('admin.announcePh') });
    const sel = { ids: null };
    const target = h('div', { class: 'muted' }, t('admin.toAll'));
    view.append(head(t('admin.announce'), t('admin.announceSub')), card(null, h('label', { class: 'label' }, t('admin.message')), text,
      h('div', { class: 'row gap-s wrap target-row' }, ic('users', 18), target,
        h('button', { class: 'btn ghost small', onclick: async () => { const ids = await TC.pickUsers({ title: t('admin.selectRecipients'), multi: true }); if (ids) { sel.ids = ids; target.textContent = t('admin.toN', { n: ids.length }); } } }, t('admin.chooseRecipients')),
        sel.ids ? null : null),
      h('div', { class: 'form-actions' }, h('button', { class: 'btn primary', onclick: () => run(async () => {
        if (!text.value.trim()) { TC.toast(t('admin.messageRequired'), 'error'); return; }
        const r = await TC.api('/admin/announce', { method: 'POST', body: { text: text.value, user_ids: sel.ids } });
        TC.toast(t('admin.announceSent', { n: r.sent }), 'success'); text.value = '';
      }) }, ic('megaphone', 16), t('admin.send')))));
  }, Object.assign({ name: 'admin' }, A));

  /* ================= audit ================= */
  TC.route('/admin/audit', (view) => {
    view.append(head(t('admin.audit'), t('admin.auditSub')));
    const tbody = h('tbody');
    const pager = h('div', { class: 'pager' });
    view.append(h('div', { class: 'card table-wrap' }, h('table', { class: 'table' }, h('thead', null, h('tr', null, [t('admin.when'), t('admin.actor'), t('admin.action'), t('admin.target'), t('admin.details')].map((x) => h('th', null, x)))), tbody)), pager);
    let offset = 0; const limit = 30;
    const load = () => run(async () => {
      const r = await TC.api('/admin/audit?limit=' + limit + '&offset=' + offset);
      tbody.replaceChildren(...r.entries.map((e) => h('tr', null, h('td', { class: 'muted nowrap' }, TC.fmtDateTime(e.at)), h('td', null, e.actor), h('td', null, h('span', { class: 'pill' }, t('audit.' + e.action) === 'audit.' + e.action ? e.action : t('audit.' + e.action))), h('td', null, e.target), h('td', { class: 'muted small' }, Object.keys(e.details || {}).map((k) => k + ': ' + JSON.stringify(e.details[k])).join(' · ')))));
      if (!r.entries.length) tbody.appendChild(h('tr', null, h('td', { colspan: 5 }, h('div', { class: 'empty-small' }, t('admin.noAudit')))));
      pager.replaceChildren(h('button', { class: 'btn ghost small', disabled: offset === 0, onclick: () => { offset = Math.max(0, offset - limit); load(); } }, t('common.prev')), h('span', { class: 'muted' }, (r.total ? offset + 1 : 0) + '–' + Math.min(offset + limit, r.total) + ' / ' + r.total), h('button', { class: 'btn ghost small', disabled: offset + limit >= r.total, onclick: () => { offset += limit; load(); } }, t('common.next')));
    });
    load();
  }, Object.assign({ name: 'admin' }, A));

  /* ================= storage ================= */
  TC.route('/admin/storage', (view) => {
    view.append(head(t('admin.storage'), t('admin.storageSub')), loader());
    run(async () => {
      const [r, st] = await Promise.all([TC.api('/admin/storage'), TC.api('/admin/stats')]);
      view.replaceChildren(head(t('admin.storage'), t('admin.storageSub')));
      const max = Math.max(1, ...r.users.map((u) => u.bytes));
      view.append(h('div', { class: 'stats' }, h('div', { class: 'stat' }, h('div', { class: 'stat-ic' }, ic('drive', 22)), h('div', null, h('div', { class: 'stat-val' }, TC.fmtSize(st.storage_bytes)), h('div', { class: 'muted small' }, t('admin.storageUsed')))), h('div', { class: 'stat' }, h('div', { class: 'stat-ic' }, ic('file', 22)), h('div', null, h('div', { class: 'stat-val' }, st.files_total), h('div', { class: 'muted small' }, t('admin.filesShared'))))),
        card(t('admin.perUser'), r.users.length ? r.users.map((u) => h('div', { class: 'usage-row' }, h('div', { class: 'usage-name' }, u.name), h('div', { class: 'usage-bar' }, h('i', { style: { width: Math.max(2, (u.bytes / max) * 100) + '%' } })), h('div', { class: 'muted small usage-val' }, TC.fmtSize(u.bytes) + ' · ' + u.files))) : h('div', { class: 'empty-small' }, t('admin.noFiles'))));
    });
  }, Object.assign({ name: 'admin' }, A));

  /* ================= app settings ================= */
  TC.route('/admin/settings', (view) => {
    view.append(head(t('admin.appSettings'), t('admin.appSettingsSub')), loader());
    run(async () => {
      const s = await TC.api('/admin/settings');
      view.replaceChildren(head(t('admin.appSettings'), t('admin.appSettingsSub')));
      const name = h('input', { class: 'input', value: s.app_name, maxlength: '60' });
      const mb = h('input', { class: 'input', type: 'number', min: '1', max: '2048', value: s.max_upload_mb });
      const wl = h('textarea', { class: 'input', rows: '3', maxlength: '300' }, s.welcome_message || '');
      view.append(card(null, h('label', { class: 'label' }, t('admin.appName')), name, h('label', { class: 'label' }, t('admin.maxUpload')), mb, h('p', { class: 'muted small' }, t('admin.maxUploadHint')),
        h('label', { class: 'label' }, t('admin.welcomeMsg')), wl, h('p', { class: 'muted small' }, t('admin.welcomeHint')),
        h('div', { class: 'form-actions' }, h('button', { class: 'btn primary', onclick: () => run(async () => { const r = await TC.api('/admin/settings', { method: 'PUT', body: { app_name: name.value, max_upload_mb: Number(mb.value), welcome_message: wl.value } }); S.me.app_name = r.app_name; S.me.max_upload_mb = r.max_upload_mb; TC.toast(t('common.saved'), 'success'); TC.emit('me'); }) }, t('common.save')))));
    });
  }, Object.assign({ name: 'admin' }, A));

  /* ================= webhooks ================= */
  TC.route('/admin/webhooks', (view) => {
    const url = (w) => window.APP_CONFIG.API_BASE + '/hooks/' + w.token;
    const list = h('div', { class: 'tpl-grid' });
    view.append(head(t('admin.webhooks'), t('admin.webhooksSub'), h('button', { class: 'btn primary', onclick: () => newHook() }, ic('plus', 18), t('hooks.new'))), list,
      card(t('hooks.howTo'), h('p', { class: 'muted' }, t('hooks.howToText')), h('pre', { class: 'code' }, 'curl -X POST ' + window.APP_CONFIG.API_BASE + '/hooks/YOUR_TOKEN \\\n  -H "Content-Type: application/json" \\\n  -d \'{"title":"Build failed","text":"main branch - 3 tests failed"}\'')));
    const load = () => run(async () => {
      const r = await TC.api('/admin/webhooks');
      list.replaceChildren();
      if (!r.webhooks.length) list.appendChild(h('div', { class: 'empty-small' }, ic('link', 28), t('hooks.empty')));
      r.webhooks.forEach((w) => list.appendChild(h('div', { class: 'card tpl-card' }, h('div', { class: 'row between' }, h('h3', null, w.name), h('span', { class: 'pill' }, w.chat_name)),
        h('input', { class: 'input mono small', readonly: true, value: url(w), onclick: (e) => e.target.select() }),
        h('div', { class: 'row gap-s' }, h('button', { class: 'btn ghost small', onclick: () => TC.copy(url(w)) }, ic('copy', 14), t('hooks.copy')),
          h('button', { class: 'btn ghost small danger', onclick: async () => { if (await TC.confirm(t('hooks.deleteConfirm', { name: w.name }), { danger: true })) run(async () => { await TC.api('/admin/webhooks/' + w.id, { method: 'DELETE' }); load(); }); } }, ic('trash', 14), t('common.delete'))))));
    });
    async function newHook() {
      const g = await run(() => TC.api('/admin/groups'));
      if (!g) return;
      if (!g.groups.length) { TC.toast(t('hooks.pickGroup'), 'error'); return; }
      const name = h('input', { class: 'input', maxlength: '60', placeholder: 'Jenkins / Uptime / Backup' });
      const sel = h('select', { class: 'input' }, g.groups.map((x) => h('option', { value: x.id }, x.name)));
      TC.modal({ title: t('hooks.new'), body: [h('label', { class: 'label' }, t('hooks.name')), name, h('label', { class: 'label' }, t('hooks.group')), sel],
        actions: [{ label: t('common.cancel'), kind: 'ghost' }, { label: t('hooks.create'), kind: 'primary', onClick: async () => { await TC.api('/admin/webhooks', { method: 'POST', body: { chat_id: Number(sel.value), name: name.value } }); TC.toast(t('hooks.created'), 'success'); load(); } }] });
    }
    load();
  }, Object.assign({ name: 'admin' }, A));
})();
