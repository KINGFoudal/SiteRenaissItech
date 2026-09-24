/* Renaissance iTech — interactions du site */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  const toastEl = $('[data-toast]');
  let toastTimer;
  const toast = (msg) => {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
  };

  $$('[data-year]').forEach((el) => { el.textContent = new Date().getFullYear(); });

  /* ---------- Menu mobile ---------- */
  const burger = $('[data-burger]');
  const nav = $('#nav');
  if (burger && nav) {
    burger.addEventListener('click', () => {
      const open = nav.classList.toggle('is-open');
      burger.setAttribute('aria-expanded', String(open));
    });
  }

  /* ---------- Filtres et recherche (boutique, formations, blog) ---------- */
  $$('[data-filter]').forEach((bar) => {
    const items = $$(bar.dataset.filter);
    const empty = $('[data-empty]');
    const search = $('[data-blog-search]');
    let cat = 'all';
    const apply = () => {
      const q = (search?.value || '').trim().toLowerCase();
      let shown = 0;
      items.forEach((it) => {
        const ok = (cat === 'all' || it.dataset.cat === cat) && (!q || (it.dataset.search || '').includes(q));
        it.hidden = !ok;
        if (ok) shown++;
      });
      if (empty) empty.hidden = shown > 0;
    };
    bar.addEventListener('click', (e) => {
      const btn = e.target.closest('.pill');
      if (!btn) return;
      $$('.pill', bar).forEach((p) => p.classList.toggle('is-active', p === btn));
      cat = btn.dataset.cat;
      apply();
    });
    search?.addEventListener('input', apply);
  });

  /* ---------- Newsletter ---------- */
  const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  $$('[data-newsletter]').forEach((form) => {
    const msg = $('[data-nl-msg]', form);
    const say = (ok, text) => { msg.hidden = false; msg.className = `form-msg ${ok ? 'ok' : 'err'}`; msg.textContent = text; };
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = form.email.value.trim();
      if (!EMAIL_RE.test(email)) return say(false, 'Merci d’indiquer un email valide.');
      if (!form.consent.checked) return say(false, 'Merci de cocher la case de consentement.');
      const btn = $('button[type=submit]', form);
      btn.disabled = true;
      try {
        const res = await fetch('/api/newsletter', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, consent: true, website: form.website.value, source: form.dataset.source || '' }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Inscription impossible pour le moment.');
        say(true, data.message || 'Merci ! Vérifiez votre boîte mail pour confirmer votre inscription.');
        form.reset();
      } catch (err) {
        say(false, err.message === 'Failed to fetch' ? 'Connexion impossible. Réessayez dans un instant.' : err.message);
      } finally {
        btn.disabled = false;
      }
    });
  });

  if (new URLSearchParams(location.search).get('newsletter') === 'confirmee') {
    setTimeout(() => toast('Inscription confirmée, bienvenue dans la newsletter !'), 400);
  }

  /* ---------- Article : progression, sommaire, partage ---------- */
  const bar = $('[data-read-progress]');
  const prose = $('.prose');
  if (bar && prose) {
    const tocLinks = $$('[data-toc-link]');
    const heads = tocLinks.map((l) => document.getElementById(l.getAttribute('href').slice(1))).filter(Boolean);
    let ticking = false;
    const update = () => {
      ticking = false;
      const r = prose.getBoundingClientRect();
      const total = r.height - innerHeight * 0.6;
      bar.style.width = `${Math.min(100, Math.max(0, (-r.top / Math.max(total, 1)) * 100))}%`;
      let current = heads[0];
      heads.forEach((h) => { if (h.getBoundingClientRect().top < 140) current = h; });
      tocLinks.forEach((l) => l.classList.toggle('is-active', current && l.getAttribute('href') === `#${current.id}`));
    };
    addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    update();
  }
  $$('[data-copy-link]').forEach((btn) => btn.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(btn.dataset.copyLink); toast('Lien copié'); } catch { toast(btn.dataset.copyLink); }
  }));

  /* ---------- Appels à l'API du site ---------- */
  const api = async (path, body) => {
    const res = await fetch(path, body ? {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    } : undefined);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'Une erreur est survenue. Réessayez dans un instant.');
      err.status = res.status;
      throw err;
    }
    return data;
  };
  const netError = (err) => (err instanceof TypeError ? 'Connexion impossible. Vérifiez votre connexion et réessayez.' : err.message);

  /* ---------- Prise de rendez-vous ---------- */
  const booking = $('[data-booking]');
  if (booking) {
    const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
    const DOW = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const state = { view: new Date(today.getFullYear(), today.getMonth(), 1), date: null, slot: null };
    const grid = $('[data-cal-grid]', booking);
    const title = $('[data-cal-title]', booking);
    const prevBtn = $('[data-cal-prev]', booking);
    const slots = $$('.slot', booking);
    const slotsInfo = $('[data-slots-info]', booking);
    const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    // Premier jour ouvré, sélectionné par défaut
    const firstOpen = new Date(today);
    while ([0, 6].includes(firstOpen.getDay())) firstOpen.setDate(firstOpen.getDate() + 1);
    state.date = firstOpen;
    if (firstOpen.getMonth() !== today.getMonth()) state.view = new Date(firstOpen.getFullYear(), firstOpen.getMonth(), 1);

    const sameDay = (a, b) => a && b && a.getTime() === b.getTime();
    const renderCal = () => {
      const y = state.view.getFullYear(), m = state.view.getMonth();
      title.textContent = `${MONTHS[m]} ${y}`;
      prevBtn.disabled = y === today.getFullYear() && m === today.getMonth();
      prevBtn.style.visibility = prevBtn.disabled ? 'hidden' : 'visible';
      const offset = (new Date(y, m, 1).getDay() + 6) % 7;
      const days = new Date(y, m + 1, 0).getDate();
      let html = DOW.map((d) => `<span class="cal-dow">${d}</span>`).join('');
      html += '<span></span>'.repeat(offset);
      for (let d = 1; d <= days; d++) {
        const dt = new Date(y, m, d);
        const closed = dt < today || [0, 6].includes(dt.getDay());
        const cls = ['cal-day', sameDay(dt, today) && 'is-today', sameDay(dt, state.date) && 'is-selected'].filter(Boolean).join(' ');
        html += `<button type="button" class="${cls}" data-day="${d}"${closed ? ' disabled' : ''} aria-label="${d} ${MONTHS[m]} ${y}"${sameDay(dt, state.date) ? ' aria-pressed="true"' : ''}>${d}</button>`;
      }
      grid.innerHTML = html;
    };

    const pickSlot = (s) => {
      state.slot = s ? s.textContent : null;
      slots.forEach((x) => { x.classList.toggle('is-selected', x === s); x.setAttribute('aria-pressed', String(x === s)); });
    };
    // Grise les créneaux déjà réservés (ou passés) pour la date choisie
    let slotsReq = 0;
    const loadSlots = async () => {
      const req = ++slotsReq;
      slots.forEach((s) => { s.disabled = true; });
      let pris = [];
      try { pris = (await api(`/api/creneaux?date=${ymd(state.date)}`)).pris || []; } catch { /* API indisponible : tous les créneaux restent proposés */ }
      if (req !== slotsReq) return;
      slots.forEach((s) => { s.disabled = pris.includes(s.textContent); });
      const free = slots.filter((s) => !s.disabled);
      if (!free.some((s) => s.textContent === state.slot)) pickSlot(free[0] || null);
      if (slotsInfo) slotsInfo.hidden = free.length > 0;
      return free.length;
    };
    // À l'ouverture : si le jour proposé est complet (ou déjà passé), on avance au prochain jour disponible
    const openFirstFreeDay = async () => {
      for (let i = 0; i < 15 && !(await loadSlots()); i++) {
        const next = new Date(state.date);
        do next.setDate(next.getDate() + 1); while ([0, 6].includes(next.getDay()));
        state.date = next;
        state.view = new Date(next.getFullYear(), next.getMonth(), 1);
        renderCal();
      }
    };

    grid.addEventListener('click', (e) => {
      const b = e.target.closest('[data-day]');
      if (!b || b.disabled) return;
      state.date = new Date(state.view.getFullYear(), state.view.getMonth(), +b.dataset.day);
      renderCal();
      loadSlots();
    });
    prevBtn.addEventListener('click', () => { state.view.setMonth(state.view.getMonth() - 1); renderCal(); });
    $('[data-cal-next]', booking).addEventListener('click', () => { state.view.setMonth(state.view.getMonth() + 1); renderCal(); });
    slots.forEach((s) => s.addEventListener('click', () => { if (!s.disabled) pickSlot(s); }));

    // L'étape 1 (service) est intégrée à l'écran « Date & heure », comme sur la maquette
    const show = (n) => {
      $$('[data-step]', booking).forEach((el) => { el.hidden = +el.dataset.step !== n; });
      $$('[data-step-ind]', booking).forEach((el) => {
        const k = +el.dataset.stepInd;
        el.classList.toggle('is-done', k < n || (n === 4 && k === 4));
        el.classList.toggle('is-current', k === n && n !== 4);
      });
      booking.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };
    const fmtDate = (d) => d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    $('[data-next]', booking).addEventListener('click', () => {
      if (!state.date || !state.slot) return toast('Choisissez une date et un créneau disponible.');
      show(3);
    });
    $('[data-back]', booking).addEventListener('click', () => show(2));
    $('[data-restart]', booking).addEventListener('click', () => { $('form', booking).reset(); show(2); loadSlots(); });

    const form = $('form[data-step="3"]', booking);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('[data-err]', form);
      const fail = (msg) => { err.textContent = msg; err.hidden = false; };
      const nom = form.nom.value.trim(), email = form.email.value.trim();
      if (nom.length < 2 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail('Merci de renseigner votre nom et un email valide.');
      err.hidden = true;
      const service = $('[data-service]', booking).value;
      const btn = $('button[type=submit]', form);
      btn.disabled = true;
      btn.textContent = 'Envoi…';
      try {
        const res = await api('/api/rendez-vous', {
          service, date: ymd(state.date), heure: state.slot, nom, email,
          telephone: form.tel.value.trim(), message: form.message.value.trim(), website: form.website.value,
        });
        $('[data-confirm-msg]', booking).textContent = res.message;
        $('[data-recap]', booking).replaceChildren(...[
          ['Service', service],
          ['Date', fmtDate(state.date)],
          ['Heure', `${state.slot} (heure de Paris, 30 min)`],
          ['Email', email],
        ].map(([k, v]) => {
          const row = document.createElement('div');
          const label = document.createElement('span');
          const value = document.createElement('strong');
          label.textContent = k;
          value.textContent = v;
          row.append(label, value);
          return row;
        }));
        show(4);
      } catch (ex) {
        if (ex.status === 409) { show(2); loadSlots(); toast(ex.message); } else fail(netError(ex));
      } finally {
        btn.disabled = false;
        btn.textContent = 'Confirmer →';
      }
    });

    renderCal();
    openFirstFreeDay();
    show(2);
  }

  /* ---------- Espace client : connexion, démonstration ---------- */
  const loginScreen = $('[data-login]');
  if (loginScreen) {
    const demo = new URLSearchParams(location.search).has('demo');
    loginScreen.hidden = demo;
    $('[data-app]').hidden = !demo;
    $('[data-login-form]').addEventListener('submit', (e) => {
      e.preventDefault();
      const msg = $('[data-login-msg]');
      msg.hidden = false;
      msg.textContent = 'Identifiants non reconnus. Vos accès vous sont envoyés au lancement de votre projet. Besoin d’aide ? contact@renaissance-itech.com';
    });
  }

  /* ---------- Espace client ---------- */
  const views = $$('[data-view]');
  if (views.length) {
    const titleEl = $('[data-view-title]');
    const sidebar = $('[data-sidebar]');
    const links = $$('.side-nav [data-view-link]');
    const open = (key) => {
      if (!views.some((v) => v.dataset.view === key)) key = 'dashboard';
      views.forEach((v) => { v.hidden = v.dataset.view !== key; });
      links.forEach((l) => l.classList.toggle('is-active', l.dataset.viewLink === key));
      const active = links.find((l) => l.dataset.viewLink === key);
      if (active && titleEl) titleEl.textContent = active.textContent.trim();
      sidebar?.classList.remove('is-open');
    };
    window.addEventListener('hashchange', () => open(location.hash.slice(1)));
    open(location.hash.slice(1));
    $('[data-app-burger]')?.addEventListener('click', () => sidebar.classList.toggle('is-open'));
  }
  $$('[data-demo-form]').forEach((f) => f.addEventListener('submit', (e) => { e.preventDefault(); toast('Modifications enregistrées'); }));

  /* ---------- Tuteur IA (démo) ---------- */
  const chatForm = $('[data-chat-form]');
  if (chatForm) {
    const body = $('[data-chat-body]');
    const input = $('input', chatForm);
    const add = (who, text) => {
      const msg = document.createElement('div');
      msg.className = `msg ${who}`;
      if (who === 'bot') msg.innerHTML = '<img class="bot-av" src="assets/img/bot.svg" alt="">';
      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      bubble.textContent = text;
      msg.append(bubble);
      body.append(msg);
      body.scrollTop = body.scrollHeight;
      return bubble;
    };
    chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = input.value.trim();
      if (!q) return;
      input.value = '';
      add('user', q);
      const typing = add('bot', '');
      typing.innerHTML = '<span class="typing"><span></span><span></span><span></span></span>';
      setTimeout(() => {
        typing.textContent = 'Bonne question ! Le tuteur IA sera bientôt connecté pour vous répondre en détail. En attendant, consultez les ressources recommandées à droite.';
        body.scrollTop = body.scrollHeight;
      }, 900);
    });
    body.scrollTop = body.scrollHeight;
  }

  /* ---------- Formulaire de contact ---------- */
  const contact = $('[data-contact-form]');
  if (contact) {
    // Pré-remplissage depuis la boutique : contact.html?produit=...
    const produit = new URLSearchParams(location.search).get('produit');
    if (produit) {
      contact.elements.sujet.value = 'Demande sur un produit';
      contact.elements.message.value = `Bonjour, je suis intéressé(e) par « ${produit} ». Pouvez-vous m’envoyer un devis ?`;
    }
    contact.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = $('[data-form-msg]', contact);
      const f = contact.elements;
      const say = (ok, text) => { msg.hidden = false; msg.className = `form-msg ${ok ? 'ok' : 'err'}`; msg.textContent = text; };
      const valid = f.nom.value.trim().length >= 2 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.value.trim()) && f.sujet.value && f.message.value.trim().length >= 10;
      if (!valid) return say(false, 'Merci de remplir tous les champs avec un email valide (message de 10 caractères minimum).');
      const btn = $('button[type=submit]', contact);
      btn.disabled = true;
      btn.textContent = 'Envoi…';
      try {
        const res = await api('/api/contact', {
          nom: f.nom.value.trim(), email: f.email.value.trim(), sujet: f.sujet.value, message: f.message.value.trim(), website: f.website.value,
        });
        say(true, res.message);
        contact.reset();
      } catch (ex) {
        say(false, netError(ex));
      } finally {
        btn.disabled = false;
        btn.textContent = 'Envoyer le message';
      }
    });
  }
})();
