(function () {
  'use strict';
  const TC = window.TC;
  const { h, ic, S } = TC;
  const t = (...a) => TC.t(...a);

  const STATUSES = ['open', 'in_progress', 'resolved', 'closed'];
  const PRIOS = ['low', 'medium', 'high', 'urgent'];

  TC.refreshTicketBadge = async () => {
    if (!TC.can('tickets') || !S.token) return;
    try {
      const r = await TC.api('/tickets?mine=1&status=active', { noRedirect: true });
      TC.openTicketsForMe = r.tickets.filter((x) => x.assignee && x.assignee.id === S.me.id).length;
      TC.emit('chats');
    } catch (e) { /* ignore */ }
  };
  TC.on('ticket', TC.debounce(() => TC.refreshTicketBadge(), 500), true);

  const sel = (opts, value, labelFn) => {
    const s = h('select', { class: 'input' }, opts.map((o) => h('option', { value: o }, labelFn(o))));
    s.value = value;
    return s;
  };
  const statusPill = (st) => h('span', { class: 'pill st-' + st }, t('tickets.st.' + st));
  const prioPill = (p) => h('span', { class: 'pill pr-' + p }, t('tickets.pr.' + p));

  /* ================= list page ================= */
  TC.route('/tickets', (view) => {
    if (!TC.can('tickets')) { view.appendChild(h('div', { class: 'empty-state' }, h('p', { class: 'muted' }, t('err.feature_disabled')))); return; }
    let filter = TC.LS.get('tc_ticketfilter', 'active');
    const list = h('div', { class: 'ticket-list' });
    const tabs = h('div', { class: 'tabs' });
    const counts = h('div', { class: 'stats small' });
    const search = h('input', { class: 'input', type: 'search', placeholder: t('tickets.search') });
    view.append(
      h('div', { class: 'page-head' }, h('div', null, h('h1', null, t('nav.tickets')), h('p', { class: 'muted' }, t('tickets.sub'))),
        h('button', { class: 'btn primary', onclick: () => createTicket({}) }, ic('plus', 18), t('tickets.new'))),
      counts, h('div', { class: 'toolbar' }, h('div', { class: 'input-icon grow' }, ic('search', 18), search)), tabs, list);

    const FILTERS = ['active', 'open', 'in_progress', 'resolved', 'all', 'mine'];
    const load = async () => {
      let q = '/tickets?q=' + encodeURIComponent(search.value.trim());
      if (filter === 'mine') q += '&mine=1&status=active'; else if (filter !== 'all') q += '&status=' + filter;
      try {
        const r = await TC.api(q);
        counts.replaceChildren(...['open', 'in_progress', 'resolved'].map((k) => h('div', { class: 'stat st-' + k }, h('div', { class: 'stat-val' }, r.counts[k]), h('div', { class: 'muted small' }, t('tickets.st.' + k)))));
        tabs.replaceChildren(...FILTERS.map((f) => h('button', { class: 'tab' + (filter === f ? ' active' : ''), onclick: () => { filter = f; TC.LS.set('tc_ticketfilter', f); load(); } }, t('tickets.f.' + f))));
        list.replaceChildren();
        if (!r.tickets.length) { list.appendChild(h('div', { class: 'empty-state' }, h('div', { class: 'empty-art' }, ic('clipboard', 48)), h('h2', null, t('tickets.emptyTitle')), h('p', { class: 'muted' }, t('tickets.emptyText')))); return; }
        r.tickets.forEach((tk) => list.appendChild(card(tk)));
      } catch (e) { TC.fail(e); }
    };
    const card = (tk) => h('div', { class: 'ticket-card pr-bar-' + tk.priority, tabindex: '0', role: 'button', onclick: () => openTicket(tk.id, load), onkeydown: (e) => { if (e.key === 'Enter') openTicket(tk.id, load); } },
      h('div', { class: 'tk-main' },
        h('div', { class: 'tk-title' }, h('span', { class: 'muted' }, '#' + tk.id + ' '), tk.title),
        h('div', { class: 'tk-meta muted small' }, (tk.created_by ? tk.created_by.name : '—') + ' · ' + TC.listTime(tk.updated_at))),
      h('div', { class: 'tk-side' }, statusPill(tk.status), prioPill(tk.priority),
        tk.comment_count ? h('span', { class: 'tk-cc muted small' }, ic('chat', 14), tk.comment_count) : null,
        tk.assignee ? h('span', { title: tk.assignee.name }, TC.avatar(tk.assignee.name, tk.assignee.avatar, 28)) : h('span', { class: 'muted small' }, t('tickets.unassigned'))));
    search.addEventListener('input', TC.debounce(load, 250));
    TC.on('ticket', TC.debounce(load, 300));
    load();
  }, { name: 'tickets' });

  /* ================= create ================= */
  function createTicket(pre) {
    const title = h('input', { class: 'input', maxlength: '160', value: pre.title || '', placeholder: t('tickets.titlePh') });
    const desc = h('textarea', { class: 'input', rows: '5', maxlength: '5000', placeholder: t('tickets.descPh') }, pre.description || '');
    const prio = sel(PRIOS, 'medium', (p) => t('tickets.pr.' + p));
    let assignee = null;
    const assigneeBtn = h('button', { class: 'btn ghost', type: 'button' }, ic('user', 16), t('tickets.unassigned'));
    assigneeBtn.addEventListener('click', async () => {
      const ids = await TC.pickUsers({ title: t('tickets.assignTo') });
      if (!ids) return;
      const r = await TC.api('/users?q=');
      assignee = r.users.find((u) => u.id === ids[0]);
      assigneeBtn.replaceChildren(ic('user', 16), assignee ? assignee.name : t('tickets.unassigned'));
    });
    TC.modal({
      title: pre.message_id ? t('tickets.fromMessage') : t('tickets.new'), wide: true,
      body: [h('label', { class: 'label' }, t('tickets.title')), title, h('label', { class: 'label' }, t('tickets.description')), desc,
        h('div', { class: 'form-grid' }, h('div', null, h('label', { class: 'label' }, t('tickets.priority')), prio), h('div', null, h('label', { class: 'label' }, t('tickets.assignee')), assigneeBtn))],
      actions: [{ label: t('common.cancel'), kind: 'ghost' }, { label: t('tickets.create'), kind: 'primary', onClick: async () => {
        if (!title.value.trim()) { TC.toast(t('tickets.titleRequired'), 'error'); return false; }
        const r = await TC.api('/tickets', { method: 'POST', body: { title: title.value, description: desc.value, priority: prio.value, assignee_id: assignee ? assignee.id : null, message_id: pre.message_id || null } });
        TC.toast(t('tickets.created', { n: r.ticket.id }), 'success');
        TC.emit('ticket', { ticket_id: r.ticket.id });
        if (TC.path() === '/tickets') TC.resolve();
      } }],
    });
  }
  TC.createTicketFromMessage = (m) => createTicket({ title: (m.body || (m.file && m.file.name) || '').slice(0, 120), description: m.body ? t('tickets.reportedBy', { name: m.sender_name }) + '\n\n' + m.body : '', message_id: m.id });

  /* ================= detail ================= */
  async function openTicket(id, onChange) {
    let tk;
    try { tk = (await TC.api('/tickets/' + id)).ticket; } catch (e) { TC.fail(e); return; }
    const body = h('div', { class: 'ticket-detail' });
    const m = TC.modal({ title: t('tickets.ticketN', { n: tk.id }), wide: true, body, onClose: () => { off(); if (onChange) onChange(); } });
    const off = TC.on('ticket', async (p) => { if (p.ticket_id === id && p.event !== 'deleted') { try { tk = (await TC.api('/tickets/' + id)).ticket; draw(); } catch (e) { /* ignore */ } } }, true);

    const draw = () => {
      const canEdit = TC.isAdmin() || (tk.created_by && tk.created_by.id === S.me.id) || (tk.assignee && tk.assignee.id === S.me.id);
      const title = h('input', { class: 'input', value: tk.title, maxlength: '160', disabled: !canEdit });
      const desc = h('textarea', { class: 'input', rows: '4', maxlength: '5000', disabled: !canEdit }, tk.description || '');
      const st = sel(STATUSES, tk.status, (x) => t('tickets.st.' + x)); st.disabled = !canEdit;
      const pr = sel(PRIOS, tk.priority, (x) => t('tickets.pr.' + x)); pr.disabled = !canEdit;
      let assigneeId = tk.assignee ? tk.assignee.id : null;
      const aBtn = h('button', { class: 'btn ghost', type: 'button', disabled: !canEdit }, ic('user', 16), tk.assignee ? tk.assignee.name : t('tickets.unassigned'));
      const setA = (u) => { assigneeId = u ? u.id : null; aBtn.replaceChildren(ic('user', 16), u ? u.name : t('tickets.unassigned')); };
      aBtn.addEventListener('click', async () => {
        const ids = await TC.pickUsers({ title: t('tickets.assignTo') });
        if (!ids) return;
        const r = await TC.api('/users?q='); setA(r.users.find((u) => u.id === ids[0]));
      });
      const quick = canEdit ? h('div', { class: 'row gap-s wrap' },
        h('button', { class: 'btn ghost small', onclick: () => setA({ id: S.me.id, name: S.me.name }) }, t('tickets.assignMe')),
        assigneeId ? h('button', { class: 'btn ghost small', onclick: () => setA(null) }, t('tickets.unassign')) : null) : null;
      const comments = h('div', { class: 'tk-comments' }, tk.comments.length ? tk.comments.map((c) => h('div', { class: 'tk-comment' }, TC.avatar(c.author ? c.author.name : '?', c.author && c.author.avatar, 32),
        h('div', { class: 'grow' }, h('div', { class: 'row gap-s' }, h('b', null, c.author ? c.author.name : t('chat.deletedUser')), h('span', { class: 'muted small' }, TC.fmtDateTime(c.created_at))), h('div', { class: 'tk-comment-body' }, c.body)))) : h('div', { class: 'empty-small' }, t('tickets.noComments')));
      const cIn = h('textarea', { class: 'input', rows: '2', maxlength: '4000', placeholder: t('tickets.commentPh') });
      const post = h('button', { class: 'btn primary', onclick: async () => {
        if (!cIn.value.trim()) return;
        try { const r = await TC.api('/tickets/' + id + '/comments', { method: 'POST', body: { body: cIn.value } }); tk = r.ticket; draw(); } catch (e) { TC.fail(e); }
      } }, ic('send', 16), t('tickets.addComment'));
      const save = h('button', { class: 'btn primary', onclick: async () => {
        try { const r = await TC.api('/tickets/' + id, { method: 'PATCH', body: { title: title.value, description: desc.value, status: st.value, priority: pr.value, assignee_id: assigneeId } }); tk = r.ticket; TC.toast(t('common.saved'), 'success'); draw(); } catch (e) { TC.fail(e); }
      } }, ic('check', 16), t('common.save'));
      body.replaceChildren(
        h('div', { class: 'row gap-s wrap' }, statusPill(tk.status), prioPill(tk.priority), h('span', { class: 'muted small' }, t('tickets.createdBy', { name: tk.created_by ? tk.created_by.name : '—', date: TC.fmtDateTime(tk.created_at) }))),
        h('label', { class: 'label' }, t('tickets.title')), title,
        h('label', { class: 'label' }, t('tickets.description')), desc,
        h('div', { class: 'form-grid' }, h('div', null, h('label', { class: 'label' }, t('tickets.status')), st), h('div', null, h('label', { class: 'label' }, t('tickets.priority')), pr)),
        h('label', { class: 'label' }, t('tickets.assignee')), h('div', { class: 'row gap-s wrap' }, aBtn, quick),
        canEdit ? h('div', { class: 'form-actions' }, TC.isAdmin() ? h('button', { class: 'btn ghost danger', onclick: async () => { if (await TC.confirm(t('tickets.deleteConfirm'), { danger: true })) { try { await TC.api('/tickets/' + id, { method: 'DELETE' }); m.close(); TC.emit('ticket', { ticket_id: id }); } catch (e) { TC.fail(e); } } } }, ic('trash', 16), t('common.delete')) : null, save) : h('p', { class: 'muted small' }, t('tickets.readOnly')),
        tk.chat_id && TC.chat(tk.chat_id) ? h('a', { class: 'btn ghost small', href: '#/chats/' + tk.chat_id, onclick: () => m.close() }, ic('chat', 14), t('tickets.openChat')) : null,
        h('h3', { class: 'section-h' }, t('tickets.comments') + ' (' + tk.comments.length + ')'), comments, cIn, h('div', { class: 'form-actions' }, post));
    };
    draw();
  }
})();
