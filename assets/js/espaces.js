/* Renaissance iTech : espace client, administration et page de connexion */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const h = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const toastEl = $('[data-toast]');
  let toastTimer;
  const toast = (msg) => {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2800);
  };

  const api = async (path, body) => {
    const res = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error || 'Une erreur est survenue.'); e.status = res.status; throw e; }
    return data;
  };

  /* ---------- Formats ---------- */
  const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  const fmtDay = (d) => { const [y, m, j] = d.split('-'); return `${+j} ${MOIS[+m - 1]} ${y}`; };
  const fmtSql = (s) => { // « AAAA-MM-JJ HH:MM:SS » en UTC
    if (!s) return '';
    const d = new Date(`${s.replace(' ', 'T')}Z`);
    return d.toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  };
  const STATUTS = { nouveau: 'Nouveau', en_cours: 'En cours', en_pause: 'En pause', termine: 'Terminé', annule: 'Annulé', confirme: 'Confirmé' };
  const badge = (s) => `<span class="status status-${h(s)}">${h(STATUTS[s] || s)}</span>`;
  const progress = (n) => `<div class="progress" role="progressbar" aria-valuenow="${+n}" aria-valuemin="0" aria-valuemax="100"><i style="width:${+n}%"></i></div>`;
  const initials = (s) => (s || '?').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((x) => x[0].toUpperCase()).join('');
  const empty = (txt) => `<p class="empty-state">${h(txt)}</p>`;
  const thread = (messages, espace) => (messages.length ? `<div class="thread">${messages.map((m) => {
    const moi = (espace === 'client') === (m.auteur === 'client');
    return `<div class="bubble-row ${moi ? 'me' : ''}"><div class="msg-bubble"><span class="msg-author">${m.auteur === 'client' ? 'Client' : 'Équipe Renaissance iTech'} · ${h(fmtSql(m.cree_le))}</span>${h(m.contenu).replace(/\n/g, '<br>')}</div></div>`;
  }).join('')}</div>` : empty('Aucun message pour le moment.'));

  /* ================================================================ Page de connexion (lien reçu par email) */
  const connexion = $('[data-connexion]');
  if (connexion) {
    const jeton = new URLSearchParams(location.search).get('jeton');
    const btn = $('[data-connexion-btn]');
    const msg = $('[data-connexion-msg]');
    if (!jeton) {
      $('[data-connexion-text]').textContent = 'Ce lien de connexion est incomplet. Demandez un nouveau lien depuis votre espace.';
      btn.hidden = true;
    }
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Connexion…';
      try {
        const res = await api('/api/auth/verifier', { jeton });
        location.replace(res.redirect);
      } catch (e) {
        msg.hidden = false; msg.className = 'form-msg err'; msg.textContent = e.message;
        btn.hidden = true;
      }
    });
    return;
  }

  const appEl = $('[data-app]');
  if (!appEl) return;
  const espace = appEl.dataset.espace;
  const root = $('[data-view-root]');
  const loginEl = $('[data-login]');
  const titleEl = $('[data-view-title]');
  const sidebar = $('[data-sidebar]');
  const links = $$('[data-view-link]');
  const modal = $('[data-modal]');
  let data = null;

  /* ---------- Connexion / déconnexion ---------- */
  $('[data-login-form]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const msg = $('[data-login-msg]');
    const btn = $('button', f);
    btn.disabled = true;
    try {
      const res = await api('/api/auth/lien', { email: f.email.value.trim(), espace: f.dataset.espace });
      msg.className = 'form-msg ok'; msg.textContent = res.message;
      f.email.value = '';
    } catch (err) {
      msg.className = 'form-msg err'; msg.textContent = err.message;
    } finally {
      msg.hidden = false; btn.disabled = false;
    }
  });
  $('[data-logout]').addEventListener('click', async () => {
    await api('/api/auth/deconnexion', {}).catch(() => {});
    location.reload();
  });
  $('[data-app-burger]').addEventListener('click', () => sidebar.classList.toggle('is-open'));
  $('[data-refresh]').addEventListener('click', () => load().then(render).then(() => toast('Données actualisées')));

  /* ---------- Fenêtre modale ---------- */
  const openModal = (html) => { $('[data-modal-body]').innerHTML = html; modal.hidden = false; $('input, select, textarea, button:not(.modal-x)', modal)?.focus(); };
  const closeModal = () => { modal.hidden = true; };
  $$('[data-modal-close]').forEach((b) => b.addEventListener('click', closeModal));
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) closeModal(); });

  /* ---------- Chargement ---------- */
  const cache = {};
  async function load() {
    if (espace === 'client') data = await api('/api/client/moi');
    else data = await api('/api/admin/resume');
    return data;
  }
  const adminList = async (key, path) => { cache[key] = await api(path); return cache[key]; };

  /* ================================================================ Vues espace client */
  const clientViews = {
    dashboard: { title: 'Tableau de bord', render() {
      const actifs = data.projets.filter((p) => ['nouveau', 'en_cours', 'en_pause'].includes(p.statut));
      const today = new Date().toISOString().slice(0, 10);
      const prochains = data.rendez_vous.filter((r) => r.statut === 'confirme' && r.date >= today).reverse();
      return `<div class="kpis">
          <div class="card kpi"><h3>Projets en cours</h3><strong>${actifs.length}</strong><span class="hot">sur ${data.projets.length} au total</span></div>
          <div class="card kpi"><h3>Prochain rendez-vous</h3><strong class="kpi-small">${prochains[0] ? h(fmtDay(prochains[0].date)) : 'Aucun'}</strong><span>${prochains[0] ? `${h(prochains[0].heure)} · Google Meet` : '<a class="link-arrow" href="/rendez-vous">Réserver un créneau</a>'}</span></div>
          <div class="card kpi"><h3>Nouveaux messages</h3><strong>${data.non_lus}</strong><span>de l’équipe</span></div>
          <div class="card kpi"><h3>Rendez-vous</h3><strong>${data.rendez_vous.length}</strong><span>au total</span></div>
        </div>
        <div class="panels">
          <div class="card panel"><h2>Mes projets</h2>${data.projets.length ? `<ul class="row-list">${data.projets.slice(0, 5).map((p) => `<li><div class="grow"><strong>${h(p.titre)}</strong>${progress(p.avancement)}</div>${badge(p.statut)}</li>`).join('')}</ul><a class="link-arrow" href="#projets">Voir mes projets</a>` : empty('Votre premier projet apparaîtra ici après votre rendez-vous.')}</div>
          <div class="card panel"><h2>Prochains rendez-vous</h2>${prochains.length ? `<ul class="row-list">${prochains.map((r) => `<li><div class="grow"><strong>${h(r.service)}</strong><small class="muted">${h(fmtDay(r.date))} à ${h(r.heure)} (heure de Paris)</small></div>${badge(r.statut)}</li>`).join('')}</ul>` : empty('Aucun rendez-vous à venir.')}<a class="link-arrow" href="/rendez-vous">Prendre un rendez-vous</a></div>
        </div>`;
    } },
    projets: { title: 'Mes projets', render() {
      if (!data.projets.length) return `<div class="card panel">${empty('Vous n’avez pas encore de projet. Réservez un appel pour démarrer.')}<a class="btn btn-primary" href="/rendez-vous">Prendre rendez-vous</a></div>`;
      return data.projets.map((p) => `<article class="card panel project-card">
          <div class="project-head"><div><h2>${h(p.titre)}</h2><small class="muted">Ouvert le ${h(fmtSql(p.cree_le))}${p.service ? ` · ${h(p.service)}` : ''}</small></div>${badge(p.statut)}</div>
          <div class="project-progress"><span>Avancement</span>${progress(p.avancement)}<b>${+p.avancement} %</b></div>
          <h3 class="thread-title">Échanges avec l’équipe</h3>
          ${thread(p.messages, 'client')}
          <form class="reply-form" data-reply="${p.id}"><label class="sr-only" for="r-${p.id}">Votre message</label><textarea class="textarea" id="r-${p.id}" name="contenu" rows="2" placeholder="Écrire à l’équipe…" required></textarea><button class="btn btn-primary btn-sm" type="submit">Envoyer</button></form>
        </article>`).join('');
    } },
    rdv: { title: 'Mes rendez-vous', render() {
      return `<div class="card panel table-wrap">${data.rendez_vous.length ? `<table class="table"><thead><tr><th>Date</th><th>Heure</th><th>Service</th><th>Statut</th></tr></thead><tbody>${data.rendez_vous.map((r) => `<tr><td>${h(fmtDay(r.date))}</td><td>${h(r.heure)}</td><td>${h(r.service)}</td><td>${badge(r.statut)}</td></tr>`).join('')}</tbody></table>` : empty('Aucun rendez-vous.')}<a class="link-arrow" href="/rendez-vous">Prendre un nouveau rendez-vous</a></div>`;
    } },
    messages: { title: 'Messages', render() {
      const withMsg = data.projets.filter((p) => p.messages.length);
      if (!withMsg.length) return `<div class="card panel">${empty('Aucun message pour le moment. Vos échanges avec l’équipe apparaîtront ici.')}</div>`;
      return withMsg.map((p) => `<div class="card panel"><h2>${h(p.titre)}</h2>${thread(p.messages, 'client')}<form class="reply-form" data-reply="${p.id}"><label class="sr-only" for="m-${p.id}">Votre message</label><textarea class="textarea" id="m-${p.id}" name="contenu" rows="2" placeholder="Répondre…" required></textarea><button class="btn btn-primary btn-sm" type="submit">Envoyer</button></form></div>`).join('');
    } },
    parametres: { title: 'Mon compte', render() {
      const c = data.client;
      return `<form class="card panel settings-form" data-profil>
          <h2>Mes informations</h2>
          <div class="form-grid">
            <div><label class="field-label" for="p-email">Email (identifiant)</label><input class="input" id="p-email" value="${h(c.email)}" disabled></div>
            <div class="two">
              <div><label class="field-label" for="p-nom">Nom complet</label><input class="input" id="p-nom" name="nom" value="${h(c.nom || '')}" autocomplete="name"></div>
              <div><label class="field-label" for="p-tel">Téléphone</label><input class="input" id="p-tel" name="telephone" value="${h(c.telephone || '')}" autocomplete="tel"></div>
            </div>
            <div><label class="field-label" for="p-ent">Entreprise</label><input class="input" id="p-ent" name="entreprise" value="${h(c.entreprise || '')}" autocomplete="organization"></div>
            <div><button class="btn btn-primary" type="submit">Enregistrer</button></div>
          </div>
          <p class="form-note">Client depuis le ${h(fmtSql(c.cree_le))}. Pour supprimer votre compte, écrivez à contact@renaissance-itech.com.</p>
        </form>`;
    } },
  };

  /* ================================================================ Vues administration */
  const rdvRow = (r) => `<tr><td>${h(fmtDay(r.date))}<br><small class="muted">${h(r.heure)}</small></td><td><strong>${h(r.nom)}</strong><br><small class="muted">${h(r.email)}${r.telephone ? ` · ${h(r.telephone)}` : ''}</small></td><td>${h(r.service)}</td><td>${badge(r.statut)}</td>
    <td class="actions"><select class="select select-sm" data-rdv-statut="${r.id}" aria-label="Statut du rendez-vous">${['confirme', 'termine', 'annule'].map((s) => `<option value="${s}"${s === r.statut ? ' selected' : ''}>${STATUTS[s]}</option>`).join('')}</select>${r.projet_id ? `<button class="btn btn-outline btn-sm" type="button" data-open-projet="${r.projet_id}">Projet</button>` : ''}</td></tr>`;

  const adminViews = {
    dashboard: { title: 'Tableau de bord', render() {
      const k = data.kpis;
      return `<div class="kpis kpis-5">
          <a class="card kpi" href="#rdv"><h3>Rendez-vous à venir</h3><strong>${k.rdv_a_venir}</strong><span class="hot">Voir l’agenda</span></a>
          <a class="card kpi" href="#demandes"><h3>Demandes à traiter</h3><strong>${k.demandes_a_traiter}</strong><span class="hot">Formulaire de contact</span></a>
          <a class="card kpi" href="#projets"><h3>Projets actifs</h3><strong>${k.projets_actifs}</strong><span>Nouveaux, en cours, en pause</span></a>
          <a class="card kpi" href="#clients"><h3>Clients</h3><strong>${k.clients}</strong><span>Comptes créés</span></a>
          <a class="card kpi" href="#assistant"><h3>Questions à l’assistant</h3><strong>${k.questions_assistant_7j}</strong><span>7 derniers jours</span></a>
        </div>
        <div class="panels">
          <div class="card panel"><h2>Prochains rendez-vous</h2>${data.prochains_rdv.length ? `<ul class="row-list">${data.prochains_rdv.map((r) => `<li><div class="grow"><strong>${h(r.nom)}</strong><small class="muted">${h(r.service)} · ${h(fmtDay(r.date))} à ${h(r.heure)}</small></div><a class="link-arrow" href="mailto:${h(r.email)}">Écrire</a></li>`).join('')}</ul>` : empty('Aucun rendez-vous à venir.')}</div>
          <div class="card panel"><h2>Demandes à traiter</h2>${data.demandes.length ? `<ul class="row-list">${data.demandes.map((d) => `<li><div class="grow"><strong>${h(d.nom)}</strong><small class="muted">${h(d.sujet)} · ${h(fmtSql(d.cree_le))}</small></div><a class="link-arrow" href="#demandes">Ouvrir</a></li>`).join('')}</ul>` : empty('Aucune demande en attente.')}</div>
          <div class="card panel panel-wide"><h2>Derniers messages clients</h2>${data.messages.length ? `<ul class="row-list">${data.messages.map((m) => `<li><div class="grow"><strong>${h(m.nom || m.email)}</strong> <small class="muted">sur « ${h(m.titre)} » · ${h(fmtSql(m.cree_le))}</small><p class="msg-preview">${h(m.contenu)}</p></div><button class="btn btn-outline btn-sm" type="button" data-open-projet="${m.projet_id}">Répondre</button></li>`).join('')}</ul>` : empty('Aucun message.')}</div>
        </div>`;
    } },
    rdv: { title: 'Rendez-vous', async load() { await adminList('rdv', '/api/admin/rendez-vous'); }, render() {
      const rows = cache.rdv?.rendez_vous || [];
      const today = new Date().toISOString().slice(0, 10);
      const avenir = rows.filter((r) => r.date >= today).reverse();
      const passes = rows.filter((r) => r.date < today);
      const table = (list) => (list.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Client</th><th>Service</th><th>Statut</th><th></th></tr></thead><tbody>${list.map(rdvRow).join('')}</tbody></table></div>` : empty('Aucun rendez-vous.'));
      return `<div class="card panel"><h2>À venir</h2>${table(avenir)}</div><div class="card panel"><h2>Passés</h2>${table(passes)}</div>`;
    } },
    projets: { title: 'Projets', async load() { await adminList('projets', '/api/admin/projets'); }, render() {
      const rows = cache.projets?.projets || [];
      return `<div class="card panel"><div class="panel-head"><h2>Tous les projets</h2><button class="btn btn-primary btn-sm" type="button" data-new-projet>+ Nouveau projet</button></div>
        ${rows.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Projet</th><th>Client</th><th>Avancement</th><th>Statut</th><th>Mis à jour</th><th></th></tr></thead><tbody>${rows.map((p) => `<tr><td><strong>${h(p.titre)}</strong><br><small class="muted">${p.origine === 'rendez_vous' ? 'Créé par un rendez-vous' : p.origine === 'contact' ? 'Créé depuis une demande' : 'Créé manuellement'}</small></td><td>${h(p.nom || '')}<br><small class="muted">${h(p.email)}</small></td><td class="td-progress">${progress(p.avancement)}<small>${+p.avancement} %</small></td><td>${badge(p.statut)}</td><td><small>${h(fmtSql(p.maj_le))}</small></td><td><button class="btn btn-outline btn-sm" type="button" data-open-projet="${p.id}">Ouvrir${+p.nb_messages ? ` (${+p.nb_messages})` : ''}</button></td></tr>`).join('')}</tbody></table></div>` : empty('Aucun projet. Chaque rendez-vous pris sur le site crée automatiquement un projet ici.')}</div>`;
    } },
    demandes: { title: 'Demandes de contact', async load() { await adminList('demandes', '/api/admin/demandes'); }, render() {
      const rows = cache.demandes?.demandes || [];
      return rows.length ? rows.map((d) => `<article class="card panel demande ${d.traite ? 'is-done' : ''}">
          <div class="project-head"><div><h2>${h(d.nom)} <small class="muted">· ${h(d.sujet)}</small></h2><small class="muted"><a href="mailto:${h(d.email)}">${h(d.email)}</a> · ${h(fmtSql(d.cree_le))}</small></div>${d.traite ? '<span class="status status-termine">Traitée</span>' : '<span class="status status-nouveau">À traiter</span>'}</div>
          <p class="demande-msg">${h(d.message).replace(/\n/g, '<br>')}</p>
          <div class="actions"><a class="btn btn-outline btn-sm" href="mailto:${h(d.email)}?subject=${encodeURIComponent(`Re : ${d.sujet}`)}">Répondre par email</a><button class="btn btn-outline btn-sm" type="button" data-demande-projet="${d.id}">Créer un projet</button><button class="btn btn-sm ${d.traite ? 'btn-outline' : 'btn-primary'}" type="button" data-demande-traiter="${d.id}" data-value="${d.traite ? 0 : 1}">${d.traite ? 'Marquer à traiter' : 'Marquer traitée'}</button></div>
        </article>`).join('') : `<div class="card panel">${empty('Aucune demande de contact.')}</div>`;
    } },
    clients: { title: 'Clients', async load() { await adminList('clients', '/api/admin/clients'); }, render() {
      const rows = cache.clients?.clients || [];
      return `<div class="card panel">${rows.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Client</th><th>Entreprise</th><th>Téléphone</th><th>Projets</th><th>RDV</th><th>Dernière connexion</th></tr></thead><tbody>${rows.map((c) => `<tr><td><strong>${h(c.nom || '')}</strong><br><a href="mailto:${h(c.email)}"><small>${h(c.email)}</small></a></td><td>${h(c.entreprise || '')}</td><td>${h(c.telephone || '')}</td><td>${+c.nb_projets}</td><td>${+c.nb_rdv}</td><td><small>${c.derniere_connexion ? h(fmtSql(c.derniere_connexion)) : 'Jamais'}</small></td></tr>`).join('')}</tbody></table></div>` : empty('Aucun client pour le moment.')}</div>`;
    } },
    assistant: { title: 'Assistant IA', async load() { await adminList('assistant', '/api/admin/assistant'); }, render() {
      const rows = cache.assistant?.messages || [];
      return `<div class="card panel"><p class="form-note">Les questions posées par les visiteurs à l’assistant du site. Idéal pour repérer des besoins et enrichir vos pages.</p>${rows.length ? `<ul class="qa-list">${rows.map((m) => `<li><div class="qa-q"><span>Question</span>${h(m.question)}</div><div class="qa-a"><span>Réponse</span>${h(m.reponse || '').replace(/\n/g, '<br>')}</div><small class="muted">${h(fmtSql(m.cree_le))}${m.page ? ` · page ${h(m.page)}` : ''}</small></li>`).join('')}</ul>` : empty('Aucune question pour le moment.')}</div>`;
    } },
  };

  const views = espace === 'client' ? clientViews : adminViews;

  /* ---------- Rendu et navigation ---------- */
  async function render() {
    let key = location.hash.slice(1);
    if (!views[key]) key = 'dashboard';
    const view = views[key];
    links.forEach((l) => l.classList.toggle('is-active', l.dataset.viewLink === key));
    titleEl.textContent = view.title;
    document.title = `${view.title} | ${espace === 'client' ? 'Espace client' : 'Administration'} Renaissance iTech`;
    sidebar.classList.remove('is-open');
    if (view.load) {
      root.innerHTML = '<p class="empty-state">Chargement…</p>';
      try { await view.load(); } catch (e) { return handleError(e); }
    }
    root.innerHTML = view.render();
    const count = espace === 'client' ? data.non_lus : data.kpis?.demandes_a_traiter;
    const badgeEl = $(`[data-count="${espace === 'client' ? 'messages' : 'demandes'}"]`);
    if (badgeEl) { badgeEl.hidden = !count; badgeEl.textContent = count; }
  }

  function handleError(e) {
    if (e.status === 401 || e.status === 403) { appEl.hidden = true; loginEl.hidden = false; return; }
    root.innerHTML = `<div class="card panel"><p class="form-msg err">${h(e.message)}</p></div>`;
  }

  addEventListener('hashchange', render);

  /* ---------- Actions ---------- */
  root.addEventListener('submit', async (e) => {
    const form = e.target;
    if (form.matches('[data-reply]')) {
      e.preventDefault();
      const contenu = form.contenu.value.trim();
      if (!contenu) return;
      form.querySelector('button').disabled = true;
      try {
        await api('/api/client/message', { projet_id: +form.dataset.reply, contenu });
        await load(); await render(); toast('Message envoyé à l’équipe');
      } catch (err) { toast(err.message); form.querySelector('button').disabled = false; }
    }
    if (form.matches('[data-profil]')) {
      e.preventDefault();
      try {
        const res = await api('/api/client/profil', { nom: form.nom.value, telephone: form.telephone.value, entreprise: form.entreprise.value });
        await load(); setUser(); toast(res.message);
      } catch (err) { toast(err.message); }
    }
  });

  root.addEventListener('change', async (e) => {
    const sel = e.target.closest('[data-rdv-statut]');
    if (!sel) return;
    try {
      await api('/api/admin/rendez-vous/statut', { id: +sel.dataset.rdvStatut, statut: sel.value });
      toast(sel.value === 'annule' ? 'Rendez-vous annulé : le créneau est de nouveau disponible' : 'Statut mis à jour');
      await load(); await render();
    } catch (err) { toast(err.message); }
  });

  document.addEventListener('click', async (e) => {
    const open = e.target.closest('[data-open-projet]');
    if (open) return openProjet(+open.dataset.openProjet);
    if (e.target.closest('[data-new-projet]')) return newProjet({});
    const dp = e.target.closest('[data-demande-projet]');
    if (dp) {
      const d = cache.demandes.demandes.find((x) => x.id === +dp.dataset.demandeProjet);
      return newProjet({ email: d.email, nom: d.nom, titre: d.sujet, contact_id: d.id });
    }
    const tr = e.target.closest('[data-demande-traiter]');
    if (tr) {
      try {
        await api('/api/admin/demande/traiter', { id: +tr.dataset.demandeTraiter, traite: tr.dataset.value === '1' });
        await load(); await render();
      } catch (err) { toast(err.message); }
    }
  });

  const SERVICES = ['IA privée & souveraine', 'Automatisation IA', 'Formation IA des équipes', 'Cybersécurité', 'Conseil & stratégie', 'Création web & développement', 'SEO & référencement'];

  function newProjet(pre) {
    openModal(`<h2 id="modal-title">Nouveau projet</h2>
      <form class="form-grid" data-projet-creer>
        <div class="two">
          <div><label class="field-label" for="n-email">Email du client</label><input class="input" id="n-email" name="email" type="email" value="${h(pre.email || '')}" required></div>
          <div><label class="field-label" for="n-nom">Nom du client</label><input class="input" id="n-nom" name="nom" value="${h(pre.nom || '')}"></div>
        </div>
        <div><label class="field-label" for="n-titre">Titre du projet</label><input class="input" id="n-titre" name="titre" value="${h(pre.titre || '')}" required></div>
        <div><label class="field-label" for="n-service">Service</label><select class="select" id="n-service" name="service"><option value="">Aucun</option>${SERVICES.map((s) => `<option${s === pre.titre ? ' selected' : ''}>${h(s)}</option>`).join('')}</select></div>
        <input type="hidden" name="contact_id" value="${h(pre.contact_id || '')}">
        <button class="btn btn-primary" type="submit">Créer le projet</button>
        <p class="form-note">Le client pourra suivre ce projet dans son espace en se connectant avec cet email.</p>
      </form>`);
    $('[data-projet-creer]').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = ev.currentTarget;
      try {
        const res = await api('/api/admin/projet/creer', { email: f.email.value, nom: f.nom.value, titre: f.titre.value, service: f.service.value, contact_id: f.contact_id.value });
        closeModal(); toast('Projet créé'); await load();
        if (location.hash !== '#projets') location.hash = '#projets'; else await render();
        openProjet(res.id);
      } catch (err) { toast(err.message); }
    });
  }

  async function openProjet(id) {
    let p;
    try { p = (await api(`/api/admin/projet?id=${id}`)).projet; } catch (err) { return toast(err.message); }
    openModal(`<h2 id="modal-title">${h(p.titre)}</h2>
      <p class="muted">${h(p.nom || '')} · <a href="mailto:${h(p.email)}">${h(p.email)}</a>${p.telephone ? ` · ${h(p.telephone)}` : ''}${p.entreprise ? ` · ${h(p.entreprise)}` : ''}</p>
      <form class="form-grid projet-form" data-projet-maj>
        <div><label class="field-label" for="e-titre">Titre</label><input class="input" id="e-titre" name="titre" value="${h(p.titre)}"></div>
        <div class="two">
          <div><label class="field-label" for="e-statut">Statut</label><select class="select" id="e-statut" name="statut">${['nouveau', 'en_cours', 'en_pause', 'termine', 'annule'].map((s) => `<option value="${s}"${s === p.statut ? ' selected' : ''}>${STATUTS[s]}</option>`).join('')}</select></div>
          <div><label class="field-label" for="e-av">Avancement : <b data-av-out>${+p.avancement} %</b></label><input class="range" id="e-av" name="avancement" type="range" min="0" max="100" step="5" value="${+p.avancement}"></div>
        </div>
        <button class="btn btn-primary" type="submit">Enregistrer</button>
      </form>
      <h3 class="thread-title">Échanges avec le client</h3>
      ${thread(p.messages, 'admin')}
      <form class="reply-form" data-admin-reply>
        <label class="sr-only" for="a-rep">Votre message au client</label>
        <textarea class="textarea" id="a-rep" name="contenu" rows="3" placeholder="Écrire au client… (il recevra un email)" required></textarea>
        <label class="consent consent-light"><input type="checkbox" name="notifier" checked> Prévenir le client par email</label>
        <button class="btn btn-primary btn-sm" type="submit">Envoyer</button>
      </form>`);
    const body = $('[data-modal-body]');
    $('[name=avancement]', body).addEventListener('input', (ev) => { $('[data-av-out]', body).textContent = `${ev.target.value} %`; });
    $('[data-projet-maj]', body).addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = ev.currentTarget;
      try {
        await api('/api/admin/projet/maj', { id, statut: f.statut.value, avancement: +f.avancement.value, titre: f.titre.value });
        toast('Projet mis à jour'); await load(); await render();
      } catch (err) { toast(err.message); }
    });
    $('[data-admin-reply]', body).addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = ev.currentTarget;
      try {
        await api('/api/admin/message', { projet_id: id, contenu: f.contenu.value.trim(), notifier: f.notifier.checked });
        toast(f.notifier.checked ? 'Message envoyé, le client est prévenu par email' : 'Message enregistré');
        openProjet(id);
      } catch (err) { toast(err.message); }
    });
  }

  function setUser() {
    const name = espace === 'client' ? (data.client.nom || data.client.email) : 'Équipe Renaissance iTech';
    $('[data-user-name]').textContent = name;
    $('[data-user-initials]').textContent = espace === 'client' ? initials(data.client.nom || data.client.email) : 'RI';
  }

  /* ---------- Démarrage ---------- */
  load().then(() => {
    loginEl.hidden = true;
    appEl.hidden = false;
    setUser();
    return render();
  }).catch((e) => {
    if (e.status === 401 || e.status === 403) { loginEl.hidden = false; appEl.hidden = true; }
    else { loginEl.hidden = false; const m = $('[data-login-msg]'); m.hidden = false; m.className = 'form-msg err'; m.textContent = e.message; }
  });
})();
