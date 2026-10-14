(function () {
  'use strict';
  const TC = window.TC;
  const { h, ic, S } = TC;
  const t = (...a) => TC.t(...a);
  const $ = TC.$;

  const EMOJI = {
    smileys: '😀😃😄😁😆😅😂🤣😊😇🙂😉😍🥰😘😋😎🤩🥳😏😒😞😔😟😕🙁😣😖😫😩🥺😢😭😤😠😡🤯😳😱😨😰😥😓🤗🤔🤭🤫😶😐😑😬🙄😯😴🤤😷🤒🤕🤢🤮🥵🥶'.match(/./gu),
    gestures: '👍👎👌✌️🤞🤟🤘🤙👈👉👆👇☝️✋🤚🖐️🖖👋🤝🙏💪👏🙌👐🤲✍️💅🤳🧠👀👁️👂👃👄'.match(/\p{Extended_Pictographic}\uFE0F?/gu),
    hearts: '❤️🧡💛💚💙💜🖤🤍🤎💔❣️💕💞💓💗💖💘💝💯✨⭐🌟💫🔥🎉🎊🎈🎁🏆🥇🎯'.match(/\p{Extended_Pictographic}\uFE0F?/gu),
    objects: '💻🖥️⌨️🖱️💾📱☎️📞🔌🔋💡🔧🔨⚙️🛠️🔒🔓🔑📁📂📄📊📈📉📝📌📎🔗⏰⌛📅✅❌⚠️🚀🐛🧪🔍📧'.match(/\p{Extended_Pictographic}\uFE0F?/gu),
  };
  const QUICK = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

  /* ================= shared pickers ================= */
  TC.pickUsers = function (o) {
    return new Promise((resolve) => {
      const picked = new Set();
      const list = h('div', { class: 'picker-list' });
      const search = h('input', { class: 'input', type: 'search', placeholder: t('common.searchPeople'), autocomplete: 'off' });
      const count = h('span', { class: 'muted' }, '');
      let done = false;
      const upd = () => { count.textContent = o.multi ? t('picker.selected', { n: picked.size }) : ''; };
      const load = async () => {
        try {
          const r = await TC.api('/users?q=' + encodeURIComponent(search.value.trim()));
          list.replaceChildren();
          const users = r.users.filter((u) => !(o.exclude || []).includes(u.id));
          if (!users.length) list.appendChild(h('div', { class: 'empty-small' }, t('common.noResults')));
          users.forEach((u) => {
            const cb = o.multi ? h('input', { type: 'checkbox', class: 'check', checked: picked.has(u.id) }) : null;
            const row = h('div', { class: 'picker-row', tabindex: '0', role: 'button' },
              h('div', { class: 'avatar-wrap' }, TC.avatar(u.name, u.avatar, 40), TC.isOnline(u.id) ? h('i', { class: 'dot online' }) : null),
              h('div', { class: 'grow' }, h('div', { class: 'strong' }, u.name), h('div', { class: 'muted small' }, [u.designation, u.department].filter(Boolean).join(' · ') || '@' + u.username)), cb);
            const toggle = () => {
              if (!o.multi) { done = true; m.close(); resolve([u.id]); return; }
              if (picked.has(u.id)) picked.delete(u.id); else picked.add(u.id);
              cb.checked = picked.has(u.id); upd();
            };
            row.addEventListener('click', (e) => { if (e.target === cb) { if (cb.checked) picked.add(u.id); else picked.delete(u.id); upd(); } else toggle(); });
            row.addEventListener('keydown', (e) => { if (e.key === 'Enter') toggle(); });
            list.appendChild(row);
          });
        } catch (e) { TC.fail(e); }
      };
      search.addEventListener('input', TC.debounce(load, 250));
      const m = TC.modal({
        title: o.title, wide: false,
        body: [search, list],
        actions: o.multi ? [{ label: t('common.cancel'), kind: 'ghost', onClick: () => { done = true; resolve(null); } }, { label: o.confirmLabel || t('common.done'), kind: 'primary', onClick: () => { if (!picked.size) { TC.toast(t('picker.none'), 'error'); return false; } done = true; resolve([...picked]); } }] : [],
        onClose: () => { if (!done) resolve(null); },
      });
      if (o.multi) m.el.querySelector('.modal-foot').prepend(count);
      load(); upd();
    });
  };

  TC.openDirect = async (userId) => {
    try {
      const r = await TC.api('/chats/direct', { method: 'POST', body: { user_id: userId } });
      TC.upsertChat(r.chat);
      TC.go('/chats/' + r.chat.id);
    } catch (e) { TC.fail(e); }
  };
  TC.newChat = async () => {
    const ids = await TC.pickUsers({ title: t('chat.new') });
    if (ids) TC.openDirect(ids[0]);
  };
  TC.newGroup = () => {
    const name = h('input', { class: 'input', placeholder: t('group.namePh'), maxlength: '80' });
    const desc = h('input', { class: 'input', placeholder: t('group.descPh'), maxlength: '300' });
    const members = new Set();
    const chips = h('div', { class: 'chips' });
    const renderChips = () => {
      chips.replaceChildren();
      members.forEach((u) => chips.appendChild(h('span', { class: 'chip' }, u.name, h('button', { type: 'button', class: 'chip-x', onclick: () => { members.delete(u); renderChips(); } }, '×'))));
    };
    const addBtn = h('button', { class: 'btn ghost', type: 'button', onclick: async () => {
      const ids = await TC.pickUsers({ title: t('group.addMembers'), multi: true, exclude: [...members].map((u) => u.id) });
      if (!ids) return;
      const r = await TC.api('/users?q=');
      r.users.filter((u) => ids.includes(u.id)).forEach((u) => members.add(u));
      renderChips();
    } }, ic('user-plus', 18), t('group.addMembers'));
    TC.modal({
      title: t('group.new'),
      body: [h('label', { class: 'label' }, t('group.name')), name, h('label', { class: 'label' }, t('group.description')), desc, h('label', { class: 'label' }, t('group.members')), chips, addBtn],
      actions: [{ label: t('common.cancel'), kind: 'ghost' }, { label: t('group.create'), kind: 'primary', onClick: async () => {
        if (!name.value.trim()) { TC.toast(t('group.nameRequired'), 'error'); return false; }
        if (!members.size) { TC.toast(t('picker.none'), 'error'); return false; }
        const r = await TC.api('/chats/group', { method: 'POST', body: { name: name.value, description: desc.value, member_ids: [...members].map((u) => u.id) } });
        TC.upsertChat(r.chat); TC.go('/chats/' + r.chat.id);
      } }],
    });
  };

  /* ================= chat list pane ================= */
  function renderList(container, activeId) {
    let filter = TC.LS.get('tc_chatfilter', 'all');
    const list = h('div', { class: 'chat-list', role: 'list' });
    const search = h('input', { class: 'input search', type: 'search', placeholder: t('chat.searchPh'), autocomplete: 'off' });
    const tabs = h('div', { class: 'tabs' });
    const head = h('div', { class: 'pane-head' },
      h('h2', null, t('nav.chats')),
      h('div', { class: 'row gap-s' },
        TC.can('create_groups') ? h('button', { class: 'icon-btn', title: t('group.new'), onclick: TC.newGroup }, ic('users', 20)) : null,
        h('button', { class: 'icon-btn accent', title: t('chat.new'), onclick: TC.newChat }, ic('plus', 20))));
    container.append(head, h('div', { class: 'pane-search' }, ic('search', 16), search), tabs, list);

    const FILTERS = ['all', 'unread', 'groups', 'archived'];
    const draw = () => {
      tabs.replaceChildren(...FILTERS.map((f) => {
        const n = f === 'unread' ? S.chats.filter((c) => c.unread && !c.my.archived).length : f === 'archived' ? S.chats.filter((c) => c.my.archived).length : 0;
        return h('button', { class: 'tab' + (filter === f ? ' active' : ''), onclick: () => { filter = f; TC.LS.set('tc_chatfilter', f); draw(); } }, t('filter.' + f), n ? h('span', { class: 'tab-n' }, n) : null);
      }));
      const q = search.value.trim().toLowerCase();
      let items = S.chats.filter((c) => (filter === 'archived' ? c.my.archived : !c.my.archived));
      if (filter === 'unread') items = items.filter((c) => c.unread);
      if (filter === 'groups') items = items.filter((c) => c.kind === 'group');
      if (q) items = items.filter((c) => c.name.toLowerCase().includes(q));
      list.replaceChildren();
      if (!S.chatsLoaded) { for (let i = 0; i < 6; i++) list.appendChild(h('div', { class: 'skeleton-row' }, h('i', { class: 'sk-av' }), h('div', { class: 'grow' }, h('i', { class: 'sk-line' }), h('i', { class: 'sk-line short' })))); return; }
      if (!items.length) { list.appendChild(h('div', { class: 'empty-small' }, ic('chat', 28), h('div', null, q ? t('common.noResults') : t('chat.emptyList')))); return; }
      items.forEach((c) => list.appendChild(chatRow(c, c.id === activeId)));
    };
    search.addEventListener('input', draw);
    const redraw = TC.debounce(draw, 30);
    ['chats', 'presence', 'typing'].forEach((e) => TC.on(e, redraw));
    draw();
  }

  function chatRow(c, active) {
    const typing = S.typing[c.id] && Object.keys(S.typing[c.id]).length;
    const mine = c.last_message && c.last_message.sender_id === S.me.id && c.last_message.kind !== 'system' && !c.last_message.deleted;
    let tick = null;
    if (mine) { const st = TC.msgStatus({ id: c.last_message.id }, c); tick = h('span', { class: 'tick ' + st }, ic(st === 'sent' ? 'check' : 'checks', 14)); }
    const online = c.kind === 'direct' && c.other && TC.isOnline(c.other.id);
    return h('a', { class: 'chat-row' + (active ? ' active' : '') + (c.unread ? ' unread' : ''), href: '#/chats/' + c.id, role: 'listitem' },
      h('div', { class: 'avatar-wrap' }, TC.avatar(c.name, c.avatar, 48), online ? h('i', { class: 'dot online' }) : null),
      h('div', { class: 'grow cr-main' },
        h('div', { class: 'cr-top' },
          h('span', { class: 'cr-name' }, c.is_support && !TC.isAdmin() ? ic('shield', 14) : null, c.name, c.is_support && !TC.isAdmin() ? h('span', { class: 'badge-admin' }, t('chat.adminBadge')) : null),
          h('span', { class: 'cr-time' }, c.last_message ? TC.listTime(c.last_message.created_at) : '')),
        h('div', { class: 'cr-bot' },
          typing ? h('span', { class: 'cr-prev typing' }, t('chat.typing')) : h('span', { class: 'cr-prev' }, tick, TC.chatPreview(c)),
          h('span', { class: 'cr-flags' }, c.my.muted ? ic('bell-off', 14) : null, c.my.pinned ? ic('pin', 14) : null, c.unread ? h('span', { class: 'badge' + (c.my.muted ? ' muted' : '') }, c.unread > 99 ? '99+' : c.unread) : null))));
  }

  /* ================= routes ================= */
  function renderPage(view, id) {
    view.classList.toggle('has-chat', !!id);
    const left = h('section', { class: 'chat-list-pane' });
    const right = h('section', { class: 'chat-main-pane' });
    view.append(left, right);
    renderList(left, id);
    if (id) mountConversation(right, id);
    else right.appendChild(h('div', { class: 'empty-state' }, h('div', { class: 'empty-art' }, ic('chat', 56)), h('h2', null, t('chat.selectTitle')), h('p', { class: 'muted' }, t('chat.selectText'))));
    document.body.classList.toggle('in-chat', !!id);
    TC.onUnmount(() => document.body.classList.remove('in-chat'));
    if (!S.chatsLoaded) TC.loadChats().catch(TC.fail);
  }
  TC.route('/chats', (v) => renderPage(v, null), { name: 'chats', cls: 'view-chats' });
  TC.route('/chats/:id', (v, p) => renderPage(v, Number(p.id)), { name: 'chats', cls: 'view-chats' });

  /* ================= conversation ================= */
  function mountConversation(root, chatId) {
    const mount = async () => {
      if (!S.chatsLoaded) { try { await TC.loadChats(); } catch (e) { TC.fail(e); } }
      const chat0 = TC.chat(chatId);
      if (!chat0) { root.replaceChildren(h('div', { class: 'empty-state' }, h('h2', null, t('chat.notFound')), h('a', { class: 'btn primary', href: '#/chats' }, t('nav.chats')))); return; }
      build(root, chatId);
    };
    mount();
  }

  function build(root, chatId) {
    S.activeChat = chatId;
    TC.onUnmount(() => { if (S.activeChat === chatId) S.activeChat = null; });
    const cs = { reply: null, editing: null, loadingOlder: false, atBottom: true, newCount: 0, uploads: 0, files: [] };
    const chat = () => TC.chat(chatId);
    const nodes = {};
    let lastDate = null;

    /* ---- header ---- */
    const titleEl = h('div', { class: 'strong ch-title' });
    const subEl = h('div', { class: 'ch-sub' });
    const avWrap = h('div', { class: 'avatar-wrap' });
    const header = h('div', { class: 'conv-head' },
      h('button', { class: 'icon-btn back-btn', title: t('common.back'), onclick: () => { location.hash = '#/chats'; } }, ic('back', 22)),
      h('div', { class: 'ch-click', onclick: () => openInfo(chatId) }, avWrap, h('div', { class: 'grow min0' }, titleEl, subEl)),
      h('div', { class: 'row gap-s' },
        TC.can('search') ? h('button', { class: 'icon-btn', title: t('chat.searchIn'), onclick: () => openSearch() }, ic('search', 20)) : null,
        h('button', { class: 'icon-btn', title: t('chat.info'), onclick: () => openInfo(chatId) }, ic('info', 20))));
    const subText = () => {
      const c = chat(); if (!c) return '';
      const tp = S.typing[c.id] ? Object.values(S.typing[c.id]) : [];
      if (tp.length) return (c.kind === 'group' ? tp[0].name.split(' ')[0] + ' ' : '') + t(c.kind === 'group' ? 'chat.isTyping' : 'chat.typing');
      if (c.kind === 'direct') return c.other ? (TC.isOnline(c.other.id) ? t('chat.online') : TC.lastSeen(c.other.last_seen)) : '';
      return c.members.map((m) => (m.user.id === S.me.id ? t('chat.you') : m.user.name.split(' ')[0])).join(', ');
    };
    const drawHeader = () => {
      const c = chat(); if (!c) return;
      titleEl.replaceChildren(c.name, c.is_support && !TC.isAdmin() ? h('span', { class: 'badge-admin' }, t('chat.adminBadge')) : null);
      avWrap.replaceChildren(TC.avatar(c.name, c.avatar, 40), c.kind === 'direct' && c.other && TC.isOnline(c.other.id) ? h('i', { class: 'dot online' }) : null);
      const tp = S.typing[c.id] && Object.keys(S.typing[c.id]).length;
      subEl.textContent = subText(); subEl.classList.toggle('typing', !!tp);
      composerGate();
    };

    /* ---- messages area ---- */
    const msgBox = h('div', { class: 'messages', tabindex: '0' });
    const fab = h('button', { class: 'fab-down hidden', title: t('chat.latest'), onclick: () => scrollBottom(true) }, ic('down', 20), h('span', { class: 'fab-n' }));
    const msgWrap = h('div', { class: 'messages-wrap' }, msgBox, fab);
    const scrollBottom = (smooth) => { msgBox.scrollTo({ top: msgBox.scrollHeight, behavior: smooth ? 'smooth' : 'auto' }); cs.newCount = 0; fab.classList.add('hidden'); };

    const replyQuote = (r) => h('div', { class: 'b-reply', onclick: (e) => { e.stopPropagation(); jumpTo(r.id); } },
      h('div', { class: 'b-reply-name' }, r.sender_id === S.me.id ? t('chat.you') : r.sender_name),
      h('div', { class: 'b-reply-text' }, r.deleted ? t('chat.deleted') : r.body || t('kind.' + r.kind)));

    const fileCard = (m) => h('a', { class: 'b-file', href: m.file.url, target: '_blank', rel: 'noopener', download: m.file.name },
      h('div', { class: 'file-ic' }, ic('file-text', 24)),
      h('div', { class: 'grow min0' }, h('div', { class: 'file-name' }, m.file.name), h('div', { class: 'muted small' }, TC.fmtSize(m.file.size))),
      ic('download', 18));

    const tickEl = (m) => {
      const st = TC.msgStatus(m, chat());
      return h('span', { class: 'tick ' + st, 'data-tick': m.id }, ic(st === 'sent' ? 'check' : 'checks', 15));
    };

    function buildRow(m) {
      const c = chat();
      const mine = m.sender_id === S.me.id;
      const row = h('div', { class: 'msg-row ' + (m.kind === 'system' ? 'system' : mine ? 'mine' : 'theirs'), 'data-id': m.id });
      if (m.kind === 'system') { row.appendChild(h('div', { class: 'sys-pill' }, m.body)); return row; }
      const bub = h('div', { class: 'bubble' + (m.deleted ? ' deleted' : '') + (m.file && (m.kind === 'image' || m.kind === 'video') && !m.body ? ' media-only' : '') });
      if (!mine && c.kind === 'group') bub.appendChild(h('div', { class: 'b-sender', style: { color: TC.colorFor(m.sender_name) } }, m.sender_name));
      if (m.forwarded && !m.deleted) bub.appendChild(h('div', { class: 'b-fwd' }, ic('forward', 13), t('chat.forwarded')));
      if (m.reply_to && !m.deleted) bub.appendChild(replyQuote(m.reply_to));
      if (m.deleted) bub.appendChild(h('div', { class: 'b-deleted' }, ic('ban', 15), t('chat.deleted')));
      else {
        if (m.kind === 'poll') bub.appendChild(pollBlock(m));
        if (m.file) {
          if (m.kind === 'image') bub.appendChild(h('img', { class: 'b-img', src: m.file.url, alt: m.file.name, loading: 'lazy', onclick: () => lightbox(m) }));
          else if (m.kind === 'video') bub.appendChild(h('video', { class: 'b-video', src: m.file.url, controls: true, preload: 'metadata', playsinline: true }));
          else if (m.kind === 'audio') bub.appendChild(h('div', { class: 'b-audio' }, h('audio', { src: m.file.url, controls: true, preload: 'metadata' })));
          else bub.appendChild(fileCard(m));
        }
        if (m.body && m.kind !== 'poll') bub.appendChild(h('div', { class: 'b-text' }, TC.linkify(m.body)));
      }
      bub.appendChild(h('div', { class: 'b-meta' }, m.starred ? ic('star', 12) : null, m.edited_at && !m.deleted ? h('span', null, t('chat.edited')) : null, h('span', null, TC.fmtTime(m.created_at)), mine && !m.deleted ? tickEl(m) : null));
      if (!m.deleted) {
        bub.appendChild(h('button', { class: 'b-more', title: t('common.more'), onclick: (e) => { e.stopPropagation(); msgMenu(m, e.currentTarget); } }, ic('down', 16)));
        bub.addEventListener('contextmenu', (e) => { if (e.target.closest('a,video,audio')) return; e.preventDefault(); msgMenu(m, { x: e.clientX, y: e.clientY }); });
        let lp;
        bub.addEventListener('touchstart', (e) => { if (e.target.closest('audio,video,a')) return; lp = setTimeout(() => { const tt = e.touches[0]; msgMenu(m, { x: tt.clientX, y: tt.clientY }); }, 520); }, { passive: true });
        ['touchend', 'touchmove', 'touchcancel'].forEach((ev) => bub.addEventListener(ev, () => clearTimeout(lp), { passive: true }));
      }
      row.appendChild(bub);
      if (m.reactions && m.reactions.length && !m.deleted) {
        row.appendChild(h('div', { class: 'b-reacts' }, m.reactions.map((r) => h('button', { class: 'react' + (r.user_ids.includes(S.me.id) ? ' mine' : ''), title: r.user_ids.length, onclick: () => react(m, r.emoji) }, r.emoji, r.user_ids.length > 1 ? h('span', null, r.user_ids.length) : null))));
      }
      return row;
    }

    function pollBlock(m) {
      const p = m.poll;
      if (!p) return h('div', { class: 'b-text' }, m.body);
      const voters = new Set(); p.options.forEach((o) => o.voters.forEach((v) => voters.add(v)));
      const total = voters.size;
      const mine = new Set(p.options.filter((o) => o.voters.includes(S.me.id)).map((o) => o.id));
      const box = h('div', { class: 'b-poll' },
        h('div', { class: 'poll-q' }, ic('chart', 16), p.question),
        h('div', { class: 'muted small' }, t(p.multiple ? 'poll.multi' : 'poll.single') + (p.closed ? ' · ' + t('poll.closed') : '')));
      p.options.forEach((o) => {
        const n = o.voters.length, pct = total ? Math.round((n / total) * 100) : 0;
        box.appendChild(h('button', { type: 'button', class: 'poll-opt' + (mine.has(o.id) ? ' mine' : ''), disabled: p.closed, onclick: () => vote(p, o) },
          h('i', { class: 'poll-bar', style: { width: pct + '%' } }), h('span', { class: 'poll-text' }, (mine.has(o.id) ? '✓ ' : '') + o.text), h('span', { class: 'poll-n' }, n)));
      });
      box.appendChild(h('div', { class: 'row between small muted poll-foot' }, h('span', null, t('poll.votes', { n: total })),
        !p.closed && (m.sender_id === S.me.id || TC.isAdmin()) ? h('button', { class: 'btn ghost small', type: 'button', onclick: async () => { try { await TC.api('/polls/' + p.id + '/close', { method: 'POST', body: {} }); } catch (e) { TC.fail(e); } } }, t('poll.close')) : null));
      return box;
    }
    async function vote(p, o) {
      let ids;
      const cur = p.options.filter((x) => x.voters.includes(S.me.id)).map((x) => x.id);
      if (p.multiple) ids = cur.includes(o.id) ? cur.filter((i) => i !== o.id) : cur.concat(o.id);
      else ids = cur.includes(o.id) ? [] : [o.id];
      try { await TC.api('/polls/' + p.id + '/vote', { method: 'POST', body: { option_ids: ids } }); } catch (e) { TC.fail(e); }
    }

    function createPoll() {
      const q = h('input', { class: 'input', maxlength: '300', placeholder: t('poll.questionPh') });
      const list = h('div', { class: 'poll-inputs' });
      const inputs = [];
      const addOpt = () => { if (inputs.length >= 10) return; const i = h('input', { class: 'input', maxlength: '200', placeholder: t('poll.option') + ' ' + (inputs.length + 1) }); inputs.push(i); list.appendChild(i); };
      addOpt(); addOpt();
      const multi = h('input', { type: 'checkbox', class: 'switch' });
      TC.modal({ title: t('poll.create'), body: [h('label', { class: 'label' }, t('poll.question')), q, h('label', { class: 'label' }, t('poll.options')), list,
        h('button', { class: 'btn ghost small', type: 'button', onclick: addOpt }, ic('plus', 14), t('poll.addOption')), h('label', { class: 'switch-row' }, h('span', { class: 'grow' }, t('poll.multiple')), multi)],
        actions: [{ label: t('common.cancel'), kind: 'ghost' }, { label: t('poll.create'), kind: 'primary', onClick: async () => {
          const opts = inputs.map((i) => i.value.trim()).filter(Boolean);
          if (!q.value.trim() || opts.length < 2) { TC.toast(t('poll.needTwo'), 'error'); return false; }
          const r = await TC.api('/chats/' + chatId + '/polls', { method: 'POST', body: { question: q.value, options: opts, multiple: multi.checked } });
          TC.addMessage(r.message);
        } }] });
    }

    function scheduleModal() {
      const pad = (n) => String(n).padStart(2, '0');
      const d = new Date(Date.now() + 3600 * 1000);
      const when = h('input', { class: 'input', type: 'datetime-local', value: d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) });
      const text = h('textarea', { class: 'input', rows: '3', maxlength: '4000', placeholder: t('sched.message') }, input.value);
      const pending = h('div', { class: 'sched-list' });
      const drawPending = async () => {
        try {
          const r = await TC.api('/scheduled?chat_id=' + chatId);
          pending.replaceChildren(r.scheduled.length ? h('div', { class: 'section-title nopad' }, t('sched.pending')) : null,
            ...r.scheduled.map((x) => h('div', { class: 'snip-row' }, ic('clock', 16), h('div', { class: 'grow' }, h('div', { class: 'small muted' }, TC.fmtDateTime(x.send_at)), h('div', { class: 'ellipsis' }, x.body)),
              h('button', { class: 'icon-btn danger', title: t('common.cancel'), onclick: async () => { await TC.api('/scheduled/' + x.id, { method: 'DELETE' }); drawPending(); } }, ic('x', 18)))));
        } catch (e) { /* ignore */ }
      };
      TC.modal({ title: t('sched.title'), body: [h('p', { class: 'muted' }, t('sched.sub')), h('label', { class: 'label' }, t('sched.when')), when, h('label', { class: 'label' }, t('sched.message')), text, pending],
        actions: [{ label: t('common.close'), kind: 'ghost' }, { label: t('sched.send'), kind: 'primary', onClick: async () => {
          if (!text.value.trim()) { TC.toast(t('admin.messageRequired'), 'error'); return false; }
          await TC.api('/scheduled', { method: 'POST', body: { chat_id: chatId, body: text.value, send_at: new Date(when.value).toISOString() } });
          if (text.value === input.value) { input.value = ''; autoGrow(); saveDraft(); }
          TC.toast(t('sched.created'), 'success');
        } }] });
      drawPending();
    }

    function dayRow(iso) { return h('div', { class: 'day-sep' }, h('span', null, TC.dayLabel(iso))); }

    function renderAll(keepScroll) {
      const s = TC.slot(chatId);
      const prevH = msgBox.scrollHeight, prevT = msgBox.scrollTop;
      msgBox.replaceChildren(); lastDate = null;
      Object.keys(nodes).forEach((k) => delete nodes[k]);
      if (s.hasMore) msgBox.appendChild(h('button', { class: 'btn ghost small load-older', onclick: loadOlder }, t('chat.loadOlder')));
      if (!s.list.length) msgBox.appendChild(h('div', { class: 'empty-small' }, ic('chat', 28), h('div', null, t('chat.sayHi'))));
      s.list.forEach((m) => appendRow(m));
      if (keepScroll) msgBox.scrollTop = prevT + (msgBox.scrollHeight - prevH); else scrollBottom(false);
    }
    function appendRow(m) {
      if (lastDate === null || !TC.sameDay(lastDate, m.created_at)) { msgBox.appendChild(dayRow(m.created_at)); }
      lastDate = m.created_at;
      const row = buildRow(m);
      nodes[m.id] = row;
      msgBox.appendChild(row);
    }
    function replaceRow(m) {
      const old = nodes[m.id]; if (!old) return;
      const row = buildRow(m); old.replaceWith(row); nodes[m.id] = row;
    }
    async function loadOlder() {
      if (cs.loadingOlder) return;
      cs.loadingOlder = true;
      try { await TC.loadOlder(chatId); renderAll(true); } catch (e) { TC.fail(e); }
      cs.loadingOlder = false;
    }
    msgBox.addEventListener('scroll', () => {
      cs.atBottom = msgBox.scrollHeight - msgBox.scrollTop - msgBox.clientHeight < 140;
      if (cs.atBottom) { cs.newCount = 0; fab.classList.add('hidden'); } else fab.classList.remove('hidden');
      const s = TC.slot(chatId);
      if (msgBox.scrollTop < 60 && s && s.hasMore) loadOlder();
    });
    async function jumpTo(id) {
      for (let i = 0; i < 12 && !nodes[id]; i++) { const n = await TC.loadOlder(chatId).catch(() => 0); if (!n) break; renderAll(true); }
      const el = nodes[id];
      if (!el) { TC.toast(t('chat.msgNotFound'), 'error'); return; }
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1600);
    }

    /* ---- actions on messages ---- */
    const findMsg = (id) => (TC.slot(chatId) ? TC.slot(chatId).list.find((x) => x.id === id) : null);
    async function react(m, emoji) {
      try { const r = await TC.api('/messages/' + m.id + '/react', { method: 'POST', body: { emoji } }); m.reactions = r.reactions; replaceRow(m); } catch (e) { TC.fail(e); }
    }
    function startReply(m) { cs.reply = m; cs.editing = null; drawBars(); input.focus(); }
    function startEdit(m) { cs.editing = m; cs.reply = null; input.value = m.body; autoGrow(); drawBars(); input.focus(); }
    async function toggleStar(m) {
      try { const r = await TC.api('/messages/' + m.id + '/star', { method: 'POST', body: {} }); m.starred = r.starred; replaceRow(m); TC.toast(t(r.starred ? 'chat.starred' : 'chat.unstarred'), 'success'); } catch (e) { TC.fail(e); }
    }
    function delMsg(m) {
      const mine = m.sender_id === S.me.id || TC.isAdmin();
      TC.modal({
        title: t('chat.deleteTitle'), body: h('p', null, t('chat.deleteText')),
        actions: [
          { label: t('common.cancel'), kind: 'ghost' },
          { label: t('chat.deleteForMe'), kind: 'ghost', onClick: async () => { await TC.api('/messages/' + m.id + '?mode=me', { method: 'DELETE' }); } },
          mine ? { label: t('chat.deleteForAll'), kind: 'danger', onClick: async () => { await TC.api('/messages/' + m.id + '?mode=everyone', { method: 'DELETE' }); } } : null,
        ].filter(Boolean),
      });
    }
    function forwardMsg(m) {
      const picked = new Set();
      const rows = S.chats.filter((c) => !(c.kind === 'group' && c.only_admins_post && !c.my.is_admin && !TC.isAdmin())).map((c) => {
        const cb = h('input', { type: 'checkbox', class: 'check' });
        const row = h('label', { class: 'picker-row' }, TC.avatar(c.name, c.avatar, 36), h('div', { class: 'grow strong' }, c.name), cb);
        cb.addEventListener('change', () => { if (cb.checked) picked.add(c.id); else picked.delete(c.id); });
        return row;
      });
      TC.modal({
        title: t('chat.forwardTo'), body: h('div', { class: 'picker-list' }, rows),
        actions: [{ label: t('common.cancel'), kind: 'ghost' }, { label: t('chat.forward'), kind: 'primary', onClick: async () => {
          if (!picked.size) { TC.toast(t('picker.none'), 'error'); return false; }
          const r = await TC.api('/messages/forward', { method: 'POST', body: { message_ids: [m.id], chat_ids: [...picked] } });
          TC.toast(t('chat.forwardedN', { n: r.forwarded }), 'success');
        } }],
      });
    }
    function msgMenu(m, anchor) {
      const mine = m.sender_id === S.me.id;
      const editable = mine && m.kind === 'text' && TC.can('edit_messages') && Date.now() - new Date(m.created_at).getTime() < 24 * 3600 * 1000;
      const header = TC.can('reactions') ? h('div', { class: 'quick-react' }, QUICK.map((e) => h('button', { type: 'button', onclick: () => { TC.closeMenu(); react(m, e); } }, e))) : null;
      TC.menu(anchor, [
        TC.can('reply_forward') ? { icon: 'reply', label: t('chat.reply'), onClick: () => startReply(m) } : null,
        TC.can('reply_forward') ? { icon: 'forward', label: t('chat.forward'), onClick: () => forwardMsg(m) } : null,
        m.body ? { icon: 'copy', label: t('chat.copy'), onClick: () => TC.copy(m.body) } : null,
        TC.can('star_messages') ? { icon: 'star', label: t(m.starred ? 'chat.unstar' : 'chat.star'), onClick: () => toggleStar(m) } : null,
        editable ? { icon: 'edit', label: t('chat.edit'), onClick: () => startEdit(m) } : null,
        m.file ? { icon: 'download', label: t('chat.download'), onClick: () => downloadFile(m) } : null,
        TC.can('tickets') ? { icon: 'clipboard', label: t('tickets.fromMessage'), onClick: () => TC.createTicketFromMessage(m) } : null,
        TC.can('delete_messages') ? { divider: true } : null,
        TC.can('delete_messages') ? { icon: 'trash', label: t('common.delete'), danger: true, onClick: () => delMsg(m) } : null,
      ], { header });
    }
    async function downloadFile(m) {
      try { const r = await fetch(m.file.url); TC.saveBlob(await r.blob(), m.file.name); }
      catch (e) { window.open(m.file.url, '_blank'); }
    }
    function lightbox(m) {
      const close = () => { back.remove(); document.removeEventListener('keydown', onk); };
      const onk = (e) => { if (e.key === 'Escape') close(); };
      const back = h('div', { class: 'lightbox', onclick: (e) => { if (e.target === back) close(); } },
        h('div', { class: 'lb-bar' }, h('div', { class: 'grow' }, m.file.name), h('button', { class: 'icon-btn light', onclick: () => downloadFile(m), title: t('chat.download') }, ic('download', 22)), h('button', { class: 'icon-btn light', onclick: close, title: t('common.close') }, ic('x', 24))),
        h('img', { src: m.file.url, alt: m.file.name }));
      document.addEventListener('keydown', onk);
      document.body.appendChild(back);
    }

    /* ---- composer ---- */
    const input = h('textarea', { class: 'composer-input', rows: '1', placeholder: t('chat.typeMessage'), maxlength: '4000', 'aria-label': t('chat.typeMessage') });
    const replyBar = h('div', { class: 'compose-bar hidden' });
    const uploadsBox = h('div', { class: 'uploads' });
    const btnEmoji = h('button', { class: 'icon-btn', type: 'button', title: t('chat.emoji'), onclick: () => toggleEmoji() }, ic('smile', 24));
    const btnAttach = h('button', { class: 'icon-btn', type: 'button', title: t('chat.attach'), onclick: (e) => attachMenu(e.currentTarget) }, ic('paperclip', 24));
    const btnSend = h('button', { class: 'send-btn', type: 'button', title: t('common.send'), onclick: () => (input.value.trim() ? sendText() : startRecording()) });
    const fileMedia = h('input', { type: 'file', multiple: true, accept: 'image/*,video/*', class: 'hidden' });
    const fileDoc = h('input', { type: 'file', multiple: true, class: 'hidden' });
    const emojiPanel = h('div', { class: 'emoji-panel hidden' });
    const snipPanel = h('div', { class: 'snip-panel hidden' });
    const composerRow = h('div', { class: 'composer-row' }, btnEmoji, btnAttach, input, btnSend, fileMedia, fileDoc);
    const blocked = h('div', { class: 'composer-blocked hidden' }, ic('lock', 16), t('chat.adminsOnly'));
    const composer = h('div', { class: 'composer' }, replyBar, uploadsBox, snipPanel, emojiPanel, composerRow, blocked);

    const composerGate = () => {
      const c = chat(); if (!c) return;
      const blockedNow = c.kind === 'group' && c.only_admins_post && !c.my.is_admin && !TC.isAdmin();
      composerRow.classList.toggle('hidden', blockedNow); blocked.classList.toggle('hidden', !blockedNow);
      btnAttach.classList.toggle('hidden', !(TC.can('send_files') || TC.can('polls') || TC.can('schedule_messages')));
    };
    const syncSendIcon = () => {
      const has = input.value.trim().length > 0 || cs.editing;
      btnSend.replaceChildren(ic(has ? 'send' : 'mic', 22));
      btnSend.classList.toggle('mic', !has);
      btnSend.classList.toggle('hidden', !has && !TC.can('voice_notes'));
    };
    function autoGrow() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 140) + 'px'; syncSendIcon(); }
    function drawBars() {
      replyBar.replaceChildren();
      const m = cs.reply || cs.editing;
      replyBar.classList.toggle('hidden', !m);
      if (m) {
        replyBar.append(
          h('div', { class: 'cb-ic' }, ic(cs.editing ? 'edit' : 'reply', 18)),
          h('div', { class: 'grow min0' }, h('div', { class: 'strong small' }, cs.editing ? t('chat.editing') : t('chat.replyingTo', { name: m.sender_id === S.me.id ? t('chat.you') : m.sender_name })), h('div', { class: 'muted small ellipsis' }, m.body || t('kind.' + m.kind))),
          h('button', { class: 'icon-btn', onclick: () => { cs.reply = cs.editing = null; if (cs.editing === null) input.value = input.value; drawBars(); syncSendIcon(); } }, ic('x', 18)));
      }
      syncSendIcon();
    }
    const draftKey = 'tc_draft_' + chatId;
    input.value = TC.LS.get(draftKey, '');
    const saveDraft = TC.debounce(() => { if (input.value) TC.LS.set(draftKey, input.value); else TC.LS.del(draftKey); }, 300);
    let lastTyping = 0;
    let snipMatches = [];
    const useSnippet = (sn) => { input.value = sn.text; snipPanel.classList.add('hidden'); snipMatches = []; autoGrow(); saveDraft(); input.focus(); };
    const drawSnip = () => {
      const v = input.value;
      snipMatches = /^\/[a-z0-9_-]*$/i.test(v) ? TC.snippets.filter((x) => x.shortcut.startsWith(v.slice(1).toLowerCase())).slice(0, 6) : [];
      snipPanel.classList.toggle('hidden', !snipMatches.length);
      snipPanel.replaceChildren(...snipMatches.map((sn, i) => h('button', { type: 'button', class: 'snip-item' + (i === 0 ? ' first' : ''), onclick: () => useSnippet(sn) }, h('b', null, '/' + sn.shortcut), h('span', { class: 'muted ellipsis' }, sn.text))));
    };
    input.addEventListener('input', () => {
      drawSnip();
      autoGrow(); saveDraft();
      if (Date.now() - lastTyping > 2000 && input.value) { lastTyping = Date.now(); TC.wsSend({ type: 'typing', chat_id: chatId }); }
    });
    input.addEventListener('keydown', (e) => {
      const enterSends = TC.pref('enterToSend', !window.matchMedia('(pointer: coarse)').matches);
      if ((e.key === 'Tab' || e.key === 'Enter') && snipMatches.length && !e.shiftKey) { e.preventDefault(); useSnippet(snipMatches[0]); return; }
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && enterSends) { e.preventDefault(); sendText(); }
      if (e.key === 'Escape' && (cs.reply || cs.editing)) { if (cs.editing) input.value = ''; cs.reply = cs.editing = null; drawBars(); autoGrow(); }
    });
    input.addEventListener('paste', (e) => {
      const files = Array.from((e.clipboardData && e.clipboardData.files) || []);
      if (files.length && TC.can('send_files')) { e.preventDefault(); previewFiles(files); }
    });

    async function sendText() {
      const body = input.value.trim();
      if (!body) return;
      if (cs.editing) {
        const m = cs.editing;
        try { const r = await TC.api('/messages/' + m.id, { method: 'PATCH', body: { body } }); Object.assign(m, r.message, { starred: m.starred }); replaceRow(m); cs.editing = null; input.value = ''; drawBars(); autoGrow(); }
        catch (e) { TC.fail(e); }
        return;
      }
      const payload = { body, reply_to_id: cs.reply ? cs.reply.id : null };
      input.value = ''; const keepReply = cs.reply; cs.reply = null; drawBars(); autoGrow(); saveDraft();
      try {
        const r = await TC.api('/chats/' + chatId + '/messages', { method: 'POST', body: payload });
        TC.addMessage(r.message);
      } catch (e) { input.value = body; cs.reply = keepReply; drawBars(); autoGrow(); TC.fail(e); }
    }

    /* ---- emoji ---- */
    let emojiCat = 'smileys';
    function drawEmoji() {
      emojiPanel.replaceChildren(
        h('div', { class: 'emoji-tabs' }, Object.keys(EMOJI).map((k) => h('button', { type: 'button', class: k === emojiCat ? 'active' : '', onclick: () => { emojiCat = k; drawEmoji(); } }, EMOJI[k][0]))),
        h('div', { class: 'emoji-grid' }, EMOJI[emojiCat].map((e) => h('button', { type: 'button', onclick: () => { const p = input.selectionStart || input.value.length; input.setRangeText(e, p, input.selectionEnd || p, 'end'); autoGrow(); saveDraft(); input.focus(); } }, e))));
    }
    function toggleEmoji() { emojiPanel.classList.toggle('hidden'); if (!emojiPanel.classList.contains('hidden')) drawEmoji(); }

    /* ---- attachments ---- */
    function attachMenu(anchor) {
      TC.menu(anchor, [
        TC.can('send_files') ? { icon: 'image', label: t('chat.photoVideo'), onClick: () => fileMedia.click() } : null,
        TC.can('send_files') ? { icon: 'file', label: t('chat.document'), onClick: () => fileDoc.click() } : null,
        TC.can('polls') ? { icon: 'chart', label: t('poll.create'), onClick: createPoll } : null,
        TC.can('schedule_messages') ? { icon: 'clock', label: t('sched.title'), onClick: scheduleModal } : null,
      ]);
    }
    [fileMedia, fileDoc].forEach((f) => f.addEventListener('change', () => { const fl = Array.from(f.files); f.value = ''; if (fl.length) previewFiles(fl); }));
    const dropZone = root;
    ['dragover', 'dragenter'].forEach((ev) => dropZone.addEventListener(ev, (e) => { if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) { e.preventDefault(); dropZone.classList.add('dragging'); } }));
    ['dragleave', 'drop'].forEach((ev) => dropZone.addEventListener(ev, (e) => { if (ev === 'dragleave' && dropZone.contains(e.relatedTarget)) return; dropZone.classList.remove('dragging'); }));
    dropZone.addEventListener('drop', (e) => { const fl = Array.from((e.dataTransfer && e.dataTransfer.files) || []); if (fl.length && TC.can('send_files')) { e.preventDefault(); previewFiles(fl); } });

    function previewFiles(files) {
      const max = (S.me.max_upload_mb || 100) * 1024 * 1024;
      const ok = files.filter((f) => { if (f.size > max) { TC.toast(t('chat.tooLarge', { name: f.name, mb: S.me.max_upload_mb }), 'error'); return false; } return true; });
      if (!ok.length) return;
      const list = h('div', { class: 'preview-list' });
      const caption = h('textarea', { class: 'input', rows: '2', placeholder: t('chat.caption'), maxlength: '1000' });
      const urls = [];
      const draw = () => {
        list.replaceChildren(...ok.map((f, i) => {
          let thumb;
          if (f.type.startsWith('image/')) { const u = URL.createObjectURL(f); urls.push(u); thumb = h('img', { src: u, alt: '' }); }
          else thumb = h('div', { class: 'file-ic' }, ic(f.type.startsWith('video/') ? 'play' : 'file-text', 26));
          return h('div', { class: 'preview-item' }, h('div', { class: 'pv-thumb' }, thumb), h('div', { class: 'grow min0' }, h('div', { class: 'file-name' }, f.name), h('div', { class: 'muted small' }, TC.fmtSize(f.size))),
            h('button', { class: 'icon-btn', onclick: () => { ok.splice(i, 1); if (!ok.length) m.close(); else draw(); } }, ic('x', 18)));
        }));
      };
      const m = TC.modal({
        title: t('chat.sendFiles', { n: ok.length }), body: [list, caption],
        onClose: () => urls.forEach((u) => URL.revokeObjectURL(u)),
        actions: [{ label: t('common.cancel'), kind: 'ghost' }, { label: t('common.send'), kind: 'primary', onClick: () => { uploadFiles(ok.slice(), caption.value.trim()); } }],
      });
      draw();
    }
    async function uploadFiles(files, caption, extra) {
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const bar = h('i', { class: 'bar' });
        const ref = {};
        const cancel = h('button', { class: 'icon-btn', title: t('common.cancel'), onclick: () => ref.xhr && ref.xhr.abort() }, ic('x', 16));
        const item = h('div', { class: 'upload-item' }, h('div', { class: 'grow min0' }, h('div', { class: 'file-name' }, f.name), h('div', { class: 'progress' }, bar)), cancel);
        uploadsBox.appendChild(item);
        const fd = new FormData();
        fd.append('file', f, f.name);
        if (i === 0 && caption) fd.append('body', caption);
        if (cs.reply && i === 0) { fd.append('reply_to_id', cs.reply.id); cs.reply = null; drawBars(); }
        Object.keys(extra || {}).forEach((k) => fd.append(k, extra[k]));
        try {
          const r = await TC.api('/chats/' + chatId + '/messages', { method: 'POST', form: fd, ref, onProgress: (p) => { bar.style.width = Math.round(p * 100) + '%'; } });
          TC.addMessage(r.message);
        } catch (e) { if (e.code !== 'cancelled') TC.fail(e); }
        item.remove();
      }
    }

    /* ---- voice notes ---- */
    let rec = null;
    async function startRecording() {
      if (!TC.can('voice_notes')) return;
      if (!navigator.mediaDevices || !window.MediaRecorder) { TC.toast(t('chat.micUnsupported'), 'error'); return; }
      let stream;
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) { TC.toast(t('chat.micDenied'), 'error'); return; }
      const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
      const mime = types.find((x) => MediaRecorder.isTypeSupported(x)) || '';
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks = []; const t0 = Date.now();
      mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      const timer = h('span', { class: 'rec-time' }, '0:00');
      const iv = setInterval(() => { timer.textContent = TC.fmtDuration((Date.now() - t0) / 1000); }, 500);
      const finish = (send) => {
        clearInterval(iv); stream.getTracks().forEach((x) => x.stop());
        rec.bar.remove(); composerRow.classList.remove('hidden');
        const dur = (Date.now() - t0) / 1000; rec = null;
        if (!send) return;
        mr.onstop = () => {
          const type = mr.mimeType || 'audio/webm';
          const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
          uploadFiles([new File([new Blob(chunks, { type })], 'voice-' + Date.now() + '.' + ext, { type })], '', { hint: 'voice', duration: Math.round(dur) });
        };
        try { mr.stop(); } catch (_) { /* ignore */ }
      };
      const bar = h('div', { class: 'rec-bar' }, h('button', { class: 'icon-btn danger', title: t('common.cancel'), onclick: () => { mr.onstop = null; try { mr.stop(); } catch (_) { /* ignore */ } finish(false); } }, ic('trash', 22)), h('i', { class: 'rec-dot' }), timer, h('span', { class: 'grow muted small' }, t('chat.recording')), h('button', { class: 'send-btn', title: t('common.send'), onclick: () => finish(true) }, ic('send', 22)));
      rec = { bar };
      composerRow.classList.add('hidden');
      composer.appendChild(bar);
      mr.start();
    }

    /* ---- in-chat search ---- */
    function openSearch() {
      const box = h('div', { class: 'chat-search' });
      const inp = h('input', { class: 'input', type: 'search', placeholder: t('chat.searchIn') });
      const res = h('div', { class: 'cs-results' });
      const close = () => { box.remove(); };
      box.append(h('div', { class: 'row gap-s cs-head' }, h('button', { class: 'icon-btn', onclick: close }, ic('back', 20)), inp), res);
      inp.addEventListener('input', TC.debounce(async () => {
        const q = inp.value.trim(); res.replaceChildren();
        if (q.length < 2) return;
        try {
          const r = await TC.api('/search?chat_id=' + chatId + '&q=' + encodeURIComponent(q));
          if (!r.messages.length) res.appendChild(h('div', { class: 'empty-small' }, t('common.noResults')));
          r.messages.forEach((m) => res.appendChild(h('button', { class: 'cs-item', onclick: () => { close(); jumpTo(m.id); } }, h('div', { class: 'row between' }, h('span', { class: 'strong small' }, m.sender_name), h('span', { class: 'muted small' }, TC.fmtDateTime(m.created_at))), h('div', { class: 'ellipsis' }, m.body || m.file.name))));
        } catch (e) { TC.fail(e); }
      }, 300));
      root.appendChild(box); inp.focus();
    }

    /* ---- info drawer ---- */
    function openInfo(id) { TC.openChatInfo(id); }

    /* ---- assemble ---- */
    root.replaceChildren(h('div', { class: 'conversation' }, header, msgWrap, composer));
    root.appendChild(h('div', { class: 'drop-hint' }, ic('upload', 32), t('chat.dropHere')));
    drawHeader(); drawBars(); autoGrow();

    // events
    TC.on('chat_changed', (id) => { if (id === chatId) drawHeader(); });
    TC.on('chats', () => { drawHeader(); });
    TC.on('presence', drawHeader);
    TC.on('typing', (id) => { if (id === chatId) drawHeader(); });
    TC.on('features', () => { composerGate(); syncSendIcon(); });
    TC.on('me', () => { composerGate(); syncSendIcon(); });
    TC.on('receipts', (id) => {
      if (id !== chatId) return;
      const s = TC.slot(chatId); if (!s) return;
      s.list.forEach((m) => { if (m.sender_id === S.me.id && !m.deleted) { const el = msgBox.querySelector('[data-tick="' + m.id + '"]'); if (el) el.replaceWith(tickEl(m)); } });
    });
    TC.on('message', (m) => {
      if (m.chat_id !== chatId) return;
      if (nodes[m.id]) return;
      const wasBottom = cs.atBottom;
      appendRow(m);
      if (m.sender_id === S.me.id || wasBottom) scrollBottom(false);
      else { cs.newCount++; fab.classList.remove('hidden'); fab.querySelector('.fab-n').textContent = cs.newCount; }
    });
    TC.on('message_update', (m) => { if (m.chat_id === chatId) { const s = TC.slot(chatId); const cur = s && s.list.find((x) => x.id === m.id); replaceRow(cur || m); } });
    TC.on('message_hidden', (p) => { if (p.chat_id === chatId) renderAll(true); });
    TC.on('poll', (p) => { if (p.chat_id === chatId) { const m = findMsg(p.message_id); if (m) { m.poll = p.poll; replaceRow(m); } } });
    TC.on('reactions', (p) => { if (p.chat_id === chatId) { const m = findMsg(p.message_id); if (m) replaceRow(m); } });
    TC.on('resync', (id) => { if (id === chatId) renderAll(true); });
    TC.on('chat_removed', (id) => { if (id === chatId) { TC.toast(t('chat.removed'), 'info'); location.hash = '#/chats'; } });

    TC.ensureMessages(chatId).then(() => { renderAll(false); TC.markRead(chatId); }).catch((e) => { TC.fail(e); msgBox.appendChild(h('div', { class: 'empty-small' }, TC.errMsg(e))); });
  }

  /* ================= chat info drawer ================= */
  TC.openChatInfo = function (chatId) {
    const body = h('div', { class: 'drawer-body' });
    const back = h('div', { class: 'drawer-back' });
    const drawer = h('aside', { class: 'drawer', role: 'dialog' },
      h('div', { class: 'drawer-head' }, h('button', { class: 'icon-btn', onclick: () => close() }, ic('x', 22)), h('h3', null, t('chat.info'))), body);
    back.appendChild(drawer);
    back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
    document.body.appendChild(back);
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    let off1, off2, mediaTab = 'media';
    function close() { document.removeEventListener('keydown', onKey); if (off1) off1(); if (off2) off2(); back.remove(); }
    const done = (fn) => async () => { try { await fn(); } catch (e) { TC.fail(e); } };

    const draw = () => {
      const c = TC.chat(chatId);
      if (!c) { close(); return; }
      const amAdmin = c.kind === 'group' && (c.my.is_admin || TC.isAdmin());
      body.replaceChildren();
      // header
      const av = h('div', { class: 'info-avatar' }, TC.avatar(c.name, c.avatar, 96));
      if (amAdmin) {
        const f = h('input', { type: 'file', accept: 'image/*', class: 'hidden' });
        f.addEventListener('change', done(async () => { if (!f.files[0]) return; const fd = new FormData(); fd.append('file', f.files[0]); const r = await TC.api('/chats/' + chatId + '/avatar', { method: 'POST', form: fd }); TC.upsertChat(r.chat); }));
        av.append(f, h('button', { class: 'avatar-edit', title: t('settings.changePhoto'), onclick: () => f.click() }, ic('camera', 16)));
      }
      body.appendChild(h('div', { class: 'info-top' }, av, h('h2', null, c.name),
        c.kind === 'direct' && c.other ? h('div', { class: 'muted' }, [c.other.designation, c.other.department].filter(Boolean).join(' · ') || '@' + c.other.username) : h('div', { class: 'muted' }, t('group.membersN', { n: c.members.length })),
        c.kind === 'direct' && c.other && c.other.about ? h('div', { class: 'info-about' }, c.other.about) : null,
        c.kind === 'group' ? h('div', { class: 'info-about' }, c.description || t('group.noDesc')) : null,
        amAdmin ? h('button', { class: 'btn ghost small', onclick: () => editGroup(c) }, ic('edit', 16), t('group.edit')) : null));

      // toggles
      const setting = (k, v) => done(async () => { const r = await TC.api('/chats/' + chatId + '/settings', { method: 'POST', body: { [k]: v } }); TC.upsertChat(r.chat); });
      body.appendChild(h('div', { class: 'section' },
        switchRow(t('chat.mute'), c.my.muted, (v) => setting('muted', v)()),
        switchRow(t('chat.pin'), c.my.pinned, (v) => setting('pinned', v)()),
        c.is_support ? null : switchRow(t('chat.archive'), c.my.archived, (v) => setting('archived', v)()),
        amAdmin ? switchRow(t('group.onlyAdmins'), c.only_admins_post, done(async () => { const r = await TC.api('/chats/' + chatId, { method: 'PATCH', body: { only_admins_post: !c.only_admins_post } }); TC.upsertChat(r.chat); })) : null));

      // members
      if (c.kind === 'group') {
        const sec = h('div', { class: 'section' }, h('div', { class: 'section-title' }, t('group.members') + ' (' + c.members.length + ')'));
        if (amAdmin) sec.appendChild(h('button', { class: 'list-btn', onclick: done(async () => {
          const ids = await TC.pickUsers({ title: t('group.addMembers'), multi: true, exclude: c.members.map((m) => m.user.id) });
          if (!ids) return;
          const r = await TC.api('/chats/' + chatId + '/members', { method: 'POST', body: { user_ids: ids } }); TC.upsertChat(r.chat);
        }) }, h('span', { class: 'li-ic' }, ic('user-plus', 20)), t('group.addMembers')));
        c.members.forEach((m) => {
          const u = m.user;
          const row = h('div', { class: 'member-row' }, h('div', { class: 'avatar-wrap' }, TC.avatar(u.name, u.avatar, 40), TC.isOnline(u.id) ? h('i', { class: 'dot online' }) : null),
            h('div', { class: 'grow min0' }, h('div', { class: 'strong' }, u.id === S.me.id ? t('chat.you') : u.name), h('div', { class: 'muted small ellipsis' }, u.about)),
            m.is_admin ? h('span', { class: 'pill' }, t('group.admin')) : null);
          if (u.id !== S.me.id) {
            const actions = [];
            actions.push({ icon: 'chat', label: t('group.message'), onClick: () => { close(); TC.openDirect(u.id); } });
            if (amAdmin) {
              actions.push({ icon: 'shield', label: t(m.is_admin ? 'group.removeAdmin' : 'group.makeAdmin'), onClick: done(async () => { const r = await TC.api('/chats/' + chatId + '/members/' + u.id + '/admin', { method: 'POST', body: { is_admin: !m.is_admin } }); TC.upsertChat(r.chat); }) });
              actions.push({ icon: 'user-minus', label: t('group.remove'), danger: true, onClick: done(async () => { if (await TC.confirm(t('group.removeConfirm', { name: u.name }), { danger: true })) { await TC.api('/chats/' + chatId + '/members/' + u.id, { method: 'DELETE' }); const r = await TC.api('/chats/' + chatId); TC.upsertChat(r.chat); } }) });
            }
            row.appendChild(h('button', { class: 'icon-btn', onclick: (e) => TC.menu(e.currentTarget, actions, { alignRight: true }) }, ic('more', 18)));
          }
          sec.appendChild(row);
        });
        body.appendChild(sec);
      }

      // media
      const mediaBox = h('div', { class: 'media-grid' });
      const tabs = h('div', { class: 'tabs small' }, ['media', 'docs', 'links'].map((k) => h('button', { class: 'tab' + (mediaTab === k ? ' active' : ''), onclick: () => { mediaTab = k; draw(); } }, t('media.' + k))));
      body.appendChild(h('div', { class: 'section' }, h('div', { class: 'section-title' }, t('media.title')), tabs, mediaBox));
      TC.api('/chats/' + chatId + '/media?type=' + mediaTab).then((r) => {
        mediaBox.replaceChildren();
        if (!r.messages.length) { mediaBox.appendChild(h('div', { class: 'empty-small' }, t('media.empty'))); return; }
        if (mediaTab === 'media') { mediaBox.className = 'media-grid'; r.messages.forEach((m) => mediaBox.appendChild(h('a', { class: 'mg-item', href: m.file.url, target: '_blank', rel: 'noopener' }, m.kind === 'image' ? h('img', { src: m.file.url, loading: 'lazy', alt: '' }) : h('div', { class: 'mg-video' }, ic('play', 28))))); }
        else { mediaBox.className = 'media-list'; r.messages.forEach((m) => mediaBox.appendChild(mediaTab === 'docs'
          ? h('a', { class: 'doc-row', href: m.file.url, target: '_blank', rel: 'noopener' }, ic('file-text', 22), h('div', { class: 'grow min0' }, h('div', { class: 'file-name' }, m.file.name), h('div', { class: 'muted small' }, TC.fmtSize(m.file.size) + ' · ' + TC.fmtDate(m.created_at))), ic('download', 16))
          : h('div', { class: 'doc-row' }, ic('link', 20), h('div', { class: 'grow min0 ellipsis' }, TC.linkify(m.body))))); }
      }).catch(() => {});

      // actions
      const act = h('div', { class: 'section' });
      if (TC.can('export_chat')) act.appendChild(h('button', { class: 'list-btn', onclick: (e) => TC.menu(e.currentTarget, [
        { icon: 'file-text', label: t('export.txt'), onClick: () => exportChat(chatId, 'txt') },
        { icon: 'file', label: t('export.html'), onClick: () => exportChat(chatId, 'html') },
        { icon: 'layers', label: t('export.json'), onClick: () => exportChat(chatId, 'json') }]) }, h('span', { class: 'li-ic' }, ic('download', 20)), t('export.title')));
      act.appendChild(h('button', { class: 'list-btn danger', onclick: done(async () => { if (await TC.confirm(t('chat.clearConfirm'), { danger: true, okLabel: t('chat.clear') })) { const r = await TC.api('/chats/' + chatId + '/clear', { method: 'POST', body: {} }); delete S.msgs[chatId]; TC.upsertChat(r.chat); TC.resolve(); close(); } }) }, h('span', { class: 'li-ic' }, ic('trash', 20)), t('chat.clear')));
      if (c.kind === 'group') {
        act.appendChild(h('button', { class: 'list-btn danger', onclick: done(async () => { if (await TC.confirm(t('group.leaveConfirm'), { danger: true, okLabel: t('group.leave') })) { await TC.api('/chats/' + chatId + '/members/' + S.me.id, { method: 'DELETE' }); close(); } }) }, h('span', { class: 'li-ic' }, ic('logout', 20)), t('group.leave')));
        if (amAdmin) act.appendChild(h('button', { class: 'list-btn danger', onclick: done(async () => { if (await TC.confirm(t('group.deleteConfirm'), { danger: true, okLabel: t('common.delete') })) { await TC.api('/chats/' + chatId, { method: 'DELETE' }); close(); } }) }, h('span', { class: 'li-ic' }, ic('trash', 20)), t('group.delete')));
      }
      body.appendChild(act);
    };
    off1 = TC.on('chat_changed', (id) => { if (id === chatId) draw(); }, true);
    off2 = TC.on('presence', () => { /* keep simple */ }, true);
    draw();
  };

  function switchRow(label, value, onChange) {
    const cb = h('input', { type: 'checkbox', class: 'switch', checked: !!value });
    cb.addEventListener('change', () => onChange(cb.checked));
    return h('label', { class: 'switch-row' }, h('span', { class: 'grow' }, label), cb);
  }
  TC.switchRow = switchRow;

  function editGroup(c) {
    const name = h('input', { class: 'input', value: c.name, maxlength: '80' });
    const desc = h('textarea', { class: 'input', rows: '3', maxlength: '300' }, c.description || '');
    TC.modal({ title: t('group.edit'), body: [h('label', { class: 'label' }, t('group.name')), name, h('label', { class: 'label' }, t('group.description')), desc],
      actions: [{ label: t('common.cancel'), kind: 'ghost' }, { label: t('common.save'), kind: 'primary', onClick: async () => { const r = await TC.api('/chats/' + c.id, { method: 'PATCH', body: { name: name.value, description: desc.value } }); TC.upsertChat(r.chat); } }] });
  }

  async function exportChat(id, fmt) {
    try { const r = await TC.api('/chats/' + id + '/export?format=' + fmt, { blob: true }); TC.saveBlob(r.blob, r.filename); }
    catch (e) { TC.fail(e); }
  }
})();
