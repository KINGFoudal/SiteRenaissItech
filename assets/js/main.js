/* Renaissance iTech : interactions du site */
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
    const svcParam = new URLSearchParams(location.search).get('service');
    const svcSelect = $('[data-service]', booking);
    if (svcParam && [...svcSelect.options].some((o) => o.value === svcParam)) svcSelect.value = svcParam;
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
          telephone: form.tel.value.trim(), message: form.message.value.trim(), website: form.website.value, turnstile: tsJeton(form),
        });
        if (res.redirect) { location.href = res.redirect; return; }
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
        tsReset(form);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Confirmer →';
      }
    });

    renderCal();
    openFirstFreeDay();
    show(2);
  }

  /* ---------- Assistant IA (bulle présente sur toutes les pages) ---------- */
  const store = {
    get(k, d) { try { return JSON.parse(sessionStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage indisponible */ } },
  };
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Mise en forme légère des réponses : listes, liens vers les pages du site et emails
  const formatAnswer = (t) => {
    const lines = esc(t).split(/\n+/);
    let html = ''; let inList = false;
    for (const line of lines) {
      const item = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
      if (item) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${item[1]}</li>`; continue; }
      if (inList) { html += '</ul>'; inList = false; }
      if (line.trim()) html += `<p>${line}</p>`;
    }
    if (inList) html += '</ul>';
    return html
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])(\/(?:rendez-vous|contact|services|formations|boutique|blog|a-propos|espace-client)\b)/g, '$1<a href="$2">$2</a>')
      .replace(/([\w.+-]+@[\w-]+\.[\w.]+)/g, '<a href="mailto:$1">$1</a>');
  };

  if (!document.body.classList.contains('app-page')) {
    const widget = document.createElement('div');
    widget.className = 'assistant';
    widget.innerHTML = `
      <button class="assistant-fab" type="button" aria-expanded="false" aria-controls="assistant-panel" data-assistant-toggle>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/><path d="M8 9h8M8 13h5"/></svg>
        <span>Une question ?</span>
      </button>
      <section class="assistant-panel" id="assistant-panel" role="dialog" aria-label="Assistant Renaissance iTech" hidden>
        <header class="assistant-head">
          <span class="assistant-av" aria-hidden="true">IA</span>
          <div><strong>Assistant Renaissance iTech</strong><span class="online">En ligne · répond en quelques secondes</span></div>
          <button class="assistant-close" type="button" aria-label="Fermer l’assistant" data-assistant-toggle>×</button>
        </header>
        <div class="assistant-body" data-assistant-body aria-live="polite"></div>
        <div class="assistant-chips" data-assistant-chips>
          <button type="button">Qu’est-ce que l’IA privée ?</button>
          <button type="button">Quelles formations pour mon équipe IT ?</button>
          <button type="button">Comment démarrer un PoC ?</button>
        </div>
        <form class="assistant-form" data-assistant-form>
          <label class="sr-only" for="assistant-q">Votre question</label>
          <input class="input" id="assistant-q" maxlength="600" placeholder="Posez votre question…" autocomplete="off">
          <button class="send-btn" type="submit" aria-label="Envoyer"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg></button>
        </form>
        <p class="assistant-note">Réponses générées par IA, à titre indicatif. Ne partagez pas de données sensibles. <a href="/mentions-legales#confidentialite">Confidentialité</a></p>
      </section>`;
    document.body.append(widget);

    const panel = $('.assistant-panel', widget);
    const body = $('[data-assistant-body]', widget);
    const form = $('[data-assistant-form]', widget);
    const input = $('input', form);
    const chips = $('[data-assistant-chips]', widget);
    const conv = store.get('rit-assistant-id', null) || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
    store.set('rit-assistant-id', conv);
    let history = store.get('rit-assistant', []);

    const bubble = (role, html) => {
      const el = document.createElement('div');
      el.className = `assistant-msg ${role}`;
      el.innerHTML = html;
      body.append(el);
      body.scrollTop = body.scrollHeight;
      return el;
    };
    const renderAll = () => {
      body.innerHTML = '';
      bubble('bot', '<p>Bonjour ! Je suis l’assistant de Renaissance iTech. Posez-moi vos questions sur l’IA privée, nos services ou nos formations.</p>');
      history.forEach((m) => bubble(m.role === 'user' ? 'user' : 'bot', m.role === 'user' ? `<p>${esc(m.content)}</p>` : formatAnswer(m.content)));
      chips.hidden = history.length > 0;
    };
    const toggle = (open) => {
      panel.hidden = !open;
      widget.classList.toggle('is-open', open);
      $('.assistant-fab', widget).setAttribute('aria-expanded', String(open));
      if (open) { renderAll(); input.focus(); }
    };
    $$('[data-assistant-toggle]', widget).forEach((b) => b.addEventListener('click', () => toggle(panel.hidden)));
    addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) toggle(false); });

    const ask = async (q) => {
      if (!q) return;
      chips.hidden = true;
      history.push({ role: 'user', content: q });
      bubble('user', `<p>${esc(q)}</p>`);
      const typing = bubble('bot', '<span class="typing"><span></span><span></span><span></span></span>');
      form.querySelector('button').disabled = true;
      try {
        const res = await api('/api/assistant', { conversation: conv, messages: history.slice(-8), page: location.pathname });
        typing.innerHTML = formatAnswer(res.reponse);
        history.push({ role: 'assistant', content: res.reponse });
      } catch (err) {
        typing.innerHTML = `<p>${esc(netError(err))}</p>`;
        history.pop();
      } finally {
        form.querySelector('button').disabled = false;
        history = history.slice(-20);
        store.set('rit-assistant', history);
        body.scrollTop = body.scrollHeight;
      }
    };
    form.addEventListener('submit', (e) => { e.preventDefault(); const q = input.value.trim(); input.value = ''; ask(q); });
    chips.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) ask(b.textContent); });
    $$('[data-open-assistant]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); toggle(true); }));
  }


  /* ---------- Anti-robot Cloudflare Turnstile (actif si une clé est configurée) ---------- */
  const tsForms = $$('[data-turnstile]');
  let tsJeton = () => undefined;
  let tsReset = () => {};
  if (tsForms.length) {
    fetch('/api/config').then((r) => r.json()).then((c) => {
      if (!c.turnstile) return;
      window.ritTsOk = () => tsForms.forEach((el) => { el.hidden = false; el.dataset.widget = window.turnstile.render(el, { sitekey: c.turnstile, theme: 'light', language: 'fr' }); });
      const sc = document.createElement('script');
      sc.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=ritTsOk';
      sc.async = true;
      document.head.append(sc);
      tsJeton = (form) => { const el = $('[data-turnstile]', form); return el?.dataset.widget ? window.turnstile.getResponse(el.dataset.widget) : undefined; };
      tsReset = (form) => { const el = $('[data-turnstile]', form); if (el?.dataset.widget) window.turnstile.reset(el.dataset.widget); };
    }).catch(() => {});
  }

  /* ---------- Formulaire de contact ---------- */
  const contact = $('[data-contact-form]');
  if (contact) {
    // Pré-remplissage : /contact?sujet=... (services) ou ?produit=... (boutique)
    const params = new URLSearchParams(location.search);
    const produit = params.get('produit');
    const sujet = params.get('sujet');
    if (sujet && [...contact.elements.sujet.options].some((o) => o.value === sujet)) contact.elements.sujet.value = sujet;
    const programme = params.get('programme');
    if (programme) contact.elements.message.value = `Bonjour, nous souhaitons former nos équipes avec le programme « ${programme} ». Nombre de participants : \nDates souhaitées : \nContexte : `;
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
          nom: f.nom.value.trim(), email: f.email.value.trim(), sujet: f.sujet.value, message: f.message.value.trim(), website: f.website.value, turnstile: tsJeton(contact),
        });
        contact.reset();
        if (res.redirect) { location.href = res.redirect; return; }
        say(true, res.message);
      } catch (ex) {
        say(false, netError(ex));
        tsReset(contact);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Envoyer le message';
      }
    });
  }
  /* ---------- Rendez-vous confirmé : récapitulatif et ajout à l'agenda ---------- */
  const recap = $('[data-rdv-recap]');
  if (recap) {
    const q = new URLSearchParams(location.search);
    const service = q.get('service') || '', date = q.get('date') || '', heure = q.get('heure') || '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}$/.test(heure)) {
      const [y, m, d] = date.split('-').map(Number);
      const [h, mi] = heure.split(':').map(Number);
      const jour = new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
      recap.innerHTML = [['Service', service], ['Date', jour], ['Heure', `${heure} (heure de Paris)`], ['Durée', '30 minutes'], ['Lieu', 'Google Meet']]
        .filter(([, v]) => v).map(([k, v]) => `<div><span>${k}</span><strong>${esc(v)}</strong></div>`).join('');
      recap.hidden = false;
      // Heure locale de Paris vers UTC (gère l'heure d'été)
      const guess = Date.UTC(y, m - 1, d, h, mi);
      const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
        .formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
      const utc = new Date(guess - (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - guess));
      const end = new Date(utc.getTime() + 30 * 60000);
      const f = (dt) => dt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
      const title = `Rendez-vous Renaissance iTech${service ? ` (${service})` : ''}`;
      const details = 'Échange de 30 minutes en visioconférence. Le lien Google Meet vous est envoyé par email. Contact : contact@renaissance-itech.com, +33 7 75 70 08 67';
      const add = $('[data-cal-add]');
      $('[data-cal-google]', add).href = `https://calendar.google.com/calendar/render?${new URLSearchParams({ action: 'TEMPLATE', text: title, dates: `${f(utc)}/${f(end)}`, details, location: 'Google Meet' })}`;
      $('[data-cal-outlook]', add).href = `https://outlook.live.com/calendar/0/deeplink/compose?${new URLSearchParams({ subject: title, startdt: utc.toISOString(), enddt: end.toISOString(), body: details, location: 'Google Meet', path: '/calendar/action/compose', rru: 'addevent' })}`;
      const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Renaissance iTech//RDV//FR', 'BEGIN:VEVENT', `UID:${f(utc)}-${Math.random().toString(36).slice(2)}@renaissance-itech.com`,
        `DTSTAMP:${f(new Date())}`, `DTSTART:${f(utc)}`, `DTEND:${f(end)}`, `SUMMARY:${title}`, `DESCRIPTION:${details.replace(/,/g, '\\,')}`, 'LOCATION:Google Meet', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
      $('[data-cal-ics]', add).href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
      add.hidden = false;
    }
  }

  /* ---------- Désinscription de la newsletter ---------- */
  const unsub = $('[data-unsub]');
  if (unsub) {
    const msg = $('[data-unsub-msg]');
    const email = unsub.elements.email;
    const pre = new URLSearchParams(location.search).get('email');
    if (pre) email.value = pre;
    unsub.addEventListener('submit', async (e) => {
      e.preventDefault();
      const say = (ok, text) => { msg.hidden = false; msg.className = `form-msg ${ok ? 'ok' : 'err'}`; msg.textContent = text; };
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.value.trim())) return say(false, 'Merci d’indiquer un email valide.');
      const btn = $('button', unsub);
      btn.disabled = true;
      try {
        const res = await api('/api/newsletter/desinscription', { email: email.value.trim() });
        unsub.hidden = true;
        say(true, res.message);
      } catch (ex) {
        say(false, netError(ex));
      } finally {
        btn.disabled = false;
      }
    });
  }

  /* ---------- Services : un seul service affiché à la fois ---------- */
  const explorer = $('[data-svc-explorer]');
  if (explorer) {
    const items = $$('[data-svc]', explorer);
    const activate = (item) => items.forEach((it) => {
      const on = it === item;
      it.classList.toggle('is-active', on);
      $('.svc-tab', it).setAttribute('aria-expanded', String(on));
    });
    const hover = matchMedia('(hover: hover) and (min-width: 921px)');
    items.forEach((it) => {
      const tab = $('.svc-tab', it);
      tab.addEventListener('mouseenter', () => { if (hover.matches) activate(it); });
      tab.addEventListener('focus', () => activate(it));
      tab.addEventListener('click', () => {
        activate(it);
        if (!hover.matches) it.scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
    });
    const target = location.hash && document.getElementById(location.hash.slice(1));
    const fromHash = target && items.find((it) => it.contains(target));
    if (fromHash) { activate(fromHash); requestAnimationFrame(() => fromHash.scrollIntoView({ block: 'start' })); }
  }

  /* ---------- Accueil : démo animée de l'assistant IA privé ---------- */
  const demo = $('[data-ai-demo]');
  if (demo && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const SCENES = [
      { q: 'Quel délai de paiement prévoit notre contrat cadre ?', doc: 'contrat',
        a: 'D’après le contrat cadre 2025 (article 7.2), le paiement intervient à 45 jours fin de mois à compter de la date de facture.', src: 'Contrat_cadre_2025.pdf · p. 6' },
      { q: 'Qui valide un achat de plus de 5 000 € ?', doc: 'achats',
        a: 'La procédure achats (section 3) impose la validation du responsable de service puis de la direction financière, avec trois devis comparatifs.', src: 'Procédure_achats.docx · §3' },
      { q: 'Combien de jours de télétravail sont autorisés ?', doc: 'rh',
        a: 'Jusqu’à 2 jours par semaine, après accord du manager et signature de l’avenant au contrat de travail.', src: 'Note_RH_teletravail.pdf · p. 2' },
    ];
    const chat = $('[data-ai-chat]', demo);
    const input = $('.ai-input', demo);
    const typing = $('[data-ai-typing]', demo);
    const placeholder = typing.textContent;
    const fileIcon = $('.ai-src svg', demo)?.outerHTML || '';
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const el = (cls, html) => { const d = document.createElement('div'); d.className = cls; d.innerHTML = html; return d; };
    let visible = true;
    new IntersectionObserver(([en]) => { visible = en.isIntersecting; }).observe(demo);
    const whenVisible = async () => { while (!visible || document.hidden) await wait(400); };

    const play = async (s) => {
      await whenVisible();
      chat.replaceChildren();
      input.classList.add('is-typing');
      typing.textContent = '';
      for (const ch of s.q) { typing.textContent += ch; await wait(38); }
      await wait(450);
      input.classList.remove('is-typing');
      typing.textContent = placeholder;
      chat.append(el('ai-msg ai-q', `<span>${s.q}</span>`));
      const search = el('ai-search', '<i></i> Recherche dans vos documents…');
      chat.append(search);
      const li = $(`[data-doc="${s.doc}"]`, demo);
      await wait(700);
      li.classList.add('is-reading');
      await wait(1100);
      search.remove();
      const ans = el('ai-msg ai-a', '<span></span>');
      chat.append(ans);
      const span = $('span', ans);
      for (const w of s.a.split(' ')) { span.textContent += (span.textContent ? ' ' : '') + w; await wait(55); }
      ans.insertAdjacentHTML('beforeend', `<em class="ai-src">${fileIcon} ${s.src}</em>`);
      li.classList.remove('is-reading');
      await wait(4200);
    };
    (async () => {
      await wait(1200);
      for (let n = 0; ; n = (n + 1) % SCENES.length) await play(SCENES[n]);
    })();
  }

})();
