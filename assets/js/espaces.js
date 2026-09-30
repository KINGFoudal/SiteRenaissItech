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
    if (!res.ok) { const e = new Error(data.error || 'Une erreur est survenue.'); e.status = res.status; e.code = data.code; throw e; }
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
  const euros = (c) => `${(Number(c) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\u00a0€`;
  const statutFacture = (f, today = new Date().toISOString().slice(0, 10)) => (f.statut === 'payee' ? '<span class="status status-payee">Payée</span>'
    : f.statut === 'annulee' ? '<span class="status status-annulee">Annulée</span>'
      : f.echeance < today ? '<span class="status status-retard">En retard</span>' : '<span class="status status-a_payer">À payer</span>');
  const DEVIS_LIB = { envoye: 'En attente', accepte: 'Accepté', refuse: 'Refusé', expire: 'Expiré', annule: 'Annulé', facture: 'Facturé' };
  const statutDevis = (d) => {
    const st = d.statut === 'envoye' && d.valide_jusqu < new Date().toISOString().slice(0, 10) ? 'expire' : d.statut;
    return `<span class="status status-d-${h(st)}">${h(DEVIS_LIB[st] || st)}</span>`;
  };
  const empty = (txt) => `<p class="empty-state">${h(txt)}</p>`;
  const thread = (messages, espace) => (messages.length ? `<div class="thread">${messages.map((m) => {
    const moi = (espace === 'client') === (m.auteur === 'client');
    return `<div class="bubble-row ${moi ? 'me' : ''}"><div class="msg-bubble"><span class="msg-author">${m.auteur === 'client' ? 'Client' : 'Équipe Renaissance iTech'} · ${h(fmtSql(m.cree_le))}</span>${h(m.contenu).replace(/\n/g, '<br>')}</div></div>`;
  }).join('')}</div>` : empty('Aucun message pour le moment.'));

  /* ---------- Afficher / masquer un mot de passe ---------- */

  // Infobulle du graphique d'encaissements
  document.addEventListener('mousemove', (e) => {
    const chart = e.target.closest?.('[data-chart]');
    document.querySelectorAll('[data-chart] .chart-tip').forEach((t) => { if (!chart || !chart.contains(t)) t.hidden = true; });
    if (!chart) return;
    const tip = chart.querySelector('.chart-tip');
    const bar = e.target.closest('.bar');
    chart.querySelectorAll('.bar.on').forEach((b) => b !== bar && b.classList.remove('on'));
    if (!bar) { tip.hidden = true; return; }
    bar.classList.add('on');
    tip.textContent = bar.dataset.tip;
    tip.hidden = false;
    const r = chart.getBoundingClientRect();
    tip.style.left = `${Math.min(Math.max(e.clientX - r.left, 70), r.width - 70)}px`;
    tip.style.top = `${e.clientY - r.top - 44}px`;
  });
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-pwd-toggle]');
    if (!t) return;
    const input = document.getElementById(t.getAttribute('aria-controls'));
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    t.textContent = show ? 'Masquer' : 'Afficher';
    t.setAttribute('aria-pressed', String(show));
  });

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
  const tsCle = fetch('/api/config').then((r) => r.json()).then((c) => c.turnstile).catch(() => null);
  let tsScript;
  const initTurnstile = async () => {
    const cle = await tsCle;
    if (!cle) return;
    tsScript ||= new Promise((ok) => {
      window.ritTsOk = ok;
      const sc = document.createElement('script');
      sc.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=ritTsOk';
      sc.async = true;
      document.head.append(sc);
    });
    await tsScript;
    $$('[data-turnstile]').forEach((el) => {
      if (el.dataset.widget) return;
      el.hidden = false;
      el.dataset.widget = window.turnstile.render(el, tsOptions(el, cle));
    });
  };
  const tsJeton = (form) => { const el = $('[data-turnstile]', form); return el?.dataset.widget && window.turnstile ? window.turnstile.getResponse(el.dataset.widget) : undefined; };
  const tsReset = (form) => { const el = $('[data-turnstile]', form); if (el?.dataset.widget && window.turnstile) window.turnstile.reset(el.dataset.widget); };
  initTurnstile();

  const say = (el, ok, text) => { el.hidden = false; el.className = `form-msg ${ok ? 'ok' : 'err'}`; el.textContent = text; };
  const REGLE = /^(?=.*[a-zA-Z])(?=.*\d).{10,128}$/;
  const checkNouveau = (nouveau, confirmation) => {
    if (!REGLE.test(nouveau)) return 'Le mot de passe doit contenir au moins 10 caractères, dont une lettre et un chiffre.';
    if (nouveau !== confirmation) return 'Les deux mots de passe ne sont pas identiques.';
    return null;
  };

  /* ================================================================ Page « mot de passe » (oublié / nouveau) */
  const mdpPage = $('[data-mdp-page]');
  if (mdpPage) {
    const q = new URLSearchParams(location.search);
    const jeton = q.get('jeton');
    const espace = q.get('espace') === 'admin' ? 'admin' : 'client';
    $('[data-mdp-retour]').href = espace === 'admin' ? '/admin' : '/espace-client';
    if (jeton) {
      $('[data-mdp-title]').textContent = 'Nouveau mot de passe';
      $('[data-mdp-demande]').hidden = true;
      $('[data-mdp-nouveau]').hidden = false;
      $('[data-mdp-nouveau-form]').addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = e.currentTarget; const msg = $('[data-mdp-msg2]');
        const err = checkNouveau(f.nouveau.value, f.confirmation.value);
        if (err) return say(msg, false, err);
        $('button[type=submit]', f).disabled = true;
        try {
          const res = await api('/api/auth/reinitialiser', { jeton, mot_de_passe: f.nouveau.value });
          say(msg, true, `${res.message} Redirection…`);
          setTimeout(() => location.replace(res.redirect), 900);
        } catch (ex) { say(msg, false, ex.message); $('button[type=submit]', f).disabled = false; }
      });
    } else {
      $('[data-mdp-demande-form]').addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = e.currentTarget; const msg = $('[data-mdp-msg]');
        $('button', f).disabled = true;
        try {
          const res = await api('/api/auth/mot-de-passe-oublie', { email: f.email.value.trim(), espace, turnstile: tsJeton(f) });
          say(msg, true, res.message); f.reset(); tsReset(f);
        } catch (ex) { say(msg, false, ex.message); tsReset(f); } finally { $('button', f).disabled = false; }
      });
    }
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
  const changeEl = $('[data-change]');
  const ecrans = { login: loginEl, change: changeEl, app: appEl, '2fa': $('[data-2fa]'), totp: $('[data-totp]') };
  const screen = (name) => Object.entries(ecrans).forEach(([k, el]) => { if (el) el.hidden = k !== name; });
  let defi = null;
  // Mot de passe provisoire à remplacer : on le garde en mémoire juste après la connexion
  const showChange = (provisoire) => {
    const f = $('[data-change-form]');
    f.actuel.value = provisoire || '';
    f.actuel.closest('div:not(.pwd)').hidden = Boolean(provisoire);
    screen('change');
    (provisoire ? f.nouveau : f.actuel).focus();
  };
  $('[data-login-form]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const msg = $('[data-login-msg]');
    const btn = $('button[type=submit]', f);
    if (!f.email.value.trim() || !f.mot_de_passe.value) return say(msg, false, 'Indiquez votre email et votre mot de passe.');
    btn.disabled = true;
    try {
      const res = await api('/api/auth/connexion', { email: f.email.value.trim(), mot_de_passe: f.mot_de_passe.value, espace: f.dataset.espace, turnstile: tsJeton(f) });
      msg.hidden = true;
      if (res.etape === '2fa') { defi = res.defi; screen('2fa'); $('#t-code').focus(); }
      else if (res.doit_changer) showChange(f.mot_de_passe.value);
      else start();
      f.mot_de_passe.value = '';
    } catch (err) {
      say(msg, false, err.message);
    } finally { btn.disabled = false; tsReset(f); }
  });

  /* ---------- Administration : double authentification ---------- */
  $('[data-2fa-form]')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget; const msg = $('[data-2fa-msg]');
    try {
      const res = await api('/api/auth/2fa', { defi, code: f.code.value.trim() });
      f.reset(); msg.hidden = true; defi = null;
      if (res.message) toast(res.message);
      start();
    } catch (err) {
      if (err.code === 'defi_expire') { screen('login'); say($('[data-login-msg]'), false, err.message); return; }
      say(msg, false, err.message); f.code.select();
    }
  });
  async function showTotp() {
    screen('totp');
    $('[data-totp-etape1]').hidden = false; $('[data-totp-etape2]').hidden = true;
    try {
      const { secret, uri } = await api('/api/auth/totp/initier', {});
      const qr = window.qrcode(0, 'M'); qr.addData(uri); qr.make();
      $('[data-totp-qr]').innerHTML = qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
      $('[data-totp-secret]').textContent = secret.match(/.{1,4}/g).join(' ');
      $('#a-code').focus();
    } catch (err) { say($('[data-totp-msg]'), false, err.message); }
  }
  const afficherCodes = (codes) => {
    $('[data-codes]').innerHTML = codes.map((c) => `<li><code>${h(c)}</code></li>`).join('');
    $('[data-codes-copier]').onclick = async () => { try { await navigator.clipboard.writeText(codes.join('\n')); toast('Codes copiés'); } catch { toast('Sélectionnez les codes pour les copier'); } };
  };
  $('[data-totp-form]')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    try {
      const res = await api('/api/auth/totp/activer', { code: f.code.value.trim() });
      f.reset();
      afficherCodes(res.codes_secours);
      $('[data-totp-etape1]').hidden = true; $('[data-totp-etape2]').hidden = false;
    } catch (err) { say($('[data-totp-msg]'), false, err.message); }
  });
  $('[data-totp-fin]')?.addEventListener('click', () => start());
  $('[data-change-form]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const msg = $('[data-change-msg]');
    const err = checkNouveau(f.nouveau.value, f.confirmation.value);
    if (err) return say(msg, false, err);
    try {
      await api('/api/auth/changer', { actuel: f.actuel.value, nouveau: f.nouveau.value });
      f.reset(); msg.hidden = true;
      toast('Votre mot de passe personnel est enregistré');
      start();
    } catch (ex) { say(msg, false, ex.message); }
  });
  $$('[data-logout]').forEach((b) => b.addEventListener('click', async () => {
    await api('/api/auth/deconnexion', {}).catch(() => {});
    location.reload();
  }));
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
    factures: { title: 'Devis et factures', render() {
      const rows = data.factures || [];
      const devis = data.devis || [];
      const tableDevis = devis.length ? `<div class="card panel"><h2>Mes devis</h2><div class="table-wrap"><table class="table"><thead><tr><th>Devis</th><th>Objet</th><th class="num">Montant HT</th><th>Statut</th><th></th></tr></thead><tbody>
        ${devis.map((d) => `<tr><td><strong>${h(d.numero)}</strong><br><small class="muted">${h(fmtDay(d.emis_le))}</small></td><td>${h(d.objet)}</td><td class="num">${euros(d.montant_ht)}</td><td>${statutDevis(d)}</td>
          <td class="actions"><a class="btn ${d.statut === 'envoye' && d.valide_jusqu >= new Date().toISOString().slice(0, 10) ? 'btn-primary' : 'btn-outline'} btn-sm" href="/devis?t=${encodeURIComponent(d.jeton)}" target="_blank" rel="noopener">${d.statut === 'envoye' ? 'Consulter et accepter' : 'Voir'}</a></td></tr>`).join('')}
        </tbody></table></div></div>` : '';
      if (!rows.length) return `${tableDevis}<div class="card panel">${empty('Aucune facture pour le moment.')}</div>`;
      const du = rows.filter((f) => f.statut === 'a_payer').reduce((t, f) => t + f.montant_ttc, 0);
      return `${du ? `<div class="card panel"><h2>Reste à régler : ${euros(du)}</h2><p class="form-note">${data.paiement ? 'Réglez en un clic par carte, Apple Pay ou Google Pay. Paiement sécurisé par Stripe.' : 'Règlement par virement : les coordonnées bancaires figurent sur chaque facture.'}</p></div>` : ''}
        ${tableDevis}<div class="card panel table-wrap"><table class="table"><thead><tr><th>Facture</th><th>Objet</th><th class="num">Montant</th><th>Échéance</th><th>Statut</th><th></th></tr></thead><tbody>
        ${rows.map((f) => `<tr><td><strong>${h(f.numero)}</strong><br><small class="muted">${h(fmtDay(f.emise_le))}</small></td><td>${h(f.objet)}</td><td class="num">${euros(f.montant_ttc)}</td><td>${h(fmtDay(f.echeance))}</td><td>${statutFacture(f)}</td>
          <td class="actions"><a class="btn btn-outline btn-sm" href="/facture?t=${encodeURIComponent(f.jeton)}" target="_blank" rel="noopener">Voir</a>${f.statut === 'a_payer' && data.paiement ? `<a class="btn btn-primary btn-sm" href="/api/paiement/facture?t=${encodeURIComponent(f.jeton)}">Payer</a>` : ''}</td></tr>`).join('')}
        </tbody></table></div>`;
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
        </form>${formMotDePasse()}`;
    } },
  };

  const formMotDePasse = () => `<form class="card panel settings-form" data-mdp-changer>
      <h2>Changer mon mot de passe</h2>
      <div class="form-grid">
        <div><label class="field-label" for="s-actuel">Mot de passe actuel</label><div class="pwd"><input class="input" id="s-actuel" name="actuel" type="password" autocomplete="current-password" required><button class="pwd-toggle" type="button" data-pwd-toggle aria-controls="s-actuel" aria-pressed="false">Afficher</button></div></div>
        <div class="two">
          <div><label class="field-label" for="s-nouveau">Nouveau mot de passe</label><div class="pwd"><input class="input" id="s-nouveau" name="nouveau" type="password" autocomplete="new-password" minlength="10" required><button class="pwd-toggle" type="button" data-pwd-toggle aria-controls="s-nouveau" aria-pressed="false">Afficher</button></div></div>
          <div><label class="field-label" for="s-confirm">Confirmer</label><div class="pwd"><input class="input" id="s-confirm" name="confirmation" type="password" autocomplete="new-password" minlength="10" required><button class="pwd-toggle" type="button" data-pwd-toggle aria-controls="s-confirm" aria-pressed="false">Afficher</button></div></div>
        </div>
        <p class="form-note">10 caractères minimum, avec au moins une lettre et un chiffre. Vos autres appareils seront déconnectés.</p>
        <div><button class="btn btn-primary" type="submit">Mettre à jour</button></div>
      </div>
    </form>`;


  /* ---------- Tableau de bord administrateur : finances, graphique, activité ---------- */
  const depuis = (s) => { // durée écoulée, lisible : « il y a 5 min », « hier », « 12 oct. »
    if (!s) return '';
    const d = new Date(`${s.replace(' ', 'T')}${s.length <= 10 ? 'T12:00:00' : ''}Z`);
    const min = Math.round((Date.now() - d) / 60000);
    if (min < 1) return 'à l’instant';
    if (min < 60) return `il y a ${min} min`;
    if (min < 60 * 24) return `il y a ${Math.round(min / 60)} h`;
    if (min < 60 * 48) return 'hier';
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  };
  const ICONES = {
    paiement: '<path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
    facture: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M9 13h6M9 17h4"/>',
    commande: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18M16 10a4 4 0 0 1-8 0"/>',
    relance: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
    rdv: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    demande: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1Z"/>',
    message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/>',
    client: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>',
  };
  const icone = (t) => `<span class="ri ri-${h(t)}" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICONES[t] || ICONES.facture}</svg></span>`;
  const phraseActivite = (a) => {
    const m = a.montant != null ? ` · <strong>${euros(a.montant)}</strong>` : '';
    return {
      paiement: `Paiement reçu de <strong>${h(a.qui)}</strong> · ${h(a.ref)}${m}${a.detail ? ` <small class="muted">(${h(a.detail)})</small>` : ''}`,
      facture: `Facture <strong>${h(a.ref)}</strong> émise pour ${h(a.qui)}${m}`,
      commande: `Achat en boutique <strong>${h(a.ref)}</strong>${a.qui ? ` par ${h(a.qui)}` : ''}${m}`,
      relance: `Relance envoyée à ${h(a.qui)} · ${h(a.ref)}${m}`,
      rdv: `Rendez-vous pris par <strong>${h(a.qui)}</strong> · ${h(a.ref)}${a.detail ? ` <small class="muted">le ${h(fmtDay(a.detail.slice(0, 10)))} à ${h(a.detail.slice(11))}</small>` : ''}`,
      demande: `Nouvelle demande de <strong>${h(a.qui)}</strong> · ${h(a.ref)}`,
      message: `Message de <strong>${h(a.qui)}</strong> sur « ${h(a.ref)} »`,
      client: `Nouveau client : <strong>${h(a.qui)}</strong>`,
    }[a.type] || h(a.type);
  };
  const variation = (actuel, avant) => {
    if (!avant) return actuel ? '<span class="delta up">Premier mois encaissé</span>' : '<span>Rien encaissé ce mois</span>';
    const pct = Math.round(((actuel - avant) / avant) * 100);
    return `<span class="delta ${pct >= 0 ? 'up' : 'down'}">${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct)} % vs mois dernier</span>`;
  };
  // Histogramme des encaissements sur 12 mois (une seule série : pas de légende, le titre la nomme)
  const graphiqueEncaissements = (serie = []) => {
    const now = new Date();
    const mois = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11 + i, 1));
      const cle = d.toISOString().slice(0, 7);
      return { cle, label: MOIS[d.getUTCMonth()].replace('.', ''), annee: d.getUTCFullYear(), total: Number(serie.find((x) => x.mois === cle)?.total || 0) };
    });
    const max = Math.max(...mois.map((m) => m.total));
    if (!max) return empty('Aucun encaissement sur les 12 derniers mois. Les paiements apparaîtront ici.');
    const pas = [1, 2, 2.5, 5, 10].map((k) => k * 10 ** Math.floor(Math.log10(max / 100 / 4))).find((p) => p * 4 * 100 >= max) || max / 400;
    const haut = pas * 4 * 100; // centimes
    const W = 720, H = 220, g = 48, bas = 24, t = 12, slot = (W - g) / 12, bw = Math.min(24, slot * 0.55);
    const y = (v) => t + (H - t - bas) * (1 - v / haut);
    const barre = (m, i) => {
      const x = g + i * slot + (slot - bw) / 2, y0 = y(0), y1 = y(m.total), r = Math.min(4, (y0 - y1) / 2);
      const path = m.total ? `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + bw - r}Q${x + bw},${y1} ${x + bw},${y1 + r}V${y0}Z` : '';
      return `<g class="bar" data-tip="${h(`${m.label} ${m.annee} · ${euros(m.total)}`)}"><rect class="hit" x="${g + i * slot}" y="${t}" width="${slot}" height="${H - t - bas}"/>${path ? `<path d="${path}"/>` : ''}<text x="${g + i * slot + slot / 2}" y="${H - 6}" text-anchor="middle">${h(m.label)}</text></g>`;
    };
    const grille = [0, 1, 2, 3, 4].map((k) => `<line x1="${g}" x2="${W}" y1="${y(k * pas * 100)}" y2="${y(k * pas * 100)}"/><text x="${g - 8}" y="${y(k * pas * 100) + 4}" text-anchor="end">${(k * pas).toLocaleString('fr-FR')} €</text>`).join('');
    return `<div class="chart" data-chart><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Encaissements par mois sur 12 mois"><g class="grid">${grille}</g>${mois.map(barre).join('')}</svg><div class="chart-tip" hidden></div></div>
      <details class="chart-table"><summary>Voir les chiffres en tableau</summary><div class="table-wrap"><table class="table"><thead><tr><th>Mois</th><th class="num">Encaissé TTC</th></tr></thead><tbody>${mois.map((m) => `<tr><td>${h(m.label)} ${m.annee}</td><td class="num">${euros(m.total)}</td></tr>`).join('')}</tbody></table></div></details>`;
  };


  /* ---------- CRM : libellés et petits composants ---------- */
  const STATUT_CONTACT = { prospect: 'Prospect', client: 'Client', ancien: 'Ancien client' };
  const SOURCE_CONTACT = { formulaire: 'Formulaire du site', rendez_vous: 'Rendez-vous en ligne', boutique: 'Boutique', recommandation: 'Recommandation', reseaux: 'Réseaux sociaux', salon: 'Salon / événement', appel: 'Appel entrant', autre: 'Autre' };
  const ETAPE_LIB = { nouveau: 'Nouveau', qualifie: 'Qualifié', proposition: 'Devis envoyé', negociation: 'Négociation', gagne: 'Gagné', perdu: 'Perdu' };
  const NOTE_LIB = { note: 'Note', appel: 'Appel', email: 'Email', reunion: 'Réunion' };
  const statutContact = (st) => `<span class="status status-c-${h(st || 'prospect')}">${h(STATUT_CONTACT[st] || st || 'Prospect')}</span>`;
  const chips = (tags) => (tags ? tags.split(',').filter(Boolean).map((t) => `<span class="chip">${h(t)}</span>`).join('') : '');
  const nomContact = (c) => c.entreprise || c.nom || c.email;
  const lienContact = (id, texte) => `<a class="contact-link" href="#contact/${+id}">${texte}</a>`;
  const aujourdhui = () => new Date().toISOString().slice(0, 10);
  const echeanceTxt = (d) => {
    if (!d) return '';
    const t = aujourdhui();
    const cls = d < t ? 'late' : d === t ? 'today' : '';
    const txt = d === t ? 'Aujourd’hui' : d < t ? `En retard · ${fmtDay(d)}` : fmtDay(d);
    return `<span class="due ${cls}">${h(txt)}</span>`;
  };
  const optionsContacts = (sel) => (cache.clients?.clients || []).map((c) => `<option value="${c.id}"${+sel === c.id ? ' selected' : ''}>${h(nomContact(c))}${c.entreprise && c.nom ? ` (${h(c.nom)})` : ''}</option>`).join('');
  const assureContacts = async () => { if (!cache.clients) await adminList('clients', '/api/admin/clients'); };
  const ligneTache = (t, avecContact = true) => `<li class="task ${t.faite ? 'done' : ''} ${t.priorite === 'haute' ? 'high' : ''}">
      <label class="task-check"><input type="checkbox" data-tache-faite="${t.id}" ${t.faite ? 'checked' : ''} aria-label="Marquer « ${h(t.titre)} » comme faite"></label>
      <div class="grow"><span class="task-title">${t.priorite === 'haute' ? '<span class="prio" title="Prioritaire">!</span>' : ''}${h(t.titre)}</span>
        <small class="muted">${t.faite ? (t.faite_le ? `Faite ${h(depuis(t.faite_le))}` : 'Faite') : echeanceTxt(t.echeance)}${avecContact && t.client_id ? ` · ${lienContact(t.client_id, h(t.entreprise || t.nom || t.email || ''))}` : ''}${t.opportunite ? ` · ${h(t.opportunite)}` : ''}</small></div>
      <button class="icon-btn" type="button" data-tache-suppr="${t.id}" aria-label="Supprimer la tâche">✕</button></li>`;
  const tableContacts = (rows) => (rows.length ? rows.map((c) => `<tr>
      <td>${lienContact(c.id, `<strong>${h(c.nom || c.email)}</strong>`)}<br><small class="muted">${h([c.poste, c.entreprise].filter(Boolean).join(' · ') || c.email)}</small></td>
      <td>${statutContact(c.statut)}${c.acces_premium ? '<br><small class="muted">Espace client actif</small>' : ''}</td>
      <td class="chips">${chips(c.etiquettes)}</td>
      <td class="num">${c.ca ? euros(c.ca) : '<span class="muted">—</span>'}${c.a_payer ? `<br><small class="due late">${euros(c.a_payer)} à payer</small>` : ''}</td>
      <td class="num">${c.nb_opportunites ? `${+c.nb_opportunites} · ${euros(c.montant_opportunites)}` : '<span class="muted">—</span>'}</td>
      <td class="num">${c.nb_taches ? `<span class="count-pill">${+c.nb_taches}</span>` : '<span class="muted">—</span>'}</td>
      <td><small>${h(depuis(c.dernier_contact || c.cree_le))}</small></td>
      <td><a class="btn btn-outline btn-sm" href="#contact/${c.id}">Ouvrir</a></td></tr>`).join('')
    : `<tr><td colspan="8">${empty('Aucun contact ne correspond.')}</td></tr>`);
  const filtreContacts = (rows, f) => rows.filter((c) => {
    if (f.statut && c.statut !== f.statut) return false;
    if (f.tag && !(c.etiquettes || '').split(',').includes(f.tag)) return false;
    if (!f.q) return true;
    const q = f.q.toLowerCase();
    return [c.nom, c.entreprise, c.email, c.telephone, c.ville, c.etiquettes, c.poste].some((v) => (v || '').toLowerCase().includes(q));
  });
  const crmFiltre = { q: '', statut: '', tag: '' };

  // Historique complet d'un contact : notes + tout ce qui s'est passé sur le site
  const timelineContact = (d) => {
    const ev = [
      ...d.notes.map((n) => ({ quand: n.cree_le, type: n.type, icone: n.type === 'appel' ? 'rdv' : n.type === 'email' ? 'message' : n.type === 'reunion' ? 'client' : 'facture', titre: NOTE_LIB[n.type] || 'Note', texte: n.contenu, note: n.id, auteur: n.auteur })),
      ...d.rdv.map((r) => ({ quand: r.cree_le, icone: 'rdv', titre: `Rendez-vous pris : ${r.service}`, texte: `Le ${fmtDay(r.date)} à ${r.heure}${r.statut === 'annule' ? ' (annulé)' : ''}${r.message ? `\n${r.message}` : ''}` })),
      ...d.demandes.map((x) => ({ quand: x.cree_le, icone: 'demande', titre: `Demande de contact : ${x.sujet}`, texte: x.message })),
      ...d.factures.map((f) => ({ quand: `${f.emise_le} 00:00:00`, icone: 'facture', titre: `Facture ${f.numero} émise · ${euros(f.montant_ttc)}`, texte: f.objet })),
      ...d.factures.filter((f) => f.payee_le).map((f) => ({ quand: f.payee_le, icone: 'paiement', titre: `Paiement reçu · ${f.numero} · ${euros(f.montant_ttc)}`, texte: f.mode_paiement ? `Réglée par ${f.mode_paiement}` : '' })),
      ...(d.devis || []).map((v) => ({ quand: `${v.emis_le} 00:00:01`, icone: 'facture', titre: `Devis ${v.numero} envoyé · ${euros(v.montant_ht)} HT`, texte: v.objet })),
      ...(d.devis || []).filter((v) => v.refuse_le).map((v) => ({ quand: v.refuse_le, icone: 'relance', titre: `Devis ${v.numero} refusé`, texte: v.raison_refus || '' })),
      ...d.commandes.map((c) => ({ quand: c.payee_le || c.cree_le, icone: 'commande', titre: `Achat en boutique ${c.reference} · ${euros(c.montant_ttc)}` })),
      ...d.messages.filter((m) => m.auteur === 'client').map((m) => ({ quand: m.cree_le, icone: 'message', titre: `Message sur « ${m.titre} »`, texte: m.contenu })),
      ...d.opportunites.filter((o) => o.cloture_le).map((o) => ({ quand: o.cloture_le, icone: o.etape === 'gagne' ? 'paiement' : 'relance', titre: `Opportunité ${o.etape === 'gagne' ? 'gagnée' : 'perdue'} : ${o.titre}`, texte: o.raison_perte || '' })),
      ...d.taches.filter((t) => t.faite && t.faite_le).map((t) => ({ quand: t.faite_le, icone: 'rdv', titre: `Tâche faite : ${t.titre}` })),
    ].filter((e) => e.quand).sort((a, b) => (a.quand < b.quand ? 1 : -1));
    return ev.length ? `<ol class="timeline">${ev.map((e) => `<li>${icone(e.icone)}<div class="grow"><div class="tl-head"><strong>${h(e.titre)}</strong><small class="muted">${h(depuis(e.quand))}${e.auteur ? ` · ${h(e.auteur)}` : ''}</small>${e.note ? `<button class="icon-btn" type="button" data-note-suppr="${e.note}" aria-label="Supprimer cette note">✕</button>` : ''}</div>${e.texte ? `<p>${h(e.texte).replace(/\n/g, '<br>')}</p>` : ''}</div></li>`).join('')}</ol>` : empty('Aucun échange pour le moment. Notez vos appels, emails et réunions ci-dessus.');
  };
  const carteOpportunite = (o, avecContact) => `<article class="deal ${o.etape}" draggable="${!['gagne', 'perdu'].includes(o.etape)}" data-deal="${o.id}">
      <div class="deal-head"><strong>${h(o.titre)}</strong><button class="icon-btn" type="button" data-deal-edit="${o.id}" aria-label="Modifier l’opportunité">✎</button></div>
      ${avecContact ? `<small>${lienContact(o.client_id, h(o.entreprise || o.nom || o.email))}</small>` : ''}
      <div class="deal-meta"><span class="deal-amount">${o.montant_ht ? euros(o.montant_ht) : 'Montant à définir'}</span><span class="muted">${+o.probabilite} %</span></div>
      ${o.echeance && !['gagne', 'perdu'].includes(o.etape) ? `<small>Signature visée : ${echeanceTxt(o.echeance)}</small>` : ''}
      ${o.etape === 'perdu' && o.raison_perte ? `<small class="muted">Raison : ${h(o.raison_perte)}</small>` : ''}
      <select class="select select-sm" data-deal-etape="${o.id}" aria-label="Étape de l’opportunité">${Object.keys(ETAPE_LIB).map((k) => `<option value="${k}"${k === o.etape ? ' selected' : ''}>${ETAPE_LIB[k]}</option>`).join('')}</select>
    </article>`;

  /* ================================================================ Vues administration */
  const rdvRow = (r) => `<tr><td>${h(fmtDay(r.date))}<br><small class="muted">${h(r.heure)}</small></td><td><strong>${h(r.nom)}</strong><br><small class="muted">${h(r.email)}${r.telephone ? ` · ${h(r.telephone)}` : ''}</small></td><td>${h(r.service)}</td><td>${badge(r.statut)}</td>
    <td class="actions"><select class="select select-sm" data-rdv-statut="${r.id}" aria-label="Statut du rendez-vous">${['confirme', 'termine', 'annule'].map((s) => `<option value="${s}"${s === r.statut ? ' selected' : ''}>${STATUTS[s]}</option>`).join('')}</select>${r.projet_id ? `<button class="btn btn-outline btn-sm" type="button" data-open-projet="${r.projet_id}">Projet</button>` : ''}</td></tr>`;

  const adminViews = {
    dashboard: { title: 'Tableau de bord', render() {
      const k = data.kpis;
      const fi = data.finances;
      const finances = fi ? `<h2 class="dash-title">Chiffres</h2><div class="kpis">
          <a class="card kpi" href="#factures"><h3>Encaissé ce mois</h3><strong>${euros(fi.encaisse_mois)}</strong>${variation(fi.encaisse_mois, fi.encaisse_mois_prec)}</a>
          <a class="card kpi" href="#factures"><h3>À encaisser</h3><strong>${euros(fi.a_encaisser)}</strong><span>${fi.factures_a_payer} facture(s) en attente</span></a>
          <a class="card kpi${fi.factures_en_retard ? ' kpi-alert' : ''}" href="#factures"><h3>En retard</h3><strong>${euros(fi.en_retard)}</strong><span class="${fi.factures_en_retard ? 'hot' : ''}">${fi.factures_en_retard ? `${fi.factures_en_retard} facture(s) à relancer` : 'Aucun retard'}</span></a>
          <a class="card kpi" href="#boutique"><h3>Boutique ce mois</h3><strong>${euros(fi.boutique_mois)}</strong><span>${fi.commandes_mois} commande(s) payée(s)</span></a>
        </div>
        <div class="panels">
          <div class="card panel panel-wide"><div class="panel-head"><h2>Encaissements des 12 derniers mois</h2><a class="link-arrow" href="#factures">Factures</a></div>${graphiqueEncaissements(data.serie_encaissements)}</div>
          <div class="card panel"><h2>Activité récente</h2>${data.activite?.length ? `<ul class="row-list activity">${data.activite.map((a) => `<li>${icone(a.type)}<div class="grow">${phraseActivite(a)}</div><a class="muted when" href="#${h(a.lien)}">${h(depuis(a.quand))}</a></li>`).join('')}</ul>` : empty('Aucune activité pour le moment.')}</div>
          <div class="card panel"><div class="panel-head"><h2>À faire en priorité</h2><a class="link-arrow" href="#taches">Mes tâches</a></div>
            ${data.crm?.taches_du_jour?.length ? `<ul class="task-list">${data.crm.taches_du_jour.map((t) => ligneTache(t)).join('')}</ul>` : ''}
            <ul class="row-list">
            ${(data.factures_en_retard || []).map((f) => `<li>${icone('relance')}<div class="grow"><strong>${h(f.numero)} · ${h(f.entreprise || f.nom || f.email)}</strong><small class="muted">${euros(f.montant_ttc)} · en retard de ${+f.retard} j</small></div><a class="link-arrow" href="#factures">Relancer</a></li>`).join('')}
            ${k.demandes_a_traiter ? `<li>${icone('demande')}<div class="grow"><strong>${k.demandes_a_traiter} demande(s) de contact</strong><small class="muted">En attente de réponse</small></div><a class="link-arrow" href="#demandes">Ouvrir</a></li>` : ''}
            ${data.messages.length ? `<li>${icone('message')}<div class="grow"><strong>Messages clients</strong><small class="muted">Dernier : ${h(data.messages[0].nom || data.messages[0].email)} · ${h(depuis(data.messages[0].cree_le))}</small></div><a class="link-arrow" href="#projets">Voir</a></li>` : ''}
            ${!(data.factures_en_retard || []).length && !k.demandes_a_traiter && !data.messages.length && !data.crm?.taches_du_jour?.length ? `<li><div class="grow muted">Rien d’urgent. Tout est à jour ✅</div></li>` : ''}
          </ul>
          ${data.top_clients?.length ? `<h2 class="sub">Meilleurs clients ${new Date().getFullYear()}</h2><ul class="row-list">${data.top_clients.map((c, i) => `<li><span class="rank">${i + 1}</span><div class="grow"><strong>${h(c.entreprise || c.nom || c.email)}</strong><small class="muted">${c.n} facture(s) payée(s)</small></div><strong>${euros(c.total)}</strong></li>`).join('')}</ul>` : ''}
          </div>
        </div><h2 class="dash-title">Activité commerciale</h2>` : '';
      return `${finances}<div class="kpis kpis-5">
          <a class="card kpi" href="#rdv"><h3>Rendez-vous à venir</h3><strong>${k.rdv_a_venir}</strong><span class="hot">Voir l’agenda</span></a>
          <a class="card kpi" href="#demandes"><h3>Demandes à traiter</h3><strong>${k.demandes_a_traiter}</strong><span class="hot">Formulaire de contact</span></a>
          <a class="card kpi" href="#projets"><h3>Projets actifs</h3><strong>${k.projets_actifs}</strong><span>Nouveaux, en cours, en pause</span></a>
          ${data.crm ? `<a class="card kpi" href="#pipeline"><h3>Pipeline en cours</h3><strong class="kpi-small">${euros(data.crm.pipeline.total)}</strong><span>${data.crm.pipeline.n} affaire(s) · ${euros(data.crm.pipeline.pondere)} pondéré</span></a>` : `<a class="card kpi" href="#clients"><h3>Espaces clients</h3><strong>${k.clients}</strong><span>Comptes avec accès</span></a>`}
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
    clients: { title: 'Contacts', async load() { await adminList('clients', '/api/admin/clients'); }, render() {
      const rows = cache.clients?.clients || [];
      const tags = [...new Set(rows.flatMap((c) => (c.etiquettes || '').split(',').filter(Boolean)))].sort();
      const n = (st) => rows.filter((c) => c.statut === st).length;
      const visibles = filtreContacts(rows, crmFiltre);
      return `<div class="kpis">
          <div class="card kpi"><h3>Prospects</h3><strong>${n('prospect')}</strong><span>À convertir</span></div>
          <div class="card kpi"><h3>Clients</h3><strong>${n('client')}</strong><span>${rows.filter((c) => c.acces_premium).length} avec espace client</span></div>
          <div class="card kpi"><h3>CA encaissé total</h3><strong class="kpi-small">${euros(rows.reduce((t, c) => t + c.ca, 0))}</strong><span>Toutes factures payées</span></div>
          <div class="card kpi"><h3>À relancer</h3><strong>${rows.filter((c) => c.statut === 'prospect' && c.dernier_contact && (Date.now() - new Date(`${c.dernier_contact.replace(' ', 'T')}Z`)) > 30 * 864e5).length}</strong><span>Prospects sans contact depuis 30 j</span></div>
        </div>
        <div class="card panel">
          <div class="panel-head"><h2>Contacts <small class="muted" data-crm-count>${visibles.length} / ${rows.length}</small></h2>
            <div class="actions"><a class="btn btn-outline btn-sm" href="/api/admin/crm/export" download>Exporter (Excel)</a><button class="btn btn-outline btn-sm" type="button" data-new-client>Accès espace client</button><button class="btn btn-primary btn-sm" type="button" data-new-contact>+ Nouveau contact</button></div></div>
          <div class="crm-filters">
            <input class="input" type="search" placeholder="Rechercher un nom, une entreprise, un email, une ville…" value="${h(crmFiltre.q)}" data-crm-q aria-label="Rechercher un contact">
            <select class="select" data-crm-statut aria-label="Filtrer par statut"><option value="">Tous les statuts</option>${Object.entries(STATUT_CONTACT).map(([k, v]) => `<option value="${k}"${crmFiltre.statut === k ? ' selected' : ''}>${v}</option>`).join('')}</select>
            <select class="select" data-crm-tag aria-label="Filtrer par étiquette"><option value="">Toutes les étiquettes</option>${tags.map((t) => `<option${crmFiltre.tag === t ? ' selected' : ''}>${h(t)}</option>`).join('')}</select>
          </div>
          <div class="table-wrap"><table class="table crm-table"><thead><tr><th>Contact</th><th>Statut</th><th>Étiquettes</th><th class="num">CA encaissé</th><th class="num">Opportunités</th><th class="num">Tâches</th><th>Dernier contact</th><th></th></tr></thead><tbody data-crm-rows>${tableContacts(visibles)}</tbody></table></div>
        </div>`;
    } },
    contact: { title: 'Fiche contact', menu: 'clients', async load() { [cache.fiche] = await Promise.all([api(`/api/admin/crm/fiche?id=${encodeURIComponent(routeParam)}`), cache.entreprises ? null : adminList('entreprises', '/api/admin/crm/entreprises')]); }, render() {
      const d = cache.fiche; const c = d.client;
      titleEl.textContent = c.nom || c.entreprise || c.email;
      const ca = d.factures.filter((f) => f.statut === 'payee').reduce((t, f) => t + f.montant_ttc, 0);
      const aPayer = d.factures.filter((f) => f.statut === 'a_payer').reduce((t, f) => t + f.montant_ttc, 0);
      const ouvertes = d.opportunites.filter((o) => !['gagne', 'perdu'].includes(o.etape));
      const tachesOuvertes = d.taches.filter((t) => !t.faite);
      const champ = (name, label, val, type = 'text') => `<div><label class="field-label" for="fc-${name}">${label}</label><input class="input" id="fc-${name}" name="${name}" type="${type}" value="${h(val || '')}"></div>`;
      return `<div class="card panel contact-head">
          <div class="contact-id"><span class="avatar">${h(initials(c.nom || c.entreprise || c.email))}</span>
            <div><h2>${h(c.nom || c.email)}</h2><p class="muted">${h(c.poste || '')}${c.poste && c.entreprise ? ' · ' : ''}${d.entreprise ? `<a class="contact-link" href="#entreprise/${d.entreprise.id}">${h(d.entreprise.nom)}</a>` : h(c.entreprise || (c.poste ? '' : 'Entreprise non renseignée'))}</p>
              <p class="contact-tags">${statutContact(c.statut)} ${chips(c.etiquettes)} ${c.source ? `<small class="muted">Source : ${h(SOURCE_CONTACT[c.source] || c.source)}</small>` : ''}</p></div></div>
          <div class="contact-actions">
            <a class="btn btn-outline btn-sm" href="mailto:${h(c.email)}">✉ Écrire</a>
            ${c.telephone ? `<a class="btn btn-outline btn-sm" href="tel:${h(c.telephone.replace(/\s/g, ''))}">✆ Appeler</a>` : ''}
            <button class="btn btn-outline btn-sm" type="button" data-new-tache="${c.id}">+ Tâche</button>
            <button class="btn btn-outline btn-sm" type="button" data-new-deal="${c.id}">+ Opportunité</button>
            <button class="btn btn-primary btn-sm" type="button" data-new-devis data-client="${c.id}">+ Devis</button>
            <button class="btn btn-outline btn-sm" type="button" data-new-facture data-email="${h(c.email)}" data-nom="${h(c.entreprise || c.nom || '')}">+ Facture</button>
            <button class="btn btn-outline btn-sm" type="button" data-new-projet-contact>+ Projet</button>
            ${c.acces_premium ? `<button class="btn btn-outline btn-sm" type="button" data-acces="provisoire" data-id="${c.id}">Nouveau mot de passe</button><button class="btn btn-outline btn-sm" type="button" data-acces="desactiver" data-id="${c.id}">Couper l’espace client</button>` : `<button class="btn btn-primary btn-sm" type="button" data-acces="provisoire" data-id="${c.id}">Ouvrir l’espace client</button>`}
          </div>
        </div>
        <div class="kpis">
          <div class="card kpi"><h3>CA encaissé</h3><strong class="kpi-small">${euros(ca)}</strong><span>${d.factures.filter((f) => f.statut === 'payee').length} facture(s) payée(s)</span></div>
          <div class="card kpi${aPayer ? ' kpi-alert' : ''}"><h3>À payer</h3><strong class="kpi-small">${euros(aPayer)}</strong><span>${d.factures.filter((f) => f.statut === 'a_payer').length} facture(s)</span></div>
          <div class="card kpi"><h3>Opportunités en cours</h3><strong class="kpi-small">${euros(ouvertes.reduce((t, o) => t + o.montant_ht, 0))}</strong><span>${ouvertes.length} affaire(s) HT</span></div>
          <div class="card kpi"><h3>Dernier contact</h3><strong class="kpi-small">${h(depuis(c.dernier_contact || c.cree_le))}</strong><span>Contact créé le ${h(fmtSql(c.cree_le))}</span></div>
        </div>
        <div class="contact-grid">
          <div class="card panel">
            <h2>Historique des échanges</h2>
            <form class="note-form" data-note-form="${c.id}">
              <div class="note-types">${Object.entries(NOTE_LIB).map(([k, v], i) => `<label><input type="radio" name="type" value="${k}"${i ? '' : ' checked'}> ${v}</label>`).join('')}</div>
              <textarea class="input" name="contenu" rows="3" placeholder="Compte rendu d’appel, email envoyé, décision prise…" required></textarea>
              <div class="note-foot"><button class="btn btn-primary btn-sm" type="submit">Ajouter à l’historique</button></div>
            </form>
            ${timelineContact(d)}
          </div>
          <div class="contact-side">
            <div class="card panel"><div class="panel-head"><h2>Tâches</h2><button class="link-btn" type="button" data-new-tache="${c.id}">+ Ajouter</button></div>
              ${d.taches.length ? `<ul class="task-list">${[...tachesOuvertes, ...d.taches.filter((t) => t.faite).slice(0, 5)].map((t) => ligneTache(t, false)).join('')}</ul>` : empty('Aucune tâche.')}</div>
            <div class="card panel"><div class="panel-head"><h2>Opportunités</h2><button class="link-btn" type="button" data-new-deal="${c.id}">+ Ajouter</button></div>
              ${d.opportunites.length ? `<div class="deal-list">${d.opportunites.map((o) => carteOpportunite(o, false)).join('')}</div>` : empty('Aucune opportunité.')}</div>
            ${d.collegues.length ? `<div class="card panel"><h2>Collègues chez ${h(d.entreprise.nom)}</h2><ul class="row-list">${d.collegues.map((x) => `<li><span class="avatar avatar-sm">${h(initials(x.nom || x.email))}</span><div class="grow">${lienContact(x.id, `<strong>${h(x.nom || x.email)}</strong>`)}<small class="muted">${h(x.poste || x.email)}</small></div>${statutContact(x.statut)}</li>`).join('')}</ul></div>` : ''}
            <div class="card panel"><h2>Devis, factures et projets</h2><ul class="row-list">
              ${d.devis.map((v) => `<li><div class="grow"><strong>${h(v.numero)} · ${euros(v.montant_ht)} HT</strong><small class="muted">${h(v.objet)}</small></div>${statutDevis(v)}<a class="link-arrow" href="/devis?t=${encodeURIComponent(v.jeton)}" target="_blank" rel="noopener">Voir</a></li>`).join('')}
              ${d.factures.map((f) => `<li><div class="grow"><strong>${h(f.numero)} · ${euros(f.montant_ttc)}</strong><small class="muted">${h(f.objet)}</small></div>${statutFacture(f)}<a class="link-arrow" href="/facture?t=${encodeURIComponent(f.jeton)}" target="_blank" rel="noopener">Voir</a></li>`).join('')}
              ${d.projets.map((pr) => `<li><div class="grow"><strong>${h(pr.titre)}</strong><small class="muted">Projet · ${+pr.avancement} %</small></div>${badge(pr.statut)}<button class="link-btn" type="button" data-open-projet="${pr.id}">Ouvrir</button></li>`).join('')}
              ${!d.factures.length && !d.projets.length && !d.devis.length ? `<li><div class="grow muted">Aucun devis, facture ni projet.</div></li>` : ''}
            </ul></div>
            <form class="card panel form-grid" data-contact-form="${c.id}">
              <h2>Informations</h2>
              <div class="two">${champ('nom', 'Nom', c.nom)}${champ('poste', 'Fonction', c.poste)}</div>
              <div><label class="field-label" for="fc-entreprise">Entreprise</label><input class="input" id="fc-entreprise" name="entreprise" value="${h(c.entreprise || '')}" list="liste-entreprises" autocomplete="off"><small class="form-note">Choisissez une entreprise existante ou tapez un nouveau nom : la fiche entreprise est créée automatiquement.</small></div>
              <datalist id="liste-entreprises">${(cache.entreprises?.entreprises || []).map((x) => `<option value="${h(x.nom)}">`).join('')}</datalist>
              <div><label class="field-label" for="fc-email">Email</label><input class="input" id="fc-email" value="${h(c.email)}" disabled></div>
              <div class="two">${champ('telephone', 'Téléphone', c.telephone, 'tel')}${champ('site_web', 'Site web', c.site_web)}</div>
              ${champ('adresse', 'Adresse', c.adresse)}
              <div class="two">${champ('ville', 'Ville', c.ville)}${champ('pays', 'Pays', c.pays)}</div>
              <div class="two">
                <div><label class="field-label" for="fc-statut">Statut</label><select class="select" id="fc-statut" name="statut">${Object.entries(STATUT_CONTACT).map(([k, v]) => `<option value="${k}"${c.statut === k ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
                <div><label class="field-label" for="fc-source">Source</label><select class="select" id="fc-source" name="source"><option value="">Inconnue</option>${Object.entries(SOURCE_CONTACT).map(([k, v]) => `<option value="${k}"${c.source === k ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
              </div>
              ${champ('etiquettes', 'Étiquettes (séparées par des virgules)', c.etiquettes)}
              <div><button class="btn btn-primary btn-sm" type="submit">Enregistrer</button></div>
            </form>
          </div>
        </div>`;
    } },
    pipeline: { title: 'Pipeline commercial', async load() { await Promise.all([adminList('pipeline', '/api/admin/crm/pipeline'), assureContacts()]); }, render() {
      const d = cache.pipeline; const rows = d.opportunites;
      const ouvertes = rows.filter((o) => !['gagne', 'perdu'].includes(o.etape));
      const gagnees = rows.filter((o) => o.etape === 'gagne'); const perdues = rows.filter((o) => o.etape === 'perdu');
      const mois = aujourdhui().slice(0, 7);
      const taux = gagnees.length + perdues.length ? Math.round((gagnees.length / (gagnees.length + perdues.length)) * 100) : null;
      const col = (etape) => {
        const list = rows.filter((o) => o.etape === etape);
        return `<section class="kanban-col" data-col="${etape}"><header><h3>${ETAPE_LIB[etape]} <span class="count-pill">${list.length}</span></h3><small class="muted">${euros(list.reduce((t, o) => t + o.montant_ht, 0))} HT</small></header>
          <div class="kanban-cards">${list.map((o) => carteOpportunite(o, true)).join('') || '<p class="kanban-empty">Déposez une carte ici</p>'}</div></section>`;
      };
      return `<div class="kpis">
          <div class="card kpi"><h3>En cours</h3><strong class="kpi-small">${euros(ouvertes.reduce((t, o) => t + o.montant_ht, 0))}</strong><span>${ouvertes.length} opportunité(s) HT</span></div>
          <div class="card kpi"><h3>Prévision pondérée</h3><strong class="kpi-small">${euros(ouvertes.reduce((t, o) => t + Math.round(o.montant_ht * o.probabilite / 100), 0))}</strong><span>Montant × probabilité</span></div>
          <div class="card kpi"><h3>Gagné ce mois</h3><strong class="kpi-small">${euros(gagnees.filter((o) => (o.cloture_le || '').startsWith(mois)).reduce((t, o) => t + o.montant_ht, 0))}</strong><span>${gagnees.filter((o) => (o.cloture_le || '').startsWith(mois)).length} affaire(s)</span></div>
          <div class="card kpi"><h3>Taux de réussite</h3><strong>${taux === null ? '—' : `${taux} %`}</strong><span>Gagnées / clôturées (90 j)</span></div>
        </div>
        <div class="card panel"><div class="panel-head"><h2>Vos affaires</h2><button class="btn btn-primary btn-sm" type="button" data-new-deal>+ Nouvelle opportunité</button></div>
          <p class="form-note">Glissez une carte d’une colonne à l’autre (ou changez son étape dans la liste). Une affaire gagnée fait passer le contact en client.</p>
          <div class="kanban">${Object.keys(ETAPE_LIB).map(col).join('')}</div></div>`;
    } },
    taches: { title: 'Tâches', async load() { await Promise.all([adminList('taches', '/api/admin/crm/taches'), assureContacts()]); }, render() {
      const rows = cache.taches.taches; const t = aujourdhui();
      const ouvertes = rows.filter((x) => !x.faite);
      const groupes = [
        ['En retard', ouvertes.filter((x) => x.echeance && x.echeance < t)],
        ['Aujourd’hui', ouvertes.filter((x) => x.echeance === t)],
        ['À venir', ouvertes.filter((x) => x.echeance && x.echeance > t)],
        ['Sans date', ouvertes.filter((x) => !x.echeance)],
        ['Terminées (30 derniers jours)', rows.filter((x) => x.faite)],
      ];
      return `<form class="card panel task-add" data-tache-form>
          <input class="input" name="titre" placeholder="Nouvelle tâche : rappeler, envoyer un devis, relancer…" required aria-label="Nouvelle tâche">
          <select class="select" name="client_id" aria-label="Contact lié"><option value="">Aucun contact</option>${optionsContacts()}</select>
          <input class="input" name="echeance" type="date" value="${t}" aria-label="Échéance">
          <label class="checkline"><input type="checkbox" name="haute"> Prioritaire</label>
          <button class="btn btn-primary" type="submit">Ajouter</button>
        </form>
        ${groupes.map(([titre, list], i) => (list.length || i < 2 ? `<div class="card panel"><h2>${titre} <span class="count-pill${i === 0 && list.length ? ' late' : ''}">${list.length}</span></h2>${list.length ? `<ul class="task-list">${list.map((x) => ligneTache(x)).join('')}</ul>` : empty(i === 0 ? 'Aucun retard 👍' : 'Rien de prévu aujourd’hui.')}</div>` : '')).join('')}`;
    } },
    entreprises: { title: 'Entreprises', async load() { await adminList('entreprises', '/api/admin/crm/entreprises'); }, render() {
      const rows = cache.entreprises.entreprises;
      const q = (crmFiltre.qe || '').toLowerCase();
      const visibles = rows.filter((e) => !q || [e.nom, e.ville, e.secteur, e.siret, e.etiquettes].some((v) => (v || '').toLowerCase().includes(q)));
      return `<div class="card panel"><div class="panel-head"><h2>Entreprises <small class="muted">${visibles.length} / ${rows.length}</small></h2><button class="btn btn-primary btn-sm" type="button" data-new-entreprise>+ Nouvelle entreprise</button></div>
          <div class="crm-filters crm-filters-1"><input class="input" type="search" placeholder="Rechercher une entreprise, une ville, un secteur…" value="${h(crmFiltre.qe || '')}" data-ent-q aria-label="Rechercher une entreprise"></div>
          ${visibles.length ? `<div class="table-wrap"><table class="table crm-table"><thead><tr><th>Entreprise</th><th>Statut</th><th class="num">Contacts</th><th class="num">CA encaissé</th><th class="num">Affaires en cours</th><th>Dernier contact</th><th></th></tr></thead><tbody>
            ${visibles.map((e) => `<tr><td><a class="contact-link" href="#entreprise/${e.id}"><strong>${h(e.nom)}</strong></a><br><small class="muted">${h([e.secteur, e.ville, e.taille ? `${e.taille} salariés` : ''].filter(Boolean).join(' · '))}</small></td>
              <td>${statutContact(e.statut || 'prospect')}</td><td class="num">${+e.nb_contacts}</td><td class="num">${e.ca ? euros(e.ca) : '<span class="muted">—</span>'}</td>
              <td class="num">${e.montant_opportunites ? euros(e.montant_opportunites) : '<span class="muted">—</span>'}</td><td><small>${h(depuis(e.dernier_contact || e.cree_le))}</small></td>
              <td><a class="btn btn-outline btn-sm" href="#entreprise/${e.id}">Ouvrir</a></td></tr>`).join('')}</tbody></table></div>` : empty('Aucune entreprise. Elles se créent aussi automatiquement quand vous renseignez l’entreprise d’un contact.')}</div>`;
    } },
    entreprise: { title: 'Fiche entreprise', menu: 'entreprises', async load() { cache.fent = await api(`/api/admin/crm/entreprise?id=${encodeURIComponent(routeParam)}`); }, render() {
      const d = cache.fent; const e = d.entreprise;
      titleEl.textContent = e.nom;
      const ca = d.factures.filter((f) => f.statut === 'payee').reduce((t, f) => t + f.montant_ttc, 0);
      const aPayer = d.factures.filter((f) => f.statut === 'a_payer').reduce((t, f) => t + f.montant_ttc, 0);
      const ouvertes = d.opportunites.filter((o) => !['gagne', 'perdu'].includes(o.etape));
      const champ = (name, label, val) => `<div><label class="field-label" for="fe-${name}">${label}</label><input class="input" id="fe-${name}" name="${name}" value="${h(val || '')}"></div>`;
      return `<div class="card panel contact-head">
          <div class="contact-id"><span class="avatar avatar-square">${h(initials(e.nom))}</span>
            <div><h2>${h(e.nom)}</h2><p class="muted">${h([e.secteur, e.taille ? `${e.taille} salariés` : '', [e.code_postal, e.ville].filter(Boolean).join(' ')].filter(Boolean).join(' · ') || 'Informations à compléter')}</p>
              <p class="contact-tags">${chips(e.etiquettes)} ${e.site_web ? `<a href="${h(/^https?:/.test(e.site_web) ? e.site_web : `https://${e.site_web}`)}" target="_blank" rel="noopener noreferrer">${h(e.site_web)}</a>` : ''}</p></div></div>
          <div class="contact-actions"><button class="btn btn-outline btn-sm" type="button" data-new-contact data-entreprise="${h(e.nom)}">+ Contact</button></div>
        </div>
        <div class="kpis">
          <div class="card kpi"><h3>CA encaissé</h3><strong class="kpi-small">${euros(ca)}</strong><span>Tous contacts confondus</span></div>
          <div class="card kpi${aPayer ? ' kpi-alert' : ''}"><h3>À payer</h3><strong class="kpi-small">${euros(aPayer)}</strong><span>${d.factures.filter((f) => f.statut === 'a_payer').length} facture(s)</span></div>
          <div class="card kpi"><h3>Affaires en cours</h3><strong class="kpi-small">${euros(ouvertes.reduce((t, o) => t + o.montant_ht, 0))}</strong><span>${ouvertes.length} opportunité(s) HT</span></div>
          <div class="card kpi"><h3>Contacts</h3><strong>${d.contacts.length}</strong><span>Interlocuteurs</span></div>
        </div>
        <div class="contact-grid">
          <div class="contact-side">
            <div class="card panel"><h2>Interlocuteurs</h2>${d.contacts.length ? `<ul class="row-list">${d.contacts.map((c) => `<li><span class="avatar avatar-sm">${h(initials(c.nom || c.email))}</span><div class="grow">${lienContact(c.id, `<strong>${h(c.nom || c.email)}</strong>`)}<small class="muted">${h([c.poste, c.email, c.telephone].filter(Boolean).join(' · '))}</small></div>${statutContact(c.statut)}</li>`).join('')}</ul>` : empty('Aucun contact rattaché.')}</div>
            <div class="card panel"><h2>Opportunités</h2>${d.opportunites.length ? `<div class="deal-list">${d.opportunites.map((o) => carteOpportunite(o, true)).join('')}</div>` : empty('Aucune opportunité.')}</div>
            <div class="card panel"><h2>Derniers échanges</h2>${d.notes.length ? `<ol class="timeline">${d.notes.slice(0, 15).map((n) => `<li>${icone('message')}<div class="grow"><div class="tl-head"><strong>${h(NOTE_LIB[n.type] || 'Note')} · ${lienContact(n.client_id, h(n.nom || ''))}</strong><small class="muted">${h(depuis(n.cree_le))}</small></div><p>${h(n.contenu).replace(/\n/g, '<br>')}</p></div></li>`).join('')}</ol>` : empty('Aucune note.')}</div>
          </div>
          <div class="contact-side">
            <div class="card panel"><h2>Devis et factures</h2><ul class="row-list">
              ${d.devis.map((v) => `<li><div class="grow"><strong>${h(v.numero)} · ${euros(v.montant_ht)} HT</strong><small class="muted">${h(v.objet)} · ${h(v.nom || '')}</small></div>${statutDevis(v)}<a class="link-arrow" href="/devis?t=${encodeURIComponent(v.jeton)}" target="_blank" rel="noopener">Voir</a></li>`).join('')}
              ${d.factures.map((f) => `<li><div class="grow"><strong>${h(f.numero)} · ${euros(f.montant_ttc)}</strong><small class="muted">${h(f.objet)} · ${h(f.nom || '')}</small></div>${statutFacture(f)}<a class="link-arrow" href="/facture?t=${encodeURIComponent(f.jeton)}" target="_blank" rel="noopener">Voir</a></li>`).join('')}
              ${!d.devis.length && !d.factures.length ? '<li><div class="grow muted">Aucun document.</div></li>' : ''}</ul></div>
            <form class="card panel form-grid" data-entreprise-form="${e.id}">
              <h2>Informations légales</h2>
              ${champ('nom', 'Raison sociale', e.nom)}
              <div class="two">${champ('siret', 'SIRET', e.siret)}${champ('tva_intracom', 'N° TVA intracommunautaire', e.tva_intracom)}</div>
              ${champ('adresse', 'Adresse', e.adresse)}
              <div class="two">${champ('code_postal', 'Code postal', e.code_postal)}${champ('ville', 'Ville', e.ville)}</div>
              <div class="two">${champ('pays', 'Pays', e.pays)}${champ('site_web', 'Site web', e.site_web)}</div>
              <div class="two">${champ('secteur', 'Secteur d’activité', e.secteur)}<div><label class="field-label" for="fe-taille">Effectif</label><select class="select" id="fe-taille" name="taille"><option value="">Inconnu</option>${d.tailles.map((x) => `<option${x === e.taille ? ' selected' : ''}>${x}</option>`).join('')}</select></div></div>
              ${champ('etiquettes', 'Étiquettes', e.etiquettes)}
              <p class="form-note">Ces informations apparaissent sur les devis et factures de tous ses contacts.</p>
              <div><button class="btn btn-primary btn-sm" type="submit">Enregistrer</button></div>
            </form>
          </div>
        </div>`;
    } },
    devis: { title: 'Devis', async load() { await Promise.all([adminList('devis', '/api/admin/devis'), assureContacts()]); }, render() {
      const d = cache.devis; const rows = d.devis; const today = d.aujourdhui; const mois = today.slice(0, 7);
      const enAttente = rows.filter((x) => x.statut === 'envoye' && x.valide_jusqu >= today);
      const acceptes = rows.filter((x) => ['accepte', 'facture'].includes(x.statut));
      const decides = rows.filter((x) => ['accepte', 'facture', 'refuse', 'expire'].includes(x.statut) || (x.statut === 'envoye' && x.valide_jusqu < today));
      const aFacturer = rows.filter((x) => x.statut === 'accepte');
      const act = (x) => `<select class="select select-sm" data-devis-action="${x.id}" aria-label="Actions sur ${h(x.numero)}"><option value="">Actions…</option>
        <option value="voir">Voir le devis</option>
        ${x.statut === 'envoye' ? '<option value="renvoyer">Renvoyer au client</option><option value="annuler">Annuler</option>' : ''}
        ${x.statut === 'accepte' ? '<option value="facturer">Facturer (solde)</option>' : ''}
        <option value="dupliquer">Dupliquer</option></select>`;
      return `<div class="kpis">
          <div class="card kpi"><h3>En attente de réponse</h3><strong class="kpi-small">${euros(enAttente.reduce((t, x) => t + x.montant_ht, 0))}</strong><span>${enAttente.length} devis HT</span></div>
          <div class="card kpi"><h3>Acceptés ce mois</h3><strong class="kpi-small">${euros(acceptes.filter((x) => (x.accepte_le || '').startsWith(mois)).reduce((t, x) => t + x.montant_ht, 0))}</strong><span>${acceptes.filter((x) => (x.accepte_le || '').startsWith(mois)).length} devis HT</span></div>
          <div class="card kpi"><h3>Taux d’acceptation</h3><strong>${decides.length ? `${Math.round((acceptes.length / decides.length) * 100)} %` : '—'}</strong><span>Sur les devis clos</span></div>
          <div class="card kpi${aFacturer.length ? ' kpi-alert' : ''}"><h3>À facturer</h3><strong>${aFacturer.length}</strong><span>Devis acceptés sans facture de solde</span></div>
        </div>
        <div class="card panel"><div class="panel-head"><h2>Devis</h2><button class="btn btn-primary btn-sm" type="button" data-new-devis>+ Nouveau devis</button></div>
          <p class="form-note">Le client reçoit un lien pour consulter le devis, l’accepter en un clic (« bon pour accord ») ou le refuser. S’il y a un acompte, sa facture est créée aussitôt et le client est dirigé vers le paiement.</p>
          ${rows.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Devis</th><th>Client</th><th class="num">Montant HT</th><th>Validité</th><th>Statut</th><th></th></tr></thead><tbody>
            ${rows.map((x) => `<tr><td><strong>${h(x.numero)}</strong><br><small class="muted">${h(x.objet)}</small></td><td>${lienContact(x.client_id, h(x.entreprise || x.nom || x.email))}${x.entreprise && x.nom ? `<br><small class="muted">${h(x.nom)}</small>` : ''}</td>
              <td class="num">${euros(x.montant_ht)}${x.acompte_pct ? `<br><small class="muted">acompte ${+x.acompte_pct} %</small>` : ''}</td><td><small>${h(fmtDay(x.valide_jusqu))}</small></td>
              <td>${statutDevis(x)}${x.accepte_par ? `<br><small class="muted">par ${h(x.accepte_par)}</small>` : ''}${x.raison_refus ? `<br><small class="muted">${h(x.raison_refus)}</small>` : ''}</td><td>${act(x)}</td></tr>`).join('')}
          </tbody></table></div>` : empty('Aucun devis pour le moment.')}</div>`;
    } },
    factures: { title: 'Factures', async load() { await adminList('factures', '/api/admin/factures'); }, render() {
      const d = cache.factures; const rows = d.factures; const today = d.aujourdhui;
      const aPayer = rows.filter((f) => f.statut === 'a_payer');
      const retard = aPayer.filter((f) => f.echeance < today);
      const mois = today.slice(0, 7);
      const encaisse = rows.filter((f) => f.statut === 'payee' && (f.payee_le || '').startsWith(mois)).reduce((t, f) => t + f.montant_ttc, 0);
      const fa = d.facturation;
      const alertes = [
        !fa.siret || !fa.adresse ? 'Complétez vos mentions légales (adresse, SIRET) dans « Mentions légales et paiement » avant d’envoyer une facture : elles sont obligatoires.' : '',
        !Number(fa.taux_tva) && !fa.mention_tva ? 'TVA à 0 % sans mention : si vous êtes en franchise, indiquez « TVA non applicable, art. 293 B du CGI ».' : '',
        !d.paiement ? 'Paiement par carte non activé (clés Stripe absentes) : vos factures proposent le virement uniquement.' : '',
      ].filter(Boolean);
      const act = (f) => `<select class="select select-sm" data-facture-action="${f.id}" aria-label="Actions sur ${h(f.numero)}"><option value="">Actions…</option>
        <option value="voir">Voir la facture</option>
        ${f.statut === 'a_payer' ? `<option value="payee">Marquer payée</option><option value="relancer">Relancer maintenant</option><option value="renvoyer">Renvoyer la facture</option>
        <option value="${f.relances_actives ? 'relances_off' : 'relances_on'}">${f.relances_actives ? 'Suspendre les relances auto' : 'Réactiver les relances auto'}</option><option value="annuler">Annuler la facture</option>` : ''}</select>`;
      const r = d.regles;
      return `${alertes.map((a) => `<p class="warn-box">${h(a)}</p>`).join('')}
        <div class="kpis">
          <div class="card kpi"><h3>À encaisser</h3><strong class="kpi-small">${euros(aPayer.reduce((t, f) => t + f.montant_ttc, 0))}</strong><span>${aPayer.length} facture(s)</span></div>
          <div class="card kpi"><h3>En retard</h3><strong class="kpi-small">${euros(retard.reduce((t, f) => t + f.montant_ttc, 0))}</strong><span class="hot">${retard.length} facture(s)</span></div>
          <div class="card kpi"><h3>Encaissé ce mois</h3><strong class="kpi-small">${euros(encaisse)}</strong><span>factures payées</span></div>
          <div class="card kpi"><h3>Relances auto</h3><strong class="kpi-small">${r.actives ? 'Actives' : 'En pause'}</strong><span>${r.etapes.map((e) => `J+${e.jours}`).join(' · ')}</span></div>
        </div>
        <div class="card panel"><div class="panel-head"><h2>Factures</h2><button class="btn btn-primary btn-sm" type="button" data-new-facture>+ Nouvelle facture</button></div>
          ${rows.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Facture</th><th>Client</th><th class="num">Montant TTC</th><th>Échéance</th><th>Statut</th><th>Relances</th><th></th></tr></thead><tbody>
          ${rows.map((f) => `<tr><td><strong>${h(f.numero)}</strong><br><small class="muted">${h(f.objet)}</small></td><td>${h(f.nom || '')}<br><small class="muted">${h(f.email)}</small></td><td class="num">${euros(f.montant_ttc)}</td>
            <td>${h(fmtDay(f.echeance))}${f.statut === 'a_payer' && f.echeance < today ? `<br><small class="hot">+${Math.round((new Date(today) - new Date(f.echeance)) / 864e5)} j</small>` : ''}</td>
            <td>${statutFacture(f, today)}${f.mode_paiement ? `<br><small class="muted">${h(f.mode_paiement)}</small>` : ''}</td>
            <td><small>${+f.nb_relances}${f.derniere_relance ? ` · ${h(fmtSql(f.derniere_relance))}` : ''}${f.statut === 'a_payer' && !f.relances_actives ? '<br>suspendues' : ''}</small></td><td class="actions">${act(f)}</td></tr>`).join('')}
          </tbody></table></div>` : empty('Aucune facture. Créez la première : le client la reçoit par email avec un bouton de paiement.')}</div>
        <form class="card panel settings-form" data-regles>
          <h2>Relances automatiques</h2>
          <p class="form-note">Chaque matin, les factures en retard reçoivent l’étape atteinte (une seule à la fois). Les relances s’arrêtent dès que la facture est payée. Variables : {numero}, {montant}, {echeance}, {retard}.</p>
          <label class="checkline"><input type="checkbox" name="actives" ${r.actives ? 'checked' : ''}> Relances automatiques activées</label>
          <div class="regles-grid">${r.etapes.map((e, i) => `<div class="regle"><div><label class="field-label" for="rj${i}">Jours après échéance</label><input class="input" id="rj${i}" name="jours${i}" type="number" min="1" max="120" value="${+e.jours}"></div>
            <div class="form-grid"><div><label class="field-label" for="rn${i}">Nom de l’étape</label><input class="input" id="rn${i}" name="nom${i}" value="${h(e.nom)}"></div>
            <div><label class="field-label" for="rs${i}">Objet de l’email</label><input class="input" id="rs${i}" name="sujet${i}" value="${h(e.sujet)}"></div>
            <div><label class="field-label" for="rm${i}">Message</label><textarea class="textarea" id="rm${i}" name="message${i}">${h(e.message)}</textarea></div></div></div>`).join('')}</div>
          <div><button class="btn btn-primary" type="submit">Enregistrer le calendrier</button></div>
        </form>
        <form class="card panel settings-form" data-facturation>
          <h2>Mentions légales et paiement</h2>
          <p class="form-note">Ces informations apparaissent sur chaque facture. Les factures déjà émises affichent les mentions en vigueur au moment de leur consultation.</p>
          <div class="form-grid">
            <div class="two"><div><label class="field-label" for="fa-rs">Raison sociale</label><input class="input" id="fa-rs" name="raison_sociale" value="${h(fa.raison_sociale)}"></div>
              <div><label class="field-label" for="fa-siret">SIRET</label><input class="input" id="fa-siret" name="siret" value="${h(fa.siret)}"></div></div>
            <div><label class="field-label" for="fa-adr">Adresse</label><textarea class="textarea" id="fa-adr" name="adresse" rows="2">${h(fa.adresse)}</textarea></div>
            <div class="two"><div><label class="field-label" for="fa-tva">Taux de TVA par défaut (%)</label><input class="input" id="fa-tva" name="taux_tva" inputmode="decimal" value="${h(fa.taux_tva)}"></div>
              <div><label class="field-label" for="fa-tvai">N° de TVA intracommunautaire</label><input class="input" id="fa-tvai" name="tva_intracom" value="${h(fa.tva_intracom)}"></div></div>
            <div><label class="field-label" for="fa-mtva">Mention TVA (si TVA à 0 %)</label><input class="input" id="fa-mtva" name="mention_tva" value="${h(fa.mention_tva)}" placeholder="TVA non applicable, art. 293 B du CGI"></div>
            <div class="two"><div><label class="field-label" for="fa-iban">IBAN (virement)</label><input class="input" id="fa-iban" name="iban" value="${h(fa.iban)}"></div>
              <div><label class="field-label" for="fa-bic">BIC</label><input class="input" id="fa-bic" name="bic" value="${h(fa.bic)}"></div></div>
            <div><label class="field-label" for="fa-delai">Délai de paiement (jours)</label><input class="input" id="fa-delai" name="delai_paiement" type="number" min="0" max="60" value="${+fa.delai_paiement}"></div>
            <div><label class="field-label" for="fa-cond">Conditions de paiement et pénalités</label><textarea class="textarea" id="fa-cond" name="conditions" rows="3">${h(fa.conditions)}</textarea></div>
            <div><button class="btn btn-primary" type="submit">Enregistrer</button></div>
          </div>
        </form>`;
    } },
    boutique: { title: 'Boutique', async load() { await adminList('boutique', '/api/admin/boutique'); }, render() {
      const d = cache.boutique; const t = Number(d.taux_tva) || 0;
      return `${!d.paiement ? '<p class="warn-box">Paiement par carte non activé : ajoutez les clés Stripe (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET) dans Cloudflare. En attendant, la boutique reste en « Demander un devis ».</p>' : ''}
        <div class="card panel"><h2>Produits</h2><p class="form-note">Un produit avec un prix et « Vente en ligne » cochée affiche les boutons « Acheter » et « Ajouter au panier ». Sans prix, il reste sur devis. TVA appliquée : ${String(t).replace('.', ',')} % (réglable dans Factures).</p>
          <div class="table-wrap"><table class="table"><thead><tr><th>Produit</th><th>Prix HT (€)</th><th>Vente en ligne</th><th></th></tr></thead><tbody>
          ${d.produits.map((p) => `<tr data-produit-row="${h(p.id)}"><td><strong>${h(p.nom)}</strong></td><td><input class="input" name="prix_ht" inputmode="decimal" style="max-width:130px" value="${p.prix_ht ? (p.prix_ht / 100).toFixed(2).replace('.', ',') : ''}" placeholder="Sur devis" aria-label="Prix HT de ${h(p.nom)}"></td>
            <td><label class="checkline"><input type="checkbox" name="achat_en_ligne" ${p.achat_en_ligne ? 'checked' : ''}> En vente</label></td><td><button class="btn btn-outline btn-sm" type="button" data-produit-save="${h(p.id)}">Enregistrer</button></td></tr>`).join('')}
          </tbody></table></div></div>
        <div class="card panel"><h2>Commandes</h2>${d.commandes.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Commande</th><th>Client</th><th>Contenu</th><th class="num">Total TTC</th><th>Statut</th><th>Facture</th></tr></thead><tbody>
          ${d.commandes.map((c) => `<tr><td><strong>${h(c.reference)}</strong><br><small class="muted">${h(fmtSql(c.cree_le))}</small></td><td>${h(c.email || '—')}</td><td><small>${c.lignes.map((l) => `${+l.quantite} × ${h(l.nom)}`).join('<br>')}</small></td><td class="num">${euros(c.montant_ttc)}</td>
            <td><span class="status status-${h(c.statut)}">${h({ payee: 'Payée', en_attente: 'Paiement en cours', expiree: 'Abandonnée', echouee: 'Paiement refusé', remboursee: 'Remboursée' }[c.statut] || c.statut)}</span></td><td>${h(c.facture || '')}</td></tr>`).join('')}
          </tbody></table></div>` : empty('Aucune commande pour le moment.')}</div>`;
    } },
    compte: { title: 'Mon compte', async load() { cache.totp = await api('/api/auth/totp/statut'); }, render() {
      const t = cache.totp || {};
      return `<div class="card panel"><h2>Administrateur</h2><p class="muted">Connecté en tant que <strong>${h(data.moi || '')}</strong>. Par sécurité, la session administrateur dure 12 heures.</p></div>
        <div class="card panel"><h2>Double authentification</h2>
          <p>${t.actif ? '<span class="status status-premium">Activée</span>' : '<span class="status status-provisoire">Non activée</span>'} · Codes de secours restants : <strong>${+t.codes_restants || 0}</strong></p>
          <form class="settings-form" data-codes-form>
            <p class="form-note">Générer de nouveaux codes de secours annule les anciens. Saisissez le code à 6 chiffres de votre application pour confirmer.</p>
            <div class="inline-form"><label class="sr-only" for="r-code">Code à 6 chiffres</label><input class="input input-code" id="r-code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456" required><button class="btn btn-outline" type="submit">Nouveaux codes de secours</button></div>
            <ul class="codes-secours" data-codes-new hidden></ul>
          </form>
        </div>${formMotDePasse()}`;
    } },
    journal: { title: 'Journal', async load() { await adminList('journal', '/api/admin/journal'); }, render() {
      const rows = cache.journal?.journal || [];
      return `<div class="card panel"><p class="form-note">Les actions réalisées dans l’administration (conservées 12 mois) : connexions, accès clients, projets, rendez-vous, messages.</p>${rows.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Administrateur</th><th>Action</th><th>Concerne</th></tr></thead><tbody>${rows.map((r) => `<tr><td><small>${h(fmtSql(r.cree_le))}</small></td><td><small>${h(r.email)}</small></td><td><strong>${h(r.action)}</strong>${r.details ? `<br><small class="muted">${h(r.details)}</small>` : ''}</td><td><small>${h(r.cible || '')}</small></td></tr>`).join('')}</tbody></table></div>` : empty('Aucune action enregistrée.')}</div>`;
    } },
    assistant: { title: 'Assistant IA', async load() { await adminList('assistant', '/api/admin/assistant'); }, render() {
      const rows = cache.assistant?.messages || [];
      return `<div class="card panel"><p class="form-note">Les questions posées par les visiteurs à l’assistant du site. Idéal pour repérer des besoins et enrichir vos pages.</p>${rows.length ? `<ul class="qa-list">${rows.map((m) => `<li><div class="qa-q"><span>Question</span>${h(m.question)}</div><div class="qa-a"><span>Réponse</span>${h(m.reponse || '').replace(/\n/g, '<br>')}</div><small class="muted">${h(fmtSql(m.cree_le))}${m.page ? ` · page ${h(m.page)}` : ''}</small></li>`).join('')}</ul>` : empty('Aucune question pour le moment.')}</div>`;
    } },
  };

  const views = espace === 'client' ? clientViews : adminViews;
  let routeParam = '';

  /* ---------- Rendu et navigation ---------- */
  async function render() {
    let [key, param] = location.hash.slice(1).split('/');
    if (!views[key]) key = 'dashboard';
    routeParam = param || '';
    const view = views[key];
    links.forEach((l) => l.classList.toggle('is-active', l.dataset.viewLink === (view.menu || key)));
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
    const nbTaches = data.crm?.taches_du_jour?.length;
    const tb = $('[data-count="taches"]');
    if (tb) { tb.hidden = !nbTaches; tb.textContent = nbTaches; }
  }

  function handleError(e) {
    if (e.code === 'mdp_a_changer') return showChange();
    if (e.code === 'totp_a_configurer') return showTotp();
    if (e.status === 401 || e.status === 403) return screen('login');
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
    if (form.matches('[data-regles]')) {
      e.preventDefault();
      const etapes = cache.factures.regles.etapes.map((x, i) => ({ jours: form[`jours${i}`].value, nom: form[`nom${i}`].value, sujet: form[`sujet${i}`].value, message: form[`message${i}`].value }));
      try { const res = await api('/api/admin/facturation', { regles: { actives: form.actives.checked, etapes } }); toast(res.message); await views.factures.load(); await render(); } catch (err) { toast(err.message); }
      return;
    }
    if (form.matches('[data-facturation]')) {
      e.preventDefault();
      const facturation = Object.fromEntries(new FormData(form));
      try { const res = await api('/api/admin/facturation', { facturation }); toast(res.message); await views.factures.load(); await render(); } catch (err) { toast(err.message); }
      return;
    }
    if (form.matches('[data-codes-form]')) {
      e.preventDefault();
      try {
        const res = await api('/api/auth/totp/codes', { code: form.code.value.trim() });
        form.reset();
        const ul = $('[data-codes-new]', form);
        ul.innerHTML = res.codes_secours.map((c) => `<li><code>${h(c)}</code></li>`).join('');
        ul.hidden = false;
        toast('Nouveaux codes générés : conservez-les, les anciens ne fonctionnent plus');
      } catch (ex) { toast(ex.message); }
      return;
    }
    if (form.matches('[data-mdp-changer]')) {
      e.preventDefault();
      const err = checkNouveau(form.nouveau.value, form.confirmation.value);
      if (err) return toast(err);
      try {
        const res = await api('/api/auth/changer', { actuel: form.actuel.value, nouveau: form.nouveau.value });
        form.reset(); toast(res.message);
      } catch (ex) { toast(ex.message); }
      return;
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
    const fa = e.target.closest('[data-facture-action]');
    if (!fa || !fa.value) return;
    const f = cache.factures.factures.find((x) => x.id === +fa.dataset.factureAction);
    const action = fa.value; fa.value = '';
    if (action === 'voir') return window.open(`/facture?t=${encodeURIComponent(f.jeton)}`, '_blank', 'noopener');
    let mode;
    if (action === 'payee') {
      mode = prompt(`Mode de paiement de ${f.numero} (virement, carte, cheque, especes, autre) :`, 'virement');
      if (!mode) return;
    }
    const q = { annuler: `Annuler la facture ${f.numero} ? Elle reste numérotée et visible, mais n’est plus à payer.`, relancer: `Envoyer une relance maintenant à ${f.email} ?`, renvoyer: `Renvoyer la facture ${f.numero} à ${f.email} ?` }[action];
    if (q && !confirm(q)) return;
    try {
      const res = await api('/api/admin/facture/action', { id: f.id, action, mode: mode && mode.trim().toLowerCase() });
      toast(res.message); await views.factures.load(); await render();
    } catch (err) { toast(err.message); }
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
    if (e.target.closest('[data-new-client]')) return newClient();
    const nf = e.target.closest('[data-new-facture]');
    if (nf) return newFacture({ email: nf.dataset.email, nom: nf.dataset.nom });
    const nct = e.target.closest('[data-new-contact]');
    if (nct) return newContact({ entreprise: nct.dataset.entreprise });
    if (e.target.closest('[data-new-entreprise]')) return newEntreprise();
    const ndv = e.target.closest('[data-new-devis]');
    if (ndv) return newDevis({ client_id: ndv.dataset.client });
    const nt = e.target.closest('[data-new-tache]');
    if (nt) return newTache({ client_id: nt.dataset.newTache });
    const nd = e.target.closest('[data-new-deal]');
    if (nd) return dealForm({ client_id: nd.dataset.newDeal });
    const de = e.target.closest('[data-deal-edit]');
    if (de) return dealForm((cache.pipeline?.opportunites || cache.fiche?.opportunites || []).find((o) => o.id === +de.dataset.dealEdit) || cache.fiche?.opportunites.find((o) => o.id === +de.dataset.dealEdit));
    if (e.target.closest('[data-new-projet-contact]')) { const c = cache.fiche.client; return newProjet({ email: c.email, nom: c.nom || c.entreprise }); }
    const ts = e.target.closest('[data-tache-suppr]');
    if (ts) { if (!confirm('Supprimer cette tâche ?')) return; return crmAction('/api/admin/crm/tache', { id: +ts.dataset.tacheSuppr, supprimer: true }); }
    const ns = e.target.closest('[data-note-suppr]');
    if (ns) { if (!confirm('Supprimer cette note de l’historique ?')) return; return crmAction('/api/admin/crm/note', { id: +ns.dataset.noteSuppr, supprimer: true }); }
    const ps = e.target.closest('[data-produit-save]');
    if (ps) {
      const tr = ps.closest('tr');
      try {
        const res = await api('/api/admin/produit', { id: ps.dataset.produitSave, prix_ht: tr.querySelector('[name=prix_ht]').value, achat_en_ligne: tr.querySelector('[name=achat_en_ligne]').checked });
        toast(res.message); await views.boutique.load(); await render();
      } catch (err) { toast(err.message); }
      return;
    }

    const ac = e.target.closest('[data-acces]');
    if (ac) {
      const c = cache.fiche?.client?.id === +ac.dataset.id ? cache.fiche.client : cache.clients.clients.find((x) => x.id === +ac.dataset.id);
      const action = ac.dataset.acces;
      const question = action === 'desactiver'
        ? `Désactiver l’accès de ${c.email} ? Le client sera déconnecté et ne pourra plus se connecter.`
        : c.acces_premium ? `Créer un nouveau mot de passe provisoire pour ${c.email} ? L’ancien ne fonctionnera plus et le client le recevra par email.` : `Donner l’accès premium à ${c.email} ? Ses identifiants lui seront envoyés par email.`;
      if (!confirm(question)) return;
      try {
        const res = await api('/api/admin/client/acces', { id: c.id, action });
        if (res.mot_de_passe_provisoire) showProvisoire(res.email, res.mot_de_passe_provisoire, res.email_envoye);
        else toast(res.message);
        await render();
      } catch (err) { toast(err.message); }
      return;
    }
    const cp = e.target.closest('[data-copy]');
    if (cp) {
      try { await navigator.clipboard.writeText(cp.dataset.copy); toast('Copié'); } catch { toast('Sélectionnez le mot de passe pour le copier'); }
      return;
    }
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


  /* ---------- CRM : actions ---------- */
  async function crmAction(path, body, { recharger = true } = {}) {
    try {
      const res = await api(path, body);
      if (res.message) toast(res.message);
      if (recharger) { await load().catch(() => {}); await render(); }
      return res;
    } catch (err) { toast(err.message); return null; }
  }
  // Recherche et filtres de la liste des contacts, sans recharger la page (le curseur reste dans le champ)
  const rafraichirContacts = () => {
    const rows = cache.clients?.clients || [];
    const visibles = filtreContacts(rows, crmFiltre);
    const tb = $('[data-crm-rows]'); if (tb) tb.innerHTML = tableContacts(visibles);
    const cnt = $('[data-crm-count]'); if (cnt) cnt.textContent = `${visibles.length} / ${rows.length}`;
  };
  root.addEventListener('input', (e) => {
    if (e.target.matches('[data-crm-q]')) { crmFiltre.q = e.target.value.trim(); rafraichirContacts(); }
    if (e.target.matches('[data-ent-q]')) {
      crmFiltre.qe = e.target.value;
      const pos = e.target.selectionStart;
      root.innerHTML = views.entreprises.render();
      const champ = $('[data-ent-q]'); champ.focus(); champ.setSelectionRange(pos, pos);
    }
  });
  root.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.matches('[data-crm-statut]')) { crmFiltre.statut = t.value; return rafraichirContacts(); }
    if (t.matches('[data-crm-tag]')) { crmFiltre.tag = t.value; return rafraichirContacts(); }
    if (t.matches('[data-tache-faite]')) return crmAction('/api/admin/crm/tache', { id: +t.dataset.tacheFaite, faite: t.checked });
    if (t.matches('[data-deal-etape]')) return changerEtape(+t.dataset.dealEtape, t.value, () => render());
    if (t.matches('[data-devis-action]')) {
      const x = cache.devis.devis.find((v) => v.id === +t.dataset.devisAction);
      const action = t.value; t.value = '';
      if (!action) return;
      if (action === 'voir') return window.open(`/devis?t=${encodeURIComponent(x.jeton)}`, '_blank', 'noopener');
      const q = { renvoyer: `Renvoyer le devis ${x.numero} à ${x.email} ?`, annuler: `Annuler le devis ${x.numero} ? Le client ne pourra plus l’accepter.`, facturer: `Créer la facture de solde du devis ${x.numero} et l’envoyer au client ? Les acomptes déjà facturés seront déduits.`, dupliquer: `Créer un nouveau devis à partir de ${x.numero} ? Il ne sera pas envoyé tout de suite.` }[action];
      if (q && !confirm(q)) return;
      return crmAction('/api/admin/devis/action', { id: x.id, action });
    }
  });
  async function changerEtape(id, etape, annuler) {
    let raison;
    if (etape === 'perdu') {
      raison = prompt('Pourquoi cette affaire est-elle perdue ? (prix, délai, concurrent, pas de réponse…)', '');
      if (raison === null) { annuler?.(); return; }
    }
    await crmAction('/api/admin/crm/opportunite', { id, etape, raison_perte: raison });
  }
  root.addEventListener('submit', async (e) => {
    const f = e.target;
    if (f.matches('[data-note-form]')) {
      e.preventDefault();
      await crmAction('/api/admin/crm/note', { client_id: +f.dataset.noteForm, type: f.type.value, contenu: f.contenu.value });
    }
    if (f.matches('[data-contact-form]')) {
      e.preventDefault();
      await crmAction('/api/admin/crm/contact', { id: +f.dataset.contactForm, ...Object.fromEntries(new FormData(f)) });
    }
    if (f.matches('[data-entreprise-form]')) {
      e.preventDefault();
      const res = await crmAction('/api/admin/crm/entreprise', { id: +f.dataset.entrepriseForm, ...Object.fromEntries(new FormData(f)) }, { recharger: false });
      if (res) { delete cache.entreprises; await render(); }
    }
    if (f.matches('[data-tache-form]')) {
      e.preventDefault();
      await crmAction('/api/admin/crm/tache', { titre: f.titre.value, client_id: f.client_id.value, echeance: f.echeance.value, priorite: f.haute.checked ? 'haute' : 'normale' });
    }
  });
  // Pipeline : glisser-déposer une carte dans une autre colonne
  let dealGlisse = null;
  root.addEventListener('dragstart', (e) => {
    const card = e.target.closest?.('[data-deal]');
    if (!card) return;
    dealGlisse = +card.dataset.deal; card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(dealGlisse));
  });
  root.addEventListener('dragend', (e) => { e.target.closest?.('[data-deal]')?.classList.remove('dragging'); $$('.kanban-col.over').forEach((c) => c.classList.remove('over')); });
  root.addEventListener('dragover', (e) => {
    const col = e.target.closest?.('[data-col]');
    if (!col || !dealGlisse) return;
    e.preventDefault();
    $$('.kanban-col.over').forEach((c) => c !== col && c.classList.remove('over'));
    col.classList.add('over');
  });
  root.addEventListener('drop', async (e) => {
    const col = e.target.closest?.('[data-col]');
    if (!col || !dealGlisse) return;
    e.preventDefault();
    const id = dealGlisse; dealGlisse = null;
    const o = cache.pipeline?.opportunites.find((x) => x.id === id);
    if (o && o.etape !== col.dataset.col) await changerEtape(id, col.dataset.col, () => render());
    else render();
  });

  async function newContact(pre = {}) {
    if (!cache.entreprises) { try { await adminList('entreprises', '/api/admin/crm/entreprises'); } catch { /* suggestions facultatives */ } }
    openModal(`<h2 id="modal-title">Nouveau contact</h2>
      <form class="form-grid" data-contact-creer>
        <div class="two"><div><label class="field-label" for="nc-nom">Nom complet</label><input class="input" id="nc-nom" name="nom" required></div>
          <div><label class="field-label" for="nc-email">Email</label><input class="input" id="nc-email" name="email" type="email" required></div></div>
        <div class="two"><div><label class="field-label" for="nc-ent">Entreprise</label><input class="input" id="nc-ent" name="entreprise" list="nc-entreprises" autocomplete="off" value="${h(pre.entreprise || '')}"><datalist id="nc-entreprises">${(cache.entreprises?.entreprises || []).map((x) => `<option value="${h(x.nom)}">`).join('')}</datalist></div>
          <div><label class="field-label" for="nc-tel">Téléphone</label><input class="input" id="nc-tel" name="telephone" type="tel"></div></div>
        <div class="two"><div><label class="field-label" for="nc-statut">Statut</label><select class="select" id="nc-statut" name="statut">${Object.entries(STATUT_CONTACT).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
          <div><label class="field-label" for="nc-source">Source</label><select class="select" id="nc-source" name="source"><option value="">Inconnue</option>${Object.entries(SOURCE_CONTACT).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div></div>
        <div><label class="field-label" for="nc-tags">Étiquettes</label><input class="input" id="nc-tags" name="etiquettes" placeholder="pme, ia, guinée"></div>
        <p class="form-msg err" data-nc-msg hidden></p>
        <div><button class="btn btn-primary" type="submit">Créer la fiche</button></div>
      </form>`);
    $('[data-contact-creer]').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = ev.currentTarget;
      try {
        const res = await api('/api/admin/crm/contact', Object.fromEntries(new FormData(f)));
        closeModal(); toast(res.message); delete cache.clients; delete cache.entreprises;
        location.hash = `#contact/${res.id}`;
      } catch (err) { say($('[data-nc-msg]', f), false, err.message); }
    });
  }

  async function newTache(pre = {}) {
    await assureContacts();
    openModal(`<h2 id="modal-title">Nouvelle tâche</h2>
      <form class="form-grid" data-tache-creer>
        <div><label class="field-label" for="nt-titre">À faire</label><input class="input" id="nt-titre" name="titre" required placeholder="Rappeler pour le devis, envoyer la proposition…"></div>
        <div class="two"><div><label class="field-label" for="nt-client">Contact</label><select class="select" id="nt-client" name="client_id"><option value="">Aucun</option>${optionsContacts(pre.client_id)}</select></div>
          <div><label class="field-label" for="nt-ech">Échéance</label><input class="input" id="nt-ech" name="echeance" type="date" value="${new Date(Date.now() + 864e5).toISOString().slice(0, 10)}"></div></div>
        <label class="checkline"><input type="checkbox" name="haute"> Prioritaire</label>
        <div><button class="btn btn-primary" type="submit">Ajouter la tâche</button></div>
      </form>`);
    $('[data-tache-creer]').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = ev.currentTarget;
      closeModal();
      await crmAction('/api/admin/crm/tache', { titre: f.titre.value, client_id: f.client_id.value, echeance: f.echeance.value, priorite: f.haute.checked ? 'haute' : 'normale' });
    });
  }

  async function dealForm(o = {}) {
    await assureContacts();
    const edition = Boolean(o.id);
    openModal(`<h2 id="modal-title">${edition ? 'Modifier l’opportunité' : 'Nouvelle opportunité'}</h2>
      <form class="form-grid" data-deal-form>
        <div><label class="field-label" for="nd-titre">Affaire</label><input class="input" id="nd-titre" name="titre" required value="${h(o.titre || '')}" placeholder="Ex. : Assistant IA interne, 5 utilisateurs"></div>
        ${edition ? '' : `<div><label class="field-label" for="nd-client">Contact</label><select class="select" id="nd-client" name="client_id" required><option value="">Choisir…</option>${optionsContacts(o.client_id)}</select></div>`}
        <div class="two"><div><label class="field-label" for="nd-montant">Montant HT (€)</label><input class="input" id="nd-montant" name="montant" inputmode="decimal" value="${o.montant_ht ? (o.montant_ht / 100).toString().replace('.', ',') : ''}"></div>
          <div><label class="field-label" for="nd-etape">Étape</label><select class="select" id="nd-etape" name="etape">${Object.entries(ETAPE_LIB).map(([k, v]) => `<option value="${k}"${(o.etape || 'nouveau') === k ? ' selected' : ''}>${v}</option>`).join('')}</select></div></div>
        <div class="two"><div><label class="field-label" for="nd-proba">Probabilité (%)</label><input class="input" id="nd-proba" name="probabilite" type="number" min="0" max="100" value="${o.id ? +o.probabilite : ''}" placeholder="Selon l’étape"></div>
          <div><label class="field-label" for="nd-ech">Signature visée</label><input class="input" id="nd-ech" name="echeance" type="date" value="${h(o.echeance || '')}"></div></div>
        <p class="form-msg err" data-nd-msg hidden></p>
        <div class="actions"><button class="btn btn-primary" type="submit">${edition ? 'Enregistrer' : 'Créer l’opportunité'}</button>${edition ? '<button class="btn btn-outline" type="button" data-deal-delete>Supprimer</button>' : ''}</div>
      </form>`);
    const f = $('[data-deal-form]');
    $('[data-deal-delete]', f)?.addEventListener('click', async () => {
      if (!confirm('Supprimer définitivement cette opportunité ?')) return;
      closeModal(); await crmAction('/api/admin/crm/opportunite', { id: o.id, supprimer: true });
    });
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const body = Object.fromEntries(new FormData(f));
      if (edition) body.id = o.id;
      if (body.etape === 'perdu' && o.etape !== 'perdu') { const r = prompt('Pourquoi cette affaire est-elle perdue ?', ''); if (r === null) return; body.raison_perte = r; }
      try { const res = await api('/api/admin/crm/opportunite', body); closeModal(); toast(res.message); await render(); } catch (err) { say($('[data-nd-msg]', f), false, err.message); }
    });
  }


  function newEntreprise() {
    openModal(`<h2 id="modal-title">Nouvelle entreprise</h2>
      <form class="form-grid" data-ent-creer>
        <div><label class="field-label" for="ne-nom">Raison sociale</label><input class="input" id="ne-nom" name="nom" required></div>
        <div class="two"><div><label class="field-label" for="ne-ville">Ville</label><input class="input" id="ne-ville" name="ville"></div>
          <div><label class="field-label" for="ne-secteur">Secteur d’activité</label><input class="input" id="ne-secteur" name="secteur" placeholder="BTP, santé, commerce…"></div></div>
        <div><label class="field-label" for="ne-siret">SIRET (facultatif)</label><input class="input" id="ne-siret" name="siret" inputmode="numeric"></div>
        <p class="form-msg err" data-ne-msg hidden></p>
        <div><button class="btn btn-primary" type="submit">Créer la fiche</button></div>
      </form>`);
    $('[data-ent-creer]').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = ev.currentTarget;
      try {
        const res = await api('/api/admin/crm/entreprise', Object.fromEntries(new FormData(f)));
        closeModal(); toast(res.message); delete cache.entreprises;
        location.hash = `#entreprise/${res.id}`;
      } catch (err) { say($('[data-ne-msg]', f), false, err.message); }
    });
  }

  async function newDevis(pre = {}) {
    try { await Promise.all([cache.devis ? null : adminList('devis', '/api/admin/devis'), assureContacts()]); } catch (err) { return toast(err.message); }
    const d = cache.devis;
    const valide = new Date(Date.now() + d.validite * 864e5).toISOString().slice(0, 10);
    const opps = (cache.fiche?.client?.id === +pre.client_id ? cache.fiche.opportunites : []).filter((o) => !['gagne', 'perdu'].includes(o.etape));
    const ligne = () => '<div class="ligne"><input class="input" name="libelle" placeholder="Désignation" required aria-label="Désignation"><input class="input" name="quantite" type="number" min="1" value="1" aria-label="Quantité"><input class="input" name="prix_unitaire" inputmode="decimal" placeholder="Prix HT €" required aria-label="Prix unitaire HT"><button class="icon-btn" type="button" data-ligne-suppr aria-label="Supprimer la ligne">✕</button></div>';
    openModal(`<h2 id="modal-title">Nouveau devis</h2>
      <form class="form-grid" data-devis-creer>
        <div><label class="field-label" for="nd-client">Client</label><select class="select" id="nd-client" name="client_id"><option value="">Nouveau client…</option>${optionsContacts(pre.client_id)}</select></div>
        <div class="nouveau-client" data-nouveau-client ${pre.client_id ? 'hidden' : ''}>
          <div class="two"><div><label class="field-label" for="nd-email">Email</label><input class="input" id="nd-email" name="email" type="email"></div>
            <div><label class="field-label" for="nd-nom">Nom</label><input class="input" id="nd-nom" name="nom"></div></div>
          <div><label class="field-label" for="nd-ent">Entreprise</label><input class="input" id="nd-ent" name="entreprise"></div>
        </div>
        ${opps.length ? `<div><label class="field-label" for="nd-opp">Opportunité liée</label><select class="select" id="nd-opp" name="opportunite_id"><option value="">Nouvelle opportunité</option>${opps.map((o) => `<option value="${o.id}">${h(o.titre)}</option>`).join('')}</select></div>` : ''}
        <div><label class="field-label" for="nd-objet">Objet</label><input class="input" id="nd-objet" name="objet" required placeholder="Ex. : Assistant IA interne sur vos documents"></div>
        <div><span class="field-label">Lignes</span><div class="lignes-facture" data-lignes>${ligne()}</div><button class="link-btn" type="button" data-ligne-ajout>+ Ajouter une ligne</button></div>
        <div class="two"><div><label class="field-label" for="nd-tva">TVA (%)</label><input class="input" id="nd-tva" name="taux_tva" inputmode="decimal" value="${h(d.facturation.taux_tva)}"></div>
          <div><label class="field-label" for="nd-acompte">Acompte à la commande (%)</label><input class="input" id="nd-acompte" name="acompte_pct" type="number" min="0" max="100" step="5" value="30"></div></div>
        <div><label class="field-label" for="nd-valide">Valable jusqu’au</label><input class="input" id="nd-valide" name="valide_jusqu" type="date" value="${valide}" required></div>
        <div><label class="field-label" for="nd-cond">Conditions</label><textarea class="input" id="nd-cond" name="conditions" rows="3">${h(d.conditions)}</textarea></div>
        <label class="checkline"><input type="checkbox" name="envoyer" checked> Envoyer le devis au client par email maintenant</label>
        <p class="form-msg err" data-nd-msg hidden></p>
        <div><button class="btn btn-primary" type="submit">Créer le devis</button></div>
      </form>`);
    const form = $('[data-devis-creer]');
    form.client_id.addEventListener('change', () => { $('[data-nouveau-client]', form).hidden = Boolean(form.client_id.value); });
    form.addEventListener('click', (e) => {
      if (e.target.closest('[data-ligne-ajout]')) $('[data-lignes]', form).insertAdjacentHTML('beforeend', ligne());
      const sup = e.target.closest('[data-ligne-suppr]');
      if (sup && $$('.ligne', form).length > 1) sup.closest('.ligne').remove();
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const lignes = $$('.ligne', form).map((l) => ({ libelle: l.querySelector('[name=libelle]').value, quantite: l.querySelector('[name=quantite]').value, prix_unitaire: l.querySelector('[name=prix_unitaire]').value }));
      const btn = $('button[type=submit]', form); btn.disabled = true;
      try {
        const res = await api('/api/admin/devis/creer', {
          client_id: form.client_id.value, email: form.email.value, nom: form.nom.value, entreprise: form.entreprise.value,
          opportunite_id: form.opportunite_id?.value, objet: form.objet.value, lignes, taux_tva: form.taux_tva.value.replace(',', '.'),
          acompte_pct: form.acompte_pct.value, valide_jusqu: form.valide_jusqu.value, conditions: form.conditions.value, envoyer: form.envoyer.checked,
        });
        closeModal(); toast(res.message); delete cache.devis; delete cache.clients; await load().catch(() => {}); await render();
      } catch (err) { say($('[data-nd-msg]', form), false, err.message); btn.disabled = false; }
    });
  }

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
        <p class="form-note">Si le client a un accès premium, il verra ce projet dans son espace client.</p>
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

  function showProvisoire(email, mdp, envoye) {
    openModal(`<h2 id="modal-title">Accès premium prêt</h2>
      ${envoye
        ? `<p class="form-msg ok">Les identifiants ont été envoyés à <strong>${h(email)}</strong>, avec l’invitation à changer le mot de passe dans son espace.</p>`
        : `<p class="form-msg err">L’email n’a pas pu être envoyé : transmettez ces identifiants au client vous-même.</p>`}
      <p><strong>Identifiant :</strong> ${h(email)}</p>
      <div class="temp-pwd"><code>${h(mdp)}</code><button class="btn btn-outline btn-sm" type="button" data-copy="${h(mdp)}">Copier</button></div>
      <p class="form-note">Mot de passe provisoire, valable 7 jours. À sa première connexion, le client devra choisir son mot de passe personnel ; le provisoire cessera alors de fonctionner. Il ne sera plus affiché ici.</p>
      <button class="btn btn-primary" type="button" data-modal-close>Fermer</button>`);
    $$('[data-modal-close]', modal).forEach((b) => b.addEventListener('click', closeModal));
  }

  async function newFacture(pre = {}) {
    if (!cache.factures) { try { await views.factures.load(); } catch (err) { return toast(err.message); } }
    const fa = cache.factures.facturation;
    const ech = new Date(Date.now() + (Number(fa.delai_paiement) || 30) * 864e5).toISOString().slice(0, 10);
    const ligne = () => '<div class="ligne"><input class="input" name="libelle" placeholder="Désignation" required aria-label="Désignation"><input class="input" name="quantite" type="number" min="1" value="1" aria-label="Quantité"><input class="input" name="prix_unitaire" inputmode="decimal" placeholder="Prix HT €" required aria-label="Prix unitaire HT"><button class="icon-btn" type="button" data-ligne-suppr aria-label="Supprimer la ligne">✕</button></div>';
    openModal(`<h2 id="modal-title">Nouvelle facture</h2>
      <form class="form-grid" data-facture-creer>
        <div class="two"><div><label class="field-label" for="nf-email">Email du client</label><input class="input" id="nf-email" name="email" type="email" required list="nf-clients" value="${h(pre.email || '')}"></div>
          <div><label class="field-label" for="nf-nom">Nom ou entreprise</label><input class="input" id="nf-nom" name="nom" value="${h(pre.nom || '')}"></div></div>
        <datalist id="nf-clients">${(cache.clients?.clients || []).map((c) => `<option value="${h(c.email)}">${h(c.nom || '')}</option>`).join('')}</datalist>
        <div><label class="field-label" for="nf-objet">Objet</label><input class="input" id="nf-objet" name="objet" required placeholder="Ex. : Création du site vitrine, acompte 50 %"></div>
        <div><span class="field-label">Lignes</span><div class="lignes-facture" data-lignes>${ligne()}</div><button class="link-btn" type="button" data-ligne-ajout>+ Ajouter une ligne</button></div>
        <div class="two"><div><label class="field-label" for="nf-tva">TVA (%)</label><input class="input" id="nf-tva" name="taux_tva" inputmode="decimal" value="${h(fa.taux_tva)}"></div>
          <div><label class="field-label" for="nf-ech">Échéance</label><input class="input" id="nf-ech" name="echeance" type="date" value="${ech}" required></div></div>
        <label class="checkline"><input type="checkbox" name="relances" checked> Relances automatiques si impayée</label>
        <label class="checkline"><input type="checkbox" name="envoyer" checked> Envoyer la facture au client par email maintenant</label>
        <p class="form-msg err" data-nf-msg hidden></p>
        <div><button class="btn btn-primary" type="submit">Créer la facture</button></div>
      </form>`);
    const form = $('[data-facture-creer]');
    form.addEventListener('click', (e) => {
      if (e.target.closest('[data-ligne-ajout]')) $('[data-lignes]', form).insertAdjacentHTML('beforeend', ligne());
      const sup = e.target.closest('[data-ligne-suppr]');
      if (sup && $$('.ligne', form).length > 1) sup.closest('.ligne').remove();
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const lignes = $$('.ligne', form).map((l) => ({ libelle: l.querySelector('[name=libelle]').value, quantite: l.querySelector('[name=quantite]').value, prix_unitaire: l.querySelector('[name=prix_unitaire]').value }));
      const btn = $('button[type=submit]', form); btn.disabled = true;
      try {
        const res = await api('/api/admin/facture/creer', { email: form.email.value, nom: form.nom.value, objet: form.objet.value, lignes, taux_tva: form.taux_tva.value.replace(',', '.'), echeance: form.echeance.value, relances: form.relances.checked, envoyer: form.envoyer.checked });
        closeModal(); toast(res.message); delete cache.factures; await render();
      } catch (err) { say($('[data-nf-msg]', form), false, err.message); btn.disabled = false; }
    });
  }

  function newClient() {
    openModal(`<h2 id="modal-title">Nouveau client premium</h2>
      <form class="form-grid" data-client-creer>
        <div class="two">
          <div><label class="field-label" for="k-email">Email du client</label><input class="input" id="k-email" name="email" type="email" required></div>
          <div><label class="field-label" for="k-nom">Nom complet</label><input class="input" id="k-nom" name="nom"></div>
        </div>
        <div class="two">
          <div><label class="field-label" for="k-ent">Entreprise</label><input class="input" id="k-ent" name="entreprise"></div>
          <div><label class="field-label" for="k-tel">Téléphone</label><input class="input" id="k-tel" name="telephone"></div>
        </div>
        <label class="consent consent-light"><input type="checkbox" name="envoyer" checked> Envoyer ses identifiants au client par email, avec l’invitation à changer son mot de passe</label>
        <button class="btn btn-primary" type="submit">Créer l’accès</button>
      </form>`);
    $('[data-client-creer]').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = ev.currentTarget;
      try {
        const res = await api('/api/admin/client/creer', { email: f.email.value.trim(), nom: f.nom.value, entreprise: f.entreprise.value, telephone: f.telephone.value, envoyer_email: f.envoyer.checked });
        showProvisoire(res.email, res.mot_de_passe_provisoire, res.email_envoye);
        await load();
        if (location.hash !== '#clients') location.hash = '#clients'; else { await views.clients.load(); await render(); }
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
  function start() {
    return load().then(() => {
      screen('app');
      setUser();
      return render();
    }).catch((e) => {
      if (e.code === 'mdp_a_changer') return showChange();
      if (e.code === 'totp_a_configurer') return showTotp();
      screen('login');
      if (e.status !== 401 && e.status !== 403) say($('[data-login-msg]'), false, e.message);
    });
  }
  start();
})();
