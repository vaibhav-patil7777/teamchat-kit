(function () {
  'use strict';
  const TC = window.TC;
  const { h, ic, S } = TC;
  const t = (...a) => TC.t(...a);
  const BG = ['#128c7e', '#0a84c6', '#7048e8', '#d6336c', '#e8590c', '#2e7d32', '#364fc7', '#c92a2a'];

  TC.route('/status', (view) => {
    if (!TC.can('status')) { view.appendChild(h('div', { class: 'empty-state' }, h('p', { class: 'muted' }, t('err.feature_disabled')))); return; }
    const mineBox = h('div', { class: 'card status-mine' });
    const others = h('div', { class: 'status-list' });
    view.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, t('nav.status')), h('p', { class: 'muted' }, t('status.sub')))), mineBox,
      h('h3', { class: 'section-h' }, t('status.recent')), others);
    const photo = h('input', { type: 'file', accept: 'image/*,video/*', class: 'hidden' });
    photo.addEventListener('change', () => { const f = photo.files[0]; photo.value = ''; if (f) addPhoto(f, load); });
    view.appendChild(photo);

    let data = { mine: [], others: [] };
    const ring = (name, avatar, seen, size) => h('div', { class: 'status-ring' + (seen ? ' seen' : '') }, TC.avatar(name, avatar, size || 52));
    const draw = () => {
      mineBox.replaceChildren(
        h('div', { class: 'row gap-s' },
          h('div', { class: 'status-ring none', onclick: () => (data.mine.length ? openViewer([{ user: S.me, items: data.mine }], 0, load) : null), style: { cursor: data.mine.length ? 'pointer' : 'default' } }, TC.avatar(S.me.name, S.me.avatar, 52)),
          h('div', { class: 'grow' }, h('div', { class: 'strong' }, t('status.mine')), h('div', { class: 'muted small' }, data.mine.length ? t('status.nUpdates', { n: data.mine.length }) : t('status.tapToAdd'))),
          h('button', { class: 'btn ghost small', onclick: () => addText(load) }, ic('edit', 14), t('status.text')),
          h('button', { class: 'btn primary small', onclick: () => photo.click() }, ic('camera', 14), t('status.photo'))));
      others.replaceChildren();
      if (!data.others.length) { others.appendChild(h('div', { class: 'empty-small' }, ic('status', 30), t('status.noOthers'))); return; }
      data.others.forEach((g, i) => others.appendChild(h('button', { class: 'status-row', type: 'button', onclick: () => openViewer(data.others, i, load) },
        ring(g.user.name, g.user.avatar, g.all_seen),
        h('div', { class: 'grow' }, h('div', { class: 'strong' }, g.user.name), h('div', { class: 'muted small' }, TC.listTime(g.latest) + ' · ' + t('status.nUpdates', { n: g.items.length }))),
        g.all_seen ? null : h('span', { class: 'dot new' }))));
    };
    const load = async () => { try { data = await TC.api('/status'); draw(); } catch (e) { TC.fail(e); } };
    draw(); load();
  }, { name: 'status' });

  function addText(done) {
    let bg = BG[0];
    const ta = h('textarea', { class: 'input', rows: '5', maxlength: '700', placeholder: t('status.textPh') });
    const prev = h('div', { class: 'status-compose', style: { background: bg } });
    const sw = h('div', { class: 'swatches' });
    const drawSw = () => { sw.replaceChildren(...BG.map((c) => h('button', { type: 'button', class: 'swatch' + (c === bg ? ' active' : ''), style: { background: c }, onclick: () => { bg = c; prev.style.background = c; drawSw(); } }, c === bg ? ic('check', 14) : null))); };
    const upd = () => { prev.textContent = ta.value || t('status.textPh'); };
    ta.addEventListener('input', upd); upd(); drawSw();
    TC.modal({ title: t('status.add'), body: [prev, h('label', { class: 'label' }, t('status.color')), sw, h('label', { class: 'label' }, t('status.text')), ta],
      actions: [{ label: t('common.cancel'), kind: 'ghost' }, { label: t('status.post'), kind: 'primary', onClick: async () => {
        if (!ta.value.trim()) { TC.toast(t('admin.messageRequired'), 'error'); return false; }
        await TC.api('/status', { method: 'POST', body: { text: ta.value, bg } });
        TC.toast(t('status.posted'), 'success'); done();
      } }] });
  }

  function addPhoto(file, done) {
    const url = URL.createObjectURL(file);
    const media = file.type.startsWith('video/') ? h('video', { src: url, controls: true, class: 'status-prev' }) : h('img', { src: url, class: 'status-prev', alt: '' });
    const cap = h('input', { class: 'input', maxlength: '700', placeholder: t('status.captionPh') });
    TC.modal({ title: t('status.add'), body: [media, h('label', { class: 'label' }, t('chat.caption')), cap], onClose: () => URL.revokeObjectURL(url),
      actions: [{ label: t('common.cancel'), kind: 'ghost' }, { label: t('status.post'), kind: 'primary', onClick: async () => {
        const fd = new FormData(); fd.append('file', file, file.name); fd.append('text', cap.value);
        await TC.api('/status', { method: 'POST', form: fd });
        TC.toast(t('status.posted'), 'success'); done();
      } }] });
  }

  /* ================= full-screen viewer ================= */
  function openViewer(groups, gi, onClose) {
    let g = gi, i = 0, timer = null, started = 0;
    const own = () => groups[g].user.id === S.me.id;
    const bars = h('div', { class: 'sv-bars' });
    const head = h('div', { class: 'sv-head' });
    const stage = h('div', { class: 'sv-stage' });
    const foot = h('div', { class: 'sv-foot' });
    const root = h('div', { class: 'status-viewer', role: 'dialog' }, bars, head, stage, foot,
      h('button', { class: 'sv-nav prev', 'aria-label': 'Previous', onclick: (e) => { e.stopPropagation(); prev(); } }),
      h('button', { class: 'sv-nav next', 'aria-label': 'Next', onclick: (e) => { e.stopPropagation(); next(); } }));
    const onKey = (e) => { if (e.key === 'Escape') close(); else if (e.key === 'ArrowRight') next(); else if (e.key === 'ArrowLeft') prev(); };
    function close() { clearTimeout(timer); document.removeEventListener('keydown', onKey); root.remove(); if (onClose) onClose(); }
    function next() { if (i < groups[g].items.length - 1) { i++; show(); } else if (g < groups.length - 1) { g++; i = 0; show(); } else close(); }
    function prev() { if (i > 0) { i--; show(); } else if (g > 0) { g--; i = groups[g].items.length - 1; show(); } else show(); }

    function show() {
      clearTimeout(timer);
      const grp = groups[g], it = grp.items[i];
      bars.replaceChildren(...grp.items.map((_, k) => h('i', { class: 'sv-bar' + (k < i ? ' done' : '') }, h('b', { class: k === i ? 'run' : '' }))));
      head.replaceChildren(TC.avatar(grp.user.name, grp.user.avatar, 40), h('div', { class: 'grow' }, h('div', { class: 'strong' }, own() ? t('status.mine') : grp.user.name), h('div', { class: 'small' }, TC.fmtTime(it.created_at))),
        own() ? h('button', { class: 'icon-btn light', title: t('status.delete'), onclick: async () => {
          if (!(await TC.confirm(t('status.deleteConfirm'), { danger: true }))) return;
          try { await TC.api('/status/' + it.id, { method: 'DELETE' }); grp.items.splice(i, 1); if (!grp.items.length) close(); else { i = Math.min(i, grp.items.length - 1); show(); } } catch (e) { TC.fail(e); }
        } }, ic('trash', 22)) : null,
        h('button', { class: 'icon-btn light', title: t('common.close'), onclick: close }, ic('x', 24)));
      stage.replaceChildren(); foot.replaceChildren();
      let dur = 5000;
      if (it.kind === 'text') { stage.style.background = it.bg || BG[0]; stage.appendChild(h('div', { class: 'sv-text' }, it.text)); }
      else {
        stage.style.background = '#000';
        if (it.kind === 'image') stage.appendChild(h('img', { src: it.file, alt: '' }));
        else {
          const v = h('video', { src: it.file, autoplay: true, playsinline: true, controls: false });
          v.addEventListener('ended', next);
          v.addEventListener('loadedmetadata', () => { dur = 0; });
          stage.appendChild(v); dur = 0;
        }
        if (it.text) foot.appendChild(h('div', { class: 'sv-caption' }, it.text));
      }
      if (own()) foot.appendChild(h('button', { class: 'sv-views', onclick: async () => {
        clearTimeout(timer);
        try { const r = await TC.api('/status/' + it.id + '/viewers'); viewersModal(r.viewers, show); } catch (e) { TC.fail(e); }
      } }, ic('eye', 16), t('status.views', { n: it.views || 0 })));
      else if (!it.seen) { it.seen = true; TC.api('/status/' + it.id + '/view', { method: 'POST', body: {}, noRedirect: true }).catch(() => {}); }
      const run = bars.querySelector('b.run');
      if (dur && run) { run.style.animation = 'svrun ' + dur + 'ms linear forwards'; timer = setTimeout(next, dur); }
      else if (run) run.style.width = '100%';
      started = Date.now();
    }
    document.addEventListener('keydown', onKey);
    document.body.appendChild(root);
    show();
  }

  function viewersModal(list, after) {
    TC.modal({ title: t('status.viewers'), onClose: after,
      body: list.length ? h('div', { class: 'picker-list' }, list.map((v) => h('div', { class: 'member-row' }, TC.avatar(v.user.name, v.user.avatar, 38), h('div', { class: 'grow' }, h('div', { class: 'strong' }, v.user.name), h('div', { class: 'muted small' }, TC.fmtDateTime(v.at)))))) : h('div', { class: 'empty-small' }, t('status.noViews')) });
  }
})();
