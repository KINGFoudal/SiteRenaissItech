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
  const esc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

  // Options communes : message clair (avec le code d'erreur Cloudflare) si la vérification ne peut pas s'afficher
  const tsOptions = (el, cle) => ({
    sitekey: cle, theme: 'light', language: 'fr', size: 'flexible',
    callback: () => { el.nextElementSibling?.matches('.ts-err') && el.nextElementSibling.remove(); },
    'error-callback': (code) => {
      let p = el.nextElementSibling;
      if (!p?.matches('.ts-err')) { p = document.createElement('p'); p.className = 'form-msg err ts-err'; el.after(p); }
      p.innerHTML = `La vérification anti-robot n’a pas pu aboutir (code ${String(code).replace(/[^\w-]/g, '')}). Un bloqueur ou un réglage de confidentialité de votre navigateur peut en être la cause. Vous pouvez aussi nous écrire à <a href="mailto:contact@renaissance-itech.com">contact@renaissance-itech.com</a> ou sur <a href="https://wa.me/33775700867" target="_blank" rel="noopener">WhatsApp</a>.`;
      return true;
    },
  });
  const tsForms = $$('[data-turnstile]');
  let tsJeton = () => undefined;
  let tsReset = () => {};
  if (tsForms.length) {
    fetch('/api/config').then((r) => r.json()).then((c) => {
      if (!c.turnstile) return;
      window.ritTsOk = () => tsForms.forEach((el) => { el.hidden = false; el.dataset.widget = window.turnstile.render(el, tsOptions(el, c.turnstile)); });
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

  /* ---------- Accueil : vidéo de présentation (muette, en boucle) ---------- */
  const video = $('.phone-screen video');
  if (video && matchMedia('(prefers-reduced-motion: reduce)').matches) {
    video.removeAttribute('autoplay');
    video.pause();
    video.controls = true;
  }


  /* ---------- Paiement : outils communs ---------- */
  const euros = (c) => `${(c / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
  const stock = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* navigation privée */ } },
  };

  /* ---------- Boutique : achat direct ou panier, paiement Stripe ---------- */
  const cartEl = $('[data-cart]');
  if (cartEl) {
    let catalogue = [];
    let panier = stock.get('rit-panier', []);
    const fab = $('[data-cart-open]');
    const save = () => { stock.set('rit-panier', panier); draw(); };
    const produit = (id) => catalogue.find((p) => p.id === id);

    const payer = async (lignes, btn) => {
      const err = $('[data-cart-err]');
      err.hidden = true;
      btn.disabled = true; const label = btn.textContent; btn.textContent = 'Redirection vers le paiement…';
      try {
        const res = await fetch('/api/boutique/commande', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lignes }) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.url) throw new Error(data.error || 'Le paiement n’a pas pu démarrer.');
        location.href = data.url;
      } catch (ex) {
        btn.disabled = false; btn.textContent = label;
        if (cartEl.hidden) toast(ex.message); else { err.textContent = ex.message; err.hidden = false; }
      }
    };

    const draw = () => {
      panier = panier.filter((l) => produit(l.id));
      const n = panier.reduce((t, l) => t + l.quantite, 0);
      fab.hidden = !n;
      $('[data-cart-count]').textContent = n;
      const total = panier.reduce((t, l) => t + l.quantite * produit(l.id).prix_ttc, 0);
      $('[data-cart-total]').textContent = euros(total);
      $('[data-cart-pay]').textContent = `Payer ${euros(total)}`;
      $('[data-cart-pay]').disabled = !n;
      $('[data-cart-list]').innerHTML = n ? panier.map((l) => {
        const p = produit(l.id);
        return `<li><div><strong>${esc(p.nom)}</strong><small>${euros(p.prix_ttc)} TTC</small></div>
          <div class="qty"><button type="button" data-qty="${esc(l.id)}" data-d="-1" aria-label="Retirer un">−</button><span>${l.quantite}</span><button type="button" data-qty="${esc(l.id)}" data-d="1" aria-label="Ajouter un">+</button></div></li>`;
      }).join('') : '<li class="empty-state">Votre panier est vide.</li>';
    };
    const ouvrir = (on) => { cartEl.hidden = !on; document.body.classList.toggle('no-scroll', on); if (on) $('[data-cart-pay]').focus(); };

    fetch('/api/boutique/catalogue').then((r) => r.json()).then((c) => {
      catalogue = c.produits || [];
      $('[data-cart-tva]').textContent = c.taux_tva ? `Dont TVA ${String(c.taux_tva).replace('.', ',')} %` : (c.mention_tva || '');
      catalogue.forEach((p) => {
        const card = $(`[data-produit="${CSS.escape(p.id)}"]`);
        if (!card) return;
        const ctas = $('.product-ctas', card);
        ctas.insertAdjacentHTML('beforebegin', `<p class="price"><strong>${euros(p.prix_ttc)}</strong> <small>TTC</small></p>`);
        ctas.innerHTML = `<button class="btn btn-primary btn-sm" type="button" data-buy="${esc(p.id)}">Acheter</button>
          <button class="btn btn-outline btn-sm" type="button" data-add="${esc(p.id)}">Ajouter au panier</button>
          <a class="link-arrow" href="/contact?produit=${encodeURIComponent(p.nom)}">Une question avant d’acheter ?</a>`;
      });
      draw();
    }).catch(() => {});

    document.addEventListener('click', (e) => {
      const buy = e.target.closest('[data-buy]');
      if (buy) return payer([{ id: buy.dataset.buy, quantite: 1 }], buy); // achat direct : 1 clic ici, 1 clic sur Stripe
      const add = e.target.closest('[data-add]');
      if (add) {
        const l = panier.find((x) => x.id === add.dataset.add);
        if (l) l.quantite = Math.min(10, l.quantite + 1); else panier.push({ id: add.dataset.add, quantite: 1 });
        save(); toast('Ajouté au panier'); return ouvrir(true);
      }
      const q = e.target.closest('[data-qty]');
      if (q) {
        const l = panier.find((x) => x.id === q.dataset.qty);
        l.quantite = Math.max(0, Math.min(10, l.quantite + Number(q.dataset.d)));
        panier = panier.filter((x) => x.quantite > 0); return save();
      }
      if (e.target.closest('[data-cart-open]')) return ouvrir(true);
      if (e.target.closest('[data-cart-close]')) return ouvrir(false);
      if (e.target.closest('[data-cart-pay]')) return payer(panier, e.target.closest('[data-cart-pay]'));
    });
    addEventListener('keydown', (e) => { if (e.key === 'Escape' && !cartEl.hidden) ouvrir(false); });
    if (new URLSearchParams(location.search).get('paiement') === 'annule') toast('Paiement annulé : votre panier est conservé.');
  }

  /* ---------- Factures et devis consultables par lien (email, espace client) ---------- */
  const frLong = (s) => new Date(`${s.slice(0, 10)}T12:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  // Mise en page commune : logo, émetteur, destinataire (avec ses coordonnées d'entreprise), lignes, totaux, mentions
  const documentCommercial = (doc, e, { kicker, dates, statut, libelleClient, notes = '' }) => {
    const taux = doc.taux_tva / 100;
    const adresseClient = [doc.client_adresse, [doc.client_cp, doc.client_ville].filter(Boolean).join(' '), doc.client_pays].filter(Boolean).map(esc).join('<br>');
    return `<header class="invoice-head">
        <div><div class="invoice-logo"><img src="/assets/img/logo-mark.svg" alt="" width="40" height="40"><span class="logo-text">Renaissance<span>iTech</span></span></div>${/^renaissance\s*itech$/i.test((e.raison_sociale || '').trim()) ? '' : `<strong class="invoice-brand">${esc(e.raison_sociale)}</strong>`}<p>${esc(e.adresse).replace(/\n/g, '<br>')}</p>${e.siret ? `<p>SIRET ${esc(e.siret)}</p>` : ''}${e.tva_intracom ? `<p>TVA ${esc(e.tva_intracom)}</p>` : ''}</div>
        <div class="invoice-meta"><span class="invoice-kicker">${esc(kicker)}</span><h1>${esc(doc.numero)}</h1>${dates.map((x) => `<p>${x}</p>`).join('')}${statut}</div>
      </header>
      <div class="invoice-client"><span>${esc(libelleClient)}</span><strong>${esc(doc.entreprise || doc.nom || '')}</strong>${doc.nom && doc.entreprise ? `<p>${esc(doc.nom)}</p>` : ''}${adresseClient ? `<p>${adresseClient}</p>` : ''}<p>${esc(doc.email)}</p>${doc.client_siret ? `<p>SIRET ${esc(doc.client_siret)}</p>` : ''}${doc.client_tva ? `<p>TVA ${esc(doc.client_tva)}</p>` : ''}</div>
      <p class="invoice-objet"><strong>Objet :</strong> ${esc(doc.objet)}</p>
      <div class="table-wrap"><table class="table"><thead><tr><th>Désignation</th><th>Qté</th><th>Prix unitaire HT</th><th>Total HT</th></tr></thead><tbody>
        ${doc.lignes.map((l) => `<tr><td>${esc(l.libelle)}</td><td>${+l.quantite}</td><td>${euros(l.prix_unitaire)}</td><td>${euros(l.quantite * l.prix_unitaire)}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="invoice-totals"><div><span>Total HT</span><strong>${euros(doc.montant_ht)}</strong></div>
        ${taux ? `<div><span>TVA ${String(taux).replace('.', ',')} %</span><strong>${euros(doc.montant_ttc - doc.montant_ht)}</strong></div>` : ''}
        <div class="grand"><span>Total TTC</span><strong>${euros(doc.montant_ttc)}</strong></div></div>
      ${!taux && e.mention_tva ? `<p class="invoice-note">${esc(e.mention_tva)}</p>` : ''}
      ${notes}`;
  };

  const factureEl = $('[data-facture]');
  if (factureEl) {
    const t = new URLSearchParams(location.search).get('t') || '';
    $('[data-print]')?.addEventListener('click', () => print());
    fetch(`/api/facture?t=${encodeURIComponent(t)}`).then(async (r) => {
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Facture introuvable.');
      const { facture: f, emetteur: e } = d;
      const statut = f.statut === 'payee' ? `<span class="status status-termine">Payée le ${frLong(f.payee_le)}</span>` : f.statut === 'annulee' ? '<span class="status status-annule">Annulée</span>' : `<span class="status status-nouveau">À régler avant le ${frLong(f.echeance)}</span>`;
      factureEl.innerHTML = documentCommercial(f, e, {
        kicker: f.type === 'acompte' ? 'Facture d’acompte' : 'Facture', libelleClient: 'Facturé à', statut,
        dates: [`Émise le ${frLong(f.emise_le)}`, `Échéance : ${frLong(f.echeance)}`],
        notes: `${e.iban && f.statut === 'a_payer' ? `<p class="invoice-note">Règlement par virement : IBAN ${esc(e.iban)}${e.bic ? ` · BIC ${esc(e.bic)}` : ''} · référence ${esc(f.numero)}</p>` : ''}
          ${e.conditions ? `<p class="invoice-note">${esc(e.conditions)}</p>` : ''}`,
      });
      document.title = `Facture ${f.numero} | Renaissance iTech`;
      $('[data-facture-actions]').hidden = false;
      if (d.paiement) { const b = $('[data-facture-payer]'); b.hidden = false; b.href = `/api/paiement/facture?t=${encodeURIComponent(t)}`; b.textContent = `Payer ${euros(f.montant_ttc)} par carte`; }
    }).catch((ex) => { factureEl.innerHTML = `<p class="form-msg err">${esc(ex.message)}</p>`; });
  }

  const devisEl = $('[data-devis]');
  if (devisEl) {
    const t = new URLSearchParams(location.search).get('t') || '';
    $('[data-print]')?.addEventListener('click', () => print());
    const zone = $('[data-devis-reponse]');
    const afficher = async () => {
      const r = await fetch(`/api/devis?t=${encodeURIComponent(t)}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Devis introuvable.');
      const { devis: v, emetteur: e } = d;
      const accepte = () => `<span class="status status-termine">Accepté le ${frLong(v.accepte_le)} par ${esc(v.accepte_par)}</span>`;
      const statut = ({
        envoye: () => `<span class="status status-nouveau">Valable jusqu’au ${frLong(v.valide_jusqu)}</span>`,
        accepte, facture: accepte,
        refuse: () => '<span class="status status-annule">Refusé</span>', expire: () => '<span class="status status-annule">Expiré</span>', annule: () => '<span class="status status-annule">Annulé</span>',
      }[v.statut] || (() => ''))();
      devisEl.innerHTML = documentCommercial(v, e, {
        kicker: 'Devis', libelleClient: 'Proposé à', statut,
        dates: [`Émis le ${frLong(v.emis_le)}`, `Valable jusqu’au ${frLong(v.valide_jusqu)}`],
        notes: `${v.acompte_pct ? `<p class="invoice-note"><strong>Acompte à la commande : ${+v.acompte_pct} %</strong>, soit ${euros(Math.round(v.montant_ttc * v.acompte_pct / 100))} TTC.</p>` : ''}
          ${v.conditions ? `<p class="invoice-note">${esc(v.conditions)}</p>` : ''}
          ${v.accepte_par ? `<p class="invoice-note sign">Bon pour accord · ${esc(v.accepte_par)} · ${frLong(v.accepte_le)}</p>` : ''}`,
      });
      document.title = `Devis ${v.numero} | Renaissance iTech`;
      $('[data-devis-actions]').hidden = false;
      if (v.statut === 'envoye') {
        zone.hidden = false;
        zone.innerHTML = `<h2>Votre réponse</h2>
          <form class="form-grid" data-devis-accepter>
            <div><label class="field-label" for="dv-nom">Vos nom et prénom</label><input class="input" id="dv-nom" name="nom" autocomplete="name" required value="${esc(v.nom || '')}"></div>
            <label class="consent consent-light"><input type="checkbox" name="accord" required> Bon pour accord : j’accepte ce devis de ${euros(v.montant_ttc)} TTC et ses conditions${v.acompte_pct ? `, avec un acompte de ${+v.acompte_pct} %` : ''}.</label>
            <p class="form-msg" data-devis-msg hidden></p>
            <div class="devis-boutons"><button class="btn btn-primary" type="submit">Accepter le devis</button><button class="btn btn-outline" type="button" data-devis-refus>Refuser</button></div>
          </form>`;
      } else if (d.acompte && !d.acompte.payee) {
        zone.hidden = false;
        zone.innerHTML = `<h2>Acompte</h2><p>Votre facture d’acompte de <strong>${euros(d.acompte.montant_ttc)}</strong> est prête.</p><div class="devis-boutons"><a class="btn btn-primary" href="${esc(d.acompte.lien)}">Voir et régler l’acompte</a></div>`;
      } else zone.hidden = true;
    };
    zone?.addEventListener('submit', async (ev) => {
      const f = ev.target.closest('[data-devis-accepter]');
      if (!f) return;
      ev.preventDefault();
      const msg = $('[data-devis-msg]', f);
      const btn = $('button[type=submit]', f); btn.disabled = true;
      try {
        const r = await fetch('/api/devis/accepter', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ t, nom: f.nom.value, accord: f.accord.checked }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || 'Une erreur est survenue.');
        // Acompte : direction le paiement sécurisé, sans étape de plus
        if (d.acompte?.paiement) { location.href = d.acompte.paiement; return; }
        await afficher();
        toast(d.message);
      } catch (ex) { msg.hidden = false; msg.className = 'form-msg err'; msg.textContent = ex.message; btn.disabled = false; }
    });
    zone?.addEventListener('click', async (ev) => {
      if (!ev.target.closest('[data-devis-refus]')) return;
      const raison = prompt('Pouvez-vous nous dire pourquoi ? (facultatif : budget, délai, besoin…)', '');
      if (raison === null) return;
      const r = await fetch('/api/devis/refuser', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ t, raison }) });
      const d = await r.json().catch(() => ({}));
      toast(d.message || d.error);
      await afficher();
    });
    afficher().catch((ex) => { devisEl.innerHTML = `<p class="form-msg err">${esc(ex.message)}</p>`; });
  }

  /* ---------- Confirmation de paiement (retour de Stripe) ---------- */
  const payEl = $('[data-paiement]');
  if (payEl) {
    const session = new URLSearchParams(location.search).get('session') || '';
    const titre = $('[data-paiement-titre]'), texte = $('[data-paiement-texte]');
    let essais = 0;
    const verifier = async () => {
      try {
        const r = await fetch(`/api/paiement/statut?session=${encodeURIComponent(session)}`);
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        if (d.statut === 'payee') {
          $('[data-paiement-eyebrow]').textContent = d.type === 'commande' ? `Commande ${d.reference}` : `Facture ${d.reference}`;
          titre.textContent = 'Merci, votre paiement est confirmé';
          texte.textContent = d.type === 'commande' ? 'Un email de confirmation et votre facture viennent de vous être envoyés. Nous vous contactons sous 24 h ouvrées pour planifier la prestation.' : 'Un reçu vient de vous être envoyé par email. Merci pour votre confiance.';
          const recap = $('[data-paiement-recap]');
          recap.innerHTML = `${(d.lignes || []).map((l) => `<div><span>${l.quantite} × ${esc(l.nom)}</span><strong>${euros(l.quantite * l.prix_ttc)}</strong></div>`).join('')}<div><span>Total payé</span><strong>${euros(d.montant)}</strong></div>`;
          recap.hidden = false;
          if (d.facture) { const b = $('[data-paiement-facture]'); b.href = d.facture; b.hidden = false; }
          return;
        }
        if (++essais < 10) return setTimeout(verifier, 2000);
        titre.textContent = 'Paiement en cours de confirmation';
        texte.textContent = 'Votre banque n’a pas encore confirmé le paiement. Vous recevrez un email dès qu’il sera validé. Aucun nouveau paiement n’est nécessaire.';
      } catch {
        titre.textContent = 'Paiement introuvable';
        texte.textContent = 'Si vous avez été débité, écrivez-nous à contact@renaissance-itech.com avec la date et le montant : nous vérifions immédiatement.';
      }
    };
    if (new URLSearchParams(location.search).get('erreur')) { titre.textContent = 'Lien de paiement invalide'; texte.textContent = 'Ce lien de facture n’existe pas ou a expiré. Contactez-nous à contact@renaissance-itech.com.'; }
    else verifier();
  }

})();
