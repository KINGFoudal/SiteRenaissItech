// Factures clients, relances automatiques des impayés, boutique en ligne et paiements Stripe.
//
// Administration  GET  /api/admin/factures            liste + réglages
//                 POST /api/admin/facture/creer       créer (et envoyer) une facture
//                 POST /api/admin/facture/action      payée, annuler, relancer, renvoyer, relances on/off
//                 POST /api/admin/facturation         réglages : calendrier des relances, mentions légales
//                 GET  /api/admin/boutique            produits + commandes
//                 POST /api/admin/produit             prix et vente en ligne d'un produit
// Public          GET  /api/facture?t=                facture consultable par son lien
//                 GET  /api/paiement/facture?t=       redirige vers le paiement Stripe (1 clic depuis l'email)
//                 GET  /api/boutique/catalogue        produits achetables en ligne
//                 POST /api/boutique/commande         panier → page de paiement Stripe
//                 GET  /api/paiement/statut?session=  état d'un paiement (page de confirmation)
//                 POST /api/stripe/webhook            confirmation des paiements par Stripe
// Tâche planifiée : relances() chaque matin

import {
  HttpError, json, clean, readJson, EMAIL_RE, esc, emailLayout, emailButton, emailTable,
  sendEmail, envoyerEmail, notifyEmail, siteUrl, upsertClient, randomToken, validDate, parisNow, requireDb,
} from './lib.js';
import { requireSession } from './auth.js';
import { journal } from './securite.js';
import { paiementActif, creerSessionPaiement, lireSession, verifierWebhook } from './stripe.js';

const int = (v) => Number.parseInt(v, 10);
const euros = (c) => `${(c / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const MODES = ['carte', 'virement', 'cheque', 'especes', 'autre'];

/* ---------------------------------------------------------------- réglages */

const REGLES_DEFAUT = {
  actives: true,
  etapes: [
    { niveau: 1, jours: 3, nom: 'Rappel courtois', sujet: 'Petit rappel : facture {numero}',
      message: 'Sauf erreur de notre part, la facture {numero} de {montant}, arrivée à échéance le {echeance}, n’a pas encore été réglée.\nSi le paiement est déjà parti, merci de ne pas tenir compte de ce message.' },
    { niveau: 2, jours: 10, nom: 'Relance ferme', sujet: 'Facture {numero} en attente de règlement',
      message: 'Malgré notre précédent rappel, la facture {numero} de {montant} reste impayée {retard} jours après son échéance.\nMerci de procéder au règlement dans les meilleurs délais. Nous restons disponibles si une difficulté se présente.' },
    { niveau: 3, jours: 20, nom: 'Dernier avis', sujet: 'Dernier avis : facture {numero}',
      message: 'La facture {numero} de {montant} est impayée depuis {retard} jours malgré nos relances.\nSans règlement ou prise de contact de votre part sous 8 jours, nous engagerons les démarches de recouvrement prévues par nos conditions générales.' },
  ],
};

// Mentions obligatoires d'une facture française : à compléter dans l'administration
const FACTURATION_DEFAUT = {
  raison_sociale: 'Renaissance iTech', adresse: '', siret: '', tva_intracom: '',
  taux_tva: 0, mention_tva: '', delai_paiement: 30, iban: '', bic: '',
  conditions: 'En cas de retard de paiement : pénalités au taux de 3 fois le taux d’intérêt légal et, pour les professionnels, indemnité forfaitaire de 40 € pour frais de recouvrement (art. L441-10 du Code de commerce). Pas d’escompte pour paiement anticipé.',
};

async function param(env, cle, defaut) {
  const row = await env.DB.prepare('SELECT valeur FROM parametres WHERE cle = ?').bind(cle).first();
  if (!row) return structuredClone(defaut);
  try { return { ...structuredClone(defaut), ...JSON.parse(row.valeur) }; } catch { return structuredClone(defaut); }
}
const setParam = (env, cle, valeur) => env.DB.prepare('INSERT INTO parametres (cle, valeur) VALUES (?, ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur')
  .bind(cle, JSON.stringify(valeur)).run();

// Numérotation continue et sans trou, par année : F-2026-0001, C-2026-0001
async function prochainNumero(env, prefixe) {
  const annee = parisNow().date.slice(0, 4);
  const row = await env.DB.prepare(`INSERT INTO parametres (cle, valeur) VALUES (?, '1')
    ON CONFLICT(cle) DO UPDATE SET valeur = CAST(valeur AS INTEGER) + 1 RETURNING valeur`).bind(`compteur:${prefixe}:${annee}`).first();
  return `${prefixe}-${annee}-${String(row.valeur).padStart(4, '0')}`;
}

const ajouterJours = (date, n) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const ecartJours = (a, b) => Math.round((new Date(`${a}T12:00:00Z`) - new Date(`${b}T12:00:00Z`)) / 86400000);
const dateFr = (s) => new Date(`${s}T12:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const base = (env, request) => (request ? siteUrl(env, request) : (env.SITE_URL || 'https://www.renaissance-itech.com'));

/* ---------------------------------------------------------------- emails */

const lienFacture = (b, f) => `${b}/facture?t=${encodeURIComponent(f.jeton)}`;
const lienPaiement = (b, f) => `${b}/api/paiement/facture?t=${encodeURIComponent(f.jeton)}`;

function blocPaiement(env, b, f, fact) {
  const boutons = paiementActif(env) ? emailButton(lienPaiement(b, f), `Payer ${euros(f.montant_ttc)} par carte`) : '';
  const virement = fact.iban ? `<p style="font-size:13px;color:#555">Ou par virement : IBAN ${esc(fact.iban)}${fact.bic ? ` · BIC ${esc(fact.bic)}` : ''}, en indiquant la référence ${esc(f.numero)}.</p>` : '';
  return `${boutons}${virement}<p style="font-size:13px"><a href="${esc(lienFacture(b, f))}">Voir et télécharger la facture</a></p>`;
}

// Renvoie { ok, erreur } : l'administrateur voit la raison d'un échec d'envoi
async function envoyerFacture(env, b, f, client) {
  const fact = await param(env, 'facturation', FACTURATION_DEFAUT);
  return envoyerEmail(env, {
    to: client.email, replyTo: notifyEmail(env),
    subject: `Facture ${f.numero} · ${fact.raison_sociale}`,
    html: emailLayout(`Bonjour${client.nom ? ` ${esc(client.nom)}` : ''}`, `<p>Veuillez trouver votre facture pour : <strong>${esc(f.objet)}</strong>.</p>
      ${emailTable([['Numéro', f.numero], ['Montant', euros(f.montant_ttc)], ['Échéance', dateFr(f.echeance)]])}
      ${blocPaiement(env, b, f, fact)}`),
  });
}

const remplir = (modele, f, retard) => modele
  .replaceAll('{numero}', f.numero).replaceAll('{montant}', euros(f.montant_ttc))
  .replaceAll('{echeance}', dateFr(f.echeance)).replaceAll('{retard}', String(retard));

async function envoyerRelance(env, b, f, etape, retard) {
  const fact = await param(env, 'facturation', FACTURATION_DEFAUT);
  const corps = remplir(etape.message, f, retard).split('\n').map((l) => `<p>${esc(l)}</p>`).join('');
  return sendEmail(env, {
    to: f.email, replyTo: notifyEmail(env),
    subject: remplir(etape.sujet, f, retard),
    html: emailLayout(`Bonjour${f.nom ? ` ${esc(f.nom)}` : ''}`, `${corps}${emailTable([['Facture', f.numero], ['Montant', euros(f.montant_ttc)], ['Échéance', dateFr(f.echeance)]])}
      ${blocPaiement(env, b, f, fact)}<p>Cordialement,<br>${esc(fact.raison_sociale)}</p>`),
  });
}

/* ---------------------------------------------------------------- relances automatiques (tâche planifiée) */

// Pour chaque facture en retard : envoie l'étape la plus avancée atteinte et pas encore envoyée.
// Une facture créée en retard ne reçoit donc pas trois emails d'un coup.
export async function relances(env, { aujourdhui = parisNow().date } = {}) {
  if (!env.DB) return { envoyees: 0 };
  const regles = await param(env, 'relances', REGLES_DEFAUT);
  if (!regles.actives) return { envoyees: 0 };
  const etapes = [...regles.etapes].sort((a, b) => a.jours - b.jours);
  const { results } = await env.DB.prepare(`SELECT f.*, c.email, c.nom,
      (SELECT MAX(niveau) FROM relances r WHERE r.facture_id = f.id AND r.niveau > 0) AS niveau_envoye
    FROM factures f JOIN clients c ON c.id = f.client_id
    WHERE f.statut = 'a_payer' AND f.relances_actives = 1 AND f.echeance < ?`).bind(aujourdhui).all();
  const b = base(env);
  const envoyees = [];
  for (const f of results) {
    const retard = ecartJours(aujourdhui, f.echeance);
    const etape = etapes.filter((e) => e.jours <= retard).pop();
    if (!etape || etape.niveau <= (f.niveau_envoye || 0)) continue;
    // On réserve d'abord la relance : si la tâche tourne deux fois, l'index unique bloque le doublon
    const { meta } = await env.DB.prepare('INSERT OR IGNORE INTO relances (facture_id, niveau, email) VALUES (?, ?, ?)').bind(f.id, etape.niveau, f.email).run();
    if (!meta.changes) continue;
    const ok = await envoyerRelance(env, b, f, etape, retard);
    // Envoi raté (Brevo indisponible…) : on libère la place pour réessayer à la prochaine exécution
    if (!ok) await env.DB.prepare('DELETE FROM relances WHERE facture_id = ? AND niveau = ?').bind(f.id, etape.niveau).run();
    envoyees.push(`${f.numero} · ${f.nom || f.email} · ${etape.nom}${ok ? '' : ' (échec d’envoi, nouvel essai demain)'}`);
  }
  if (envoyees.length) {
    await sendEmail(env, {
      to: notifyEmail(env), subject: `${envoyees.length} relance(s) de facture envoyée(s)`,
      html: emailLayout('Relances du jour', `<ul>${envoyees.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>${emailButton(`${b}/admin#factures`, 'Voir les factures')}`),
    });
  }
  return { envoyees: envoyees.length };
}

/* ---------------------------------------------------------------- administration : factures */

export async function adminFactures(request, env) {
  await requireSession(request, env, 'admin');
  const { results } = await env.DB.prepare(`SELECT f.id, f.numero, f.objet, f.montant_ht, f.taux_tva, f.montant_ttc, f.emise_le, f.echeance, f.statut,
      f.payee_le, f.mode_paiement, f.relances_actives, f.jeton, f.commande_id, c.id AS client_id, c.email, c.nom, c.entreprise,
      (SELECT COUNT(*) FROM relances r WHERE r.facture_id = f.id AND r.envoye = 1) AS nb_relances,
      (SELECT MAX(cree_le) FROM relances r WHERE r.facture_id = f.id AND r.envoye = 1) AS derniere_relance
    FROM factures f JOIN clients c ON c.id = f.client_id ORDER BY f.id DESC LIMIT 500`).all();
  const [regles, facturation] = await Promise.all([param(env, 'relances', REGLES_DEFAUT), param(env, 'facturation', FACTURATION_DEFAUT)]);
  return json({ factures: results, regles, facturation, paiement: paiementActif(env), aujourdhui: parisNow().date });
}

export async function adminFactureCreer(request, env, ctx) {
  const s = await requireSession(request, env, 'admin');
  const data = await readJson(request);
  const email = clean(data.email, 254).toLowerCase();
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Email du client invalide.');
  const objet = clean(data.objet, 200);
  if (objet.length < 3) throw new HttpError(400, 'Indiquez l’objet de la facture.');
  const lignes = (Array.isArray(data.lignes) ? data.lignes : []).slice(0, 30).map((l) => ({
    libelle: clean(l.libelle, 200), quantite: Math.max(1, Math.min(999, int(l.quantite) || 1)),
    prix_unitaire: Math.round(Number(String(l.prix_unitaire).replace(',', '.')) * 100),
  })).filter((l) => l.libelle && Number.isFinite(l.prix_unitaire) && l.prix_unitaire > 0);
  if (!lignes.length) throw new HttpError(400, 'Ajoutez au moins une ligne avec un prix.');
  const fact = await param(env, 'facturation', FACTURATION_DEFAUT);
  const taux = data.taux_tva === undefined ? int(fact.taux_tva * 100) : Math.round(Number(data.taux_tva) * 100);
  if (!Number.isFinite(taux) || taux < 0 || taux > 3000) throw new HttpError(400, 'Taux de TVA invalide.');
  const ht = lignes.reduce((t, l) => t + l.quantite * l.prix_unitaire, 0);
  const ttc = ht + Math.round(ht * taux / 10000);
  const emise = parisNow().date;
  const echeance = validDate(data.echeance) ? data.echeance : ajouterJours(emise, int(fact.delai_paiement) || 30);
  if (echeance < emise) throw new HttpError(400, 'L’échéance ne peut pas être antérieure à aujourd’hui.');

  const client = await upsertClient(env, { email, nom: clean(data.nom, 100) });
  const numero = await prochainNumero(env, 'F');
  const jeton = randomToken(24);
  const { meta } = await env.DB.prepare(`INSERT INTO factures (numero, client_id, projet_id, objet, lignes, montant_ht, taux_tva, montant_ttc, emise_le, echeance, jeton, relances_actives)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(numero, client.id, int(data.projet_id) || null, objet, JSON.stringify(lignes), ht, taux, ttc, emise, echeance, jeton, data.relances === false ? 0 : 1).run();
  const f = { id: meta.last_row_id, numero, objet, montant_ttc: ttc, echeance, jeton };
  const envoi = data.envoyer !== false ? await envoyerFacture(env, siteUrl(env, request), f, client) : null;
  const email_envoye = Boolean(envoi?.ok);
  await journal(env, request, s.email, 'Facture créée', numero, `${euros(ttc)} · ${email}`);
  const suite = !envoi ? '' : envoi.ok ? ' et envoyée au client' : `, mais l’email n’est pas parti (${envoi.erreur})`;
  return json({ ok: true, facture: f, email_envoye, message: `Facture ${numero} créée${suite}.` });
}

export async function adminFactureAction(request, env, ctx) {
  const s = await requireSession(request, env, 'admin');
  const data = await readJson(request);
  const f = await env.DB.prepare('SELECT f.*, c.email, c.nom FROM factures f JOIN clients c ON c.id = f.client_id WHERE f.id = ?').bind(int(data.id)).first();
  if (!f) throw new HttpError(404, 'Facture introuvable.');
  const b = siteUrl(env, request);
  const act = data.action;
  if (['payee', 'relancer', 'annuler'].includes(act) && f.statut !== 'a_payer') throw new HttpError(409, 'Cette facture n’est plus à payer.');
  if (act === 'payee') {
    const mode = MODES.includes(data.mode) ? data.mode : 'virement';
    await env.DB.prepare("UPDATE factures SET statut = 'payee', payee_le = datetime('now'), mode_paiement = ?, maj_le = datetime('now') WHERE id = ?").bind(mode, f.id).run();
    await journal(env, request, s.email, 'Facture marquée payée', f.numero, mode);
    return json({ ok: true, message: `${f.numero} marquée payée : les relances s’arrêtent.` });
  }
  if (act === 'annuler') {
    // Une facture émise ne se supprime pas : elle s'annule (un avoir est à établir si elle a été envoyée)
    await env.DB.prepare("UPDATE factures SET statut = 'annulee', maj_le = datetime('now') WHERE id = ?").bind(f.id).run();
    await journal(env, request, s.email, 'Facture annulée', f.numero);
    return json({ ok: true, message: `${f.numero} annulée. Pensez à émettre un avoir si elle avait été envoyée au client.` });
  }
  if (act === 'relances_on' || act === 'relances_off') {
    await env.DB.prepare("UPDATE factures SET relances_actives = ?, maj_le = datetime('now') WHERE id = ?").bind(act === 'relances_on' ? 1 : 0, f.id).run();
    return json({ ok: true, message: act === 'relances_on' ? 'Relances automatiques activées.' : 'Relances automatiques suspendues pour cette facture.' });
  }
  if (act === 'relancer') {
    const retard = Math.max(0, ecartJours(parisNow().date, f.echeance));
    const regles = await param(env, 'relances', REGLES_DEFAUT);
    const etape = { ...regles.etapes[0], sujet: 'Rappel : facture {numero}' };
    const ok = await envoyerRelance(env, b, f, etape, retard);
    await env.DB.prepare('INSERT INTO relances (facture_id, niveau, email, envoye) VALUES (?, 0, ?, ?)').bind(f.id, f.email, ok ? 1 : 0).run();
    await journal(env, request, s.email, 'Relance manuelle', f.numero);
    return json({ ok, message: ok ? `Relance envoyée à ${f.email}.` : 'L’email n’a pas pu partir. Vérifiez la configuration Brevo.' });
  }
  if (act === 'renvoyer') {
    const { ok, erreur } = await envoyerFacture(env, b, f, { email: f.email, nom: f.nom });
    return json({ ok, message: ok ? `Facture renvoyée à ${f.email}.` : `L’email n’a pas pu partir : ${erreur}.` });
  }
  throw new HttpError(400, 'Action inconnue.');
}

export async function adminFacturation(request, env) {
  const s = await requireSession(request, env, 'admin');
  const data = await readJson(request);
  if (data.regles) {
    const etapes = (data.regles.etapes || []).slice(0, 3).map((e, i) => ({
      niveau: i + 1, jours: Math.max(1, Math.min(120, int(e.jours) || 1)), nom: clean(e.nom, 40) || `Relance ${i + 1}`,
      sujet: clean(e.sujet, 150) || REGLES_DEFAUT.etapes[i].sujet, message: clean(e.message, 1500) || REGLES_DEFAUT.etapes[i].message,
    }));
    if (!etapes.length) throw new HttpError(400, 'Gardez au moins une étape de relance.');
    for (let i = 1; i < etapes.length; i++) if (etapes[i].jours <= etapes[i - 1].jours) throw new HttpError(400, 'Chaque étape doit arriver après la précédente.');
    await setParam(env, 'relances', { actives: data.regles.actives !== false, etapes });
  }
  if (data.facturation) {
    const f = data.facturation;
    const taux = Number(String(f.taux_tva ?? 0).replace(',', '.'));
    if (!Number.isFinite(taux) || taux < 0 || taux > 30) throw new HttpError(400, 'Taux de TVA invalide.');
    await setParam(env, 'facturation', {
      raison_sociale: clean(f.raison_sociale, 120) || FACTURATION_DEFAUT.raison_sociale, adresse: clean(f.adresse, 300),
      siret: clean(f.siret, 20), tva_intracom: clean(f.tva_intracom, 20), taux_tva: taux, mention_tva: clean(f.mention_tva, 200),
      delai_paiement: Math.max(0, Math.min(60, int(f.delai_paiement) || 30)), iban: clean(f.iban, 40), bic: clean(f.bic, 15),
      conditions: clean(f.conditions, 800) || FACTURATION_DEFAUT.conditions, // mentions obligatoires (art. L441-10) : jamais vides
    });
  }
  await journal(env, request, s.email, 'Réglages de facturation modifiés');
  return json({ ok: true, message: 'Réglages enregistrés.' });
}

/* ---------------------------------------------------------------- facture publique (lien non devinable) */

async function factureParJeton(env, jeton) {
  const t = clean(jeton, 64);
  if (t.length < 20) return null;
  return env.DB.prepare('SELECT f.*, c.email, c.nom, c.entreprise FROM factures f JOIN clients c ON c.id = f.client_id WHERE f.jeton = ?').bind(t).first();
}

export async function factureVoir(request, env) {
  requireDb(env);
  const f = await factureParJeton(env, new URL(request.url).searchParams.get('t'));
  if (!f) throw new HttpError(404, 'Facture introuvable. Vérifiez le lien reçu par email.');
  const fact = await param(env, 'facturation', FACTURATION_DEFAUT);
  const { id, client_id, projet_id, stripe_session, jeton, relances_actives, ...pub } = f;
  return json({ facture: { ...pub, lignes: JSON.parse(f.lignes || '[]') }, emetteur: fact, paiement: paiementActif(env) && f.statut === 'a_payer' });
}

// Lien « Payer » des emails : un clic → page de paiement Stripe
export async function facturePayer(request, env) {
  requireDb(env);
  const jeton = new URL(request.url).searchParams.get('t');
  const f = await factureParJeton(env, jeton);
  const b = siteUrl(env, request);
  if (!f) return Response.redirect(`${b}/paiement-confirme?erreur=introuvable`, 303);
  if (f.statut !== 'a_payer') return Response.redirect(`${b}/facture?t=${encodeURIComponent(f.jeton)}`, 303);
  // Réutilise la page de paiement déjà ouverte (un lien cliqué deux fois ne crée pas deux paiements)
  if (f.stripe_session) {
    const s = await lireSession(env, f.stripe_session).catch(() => null);
    if (s?.status === 'open' && s.url) return Response.redirect(s.url, 303);
    if (s?.payment_status === 'paid') return Response.redirect(`${b}/paiement-confirme?session=${encodeURIComponent(s.id)}`, 303);
  }
  const session = await creerSessionPaiement(env, {
    lignes: [{ nom: `Facture ${f.numero} · ${f.objet}`, quantite: 1, montant_unitaire_ttc: f.montant_ttc }],
    email: f.email, reference: f.numero,
    succes: `${b}/paiement-confirme?session={CHECKOUT_SESSION_ID}`,
    annulation: `${b}/facture?t=${encodeURIComponent(f.jeton)}`,
    metadata: { type: 'facture', facture_id: String(f.id), numero: f.numero },
    parcours: 'rit_factures_qzkvmwpa',
  });
  await env.DB.prepare('UPDATE factures SET stripe_session = ? WHERE id = ?').bind(session.id, f.id).run();
  return Response.redirect(session.url, 303);
}

/* ---------------------------------------------------------------- boutique */

export async function catalogue(request, env) {
  requireDb(env);
  const { results } = await env.DB.prepare('SELECT id, nom, prix_ht FROM produits WHERE achat_en_ligne = 1 AND prix_ht > 0 ORDER BY ordre').all();
  const fact = await param(env, 'facturation', FACTURATION_DEFAUT);
  const taux = Math.round(Number(fact.taux_tva) * 100) || 0;
  const actif = paiementActif(env);
  return json({
    paiement: actif, taux_tva: taux / 100, mention_tva: fact.mention_tva,
    produits: actif ? results.map((p) => ({ ...p, prix_ttc: p.prix_ht + Math.round(p.prix_ht * taux / 10000) })) : [],
  }, 200, { 'Cache-Control': 'public, max-age=60' });
}

export async function commander(request, env) {
  requireDb(env);
  const data = await readJson(request);
  const demande = (Array.isArray(data.lignes) ? data.lignes : []).slice(0, 20);
  const ids = [...new Set(demande.map((l) => clean(l.id, 60)))].filter(Boolean);
  if (!ids.length) throw new HttpError(400, 'Votre panier est vide.');
  const { results } = await env.DB.prepare(`SELECT id, nom, prix_ht FROM produits WHERE achat_en_ligne = 1 AND prix_ht > 0 AND id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all();
  const fact = await param(env, 'facturation', FACTURATION_DEFAUT);
  const taux = Math.round(Number(fact.taux_tva) * 100) || 0;
  // Le prix vient toujours de la base, jamais du navigateur
  const lignes = ids.map((id) => {
    const p = results.find((r) => r.id === id);
    if (!p) throw new HttpError(409, 'Un produit de votre panier n’est plus disponible. Rechargez la page.');
    const q = Math.max(1, Math.min(10, int(demande.find((l) => clean(l.id, 60) === id).quantite) || 1));
    return { id: p.id, nom: p.nom, quantite: q, prix_ht: p.prix_ht, prix_ttc: p.prix_ht + Math.round(p.prix_ht * taux / 10000) };
  });
  const ht = lignes.reduce((t, l) => t + l.quantite * l.prix_ht, 0);
  const ttc = lignes.reduce((t, l) => t + l.quantite * l.prix_ttc, 0);
  const b = siteUrl(env, request);
  const reference = await prochainNumero(env, 'C');
  const { meta } = await env.DB.prepare('INSERT INTO commandes (reference, lignes, montant_ht, montant_ttc) VALUES (?, ?, ?, ?)')
    .bind(reference, JSON.stringify(lignes), ht, ttc).run();
  const session = await creerSessionPaiement(env, {
    lignes: lignes.map((l) => ({ nom: l.nom, quantite: l.quantite, montant_unitaire_ttc: l.prix_ttc })),
    reference,
    succes: `${b}/paiement-confirme?session={CHECKOUT_SESSION_ID}`,
    annulation: `${b}/boutique?paiement=annule`,
    metadata: { type: 'commande', commande_id: String(meta.last_row_id), reference },
    parcours: 'rit_boutique_hdjtnrxe',
  });
  await env.DB.prepare('UPDATE commandes SET stripe_session = ? WHERE id = ?').bind(session.id, meta.last_row_id).run();
  return json({ url: session.url });
}

// Page de confirmation : lit l'état enregistré par le webhook (la page réessaie quelques secondes si besoin)
export async function statutPaiement(request, env) {
  requireDb(env);
  const id = clean(new URL(request.url).searchParams.get('session'), 200);
  if (!/^cs_[A-Za-z0-9_]+$/.test(id)) throw new HttpError(400, 'Référence de paiement invalide.');
  const c = await env.DB.prepare('SELECT reference, statut, montant_ttc, lignes, facture_id FROM commandes WHERE stripe_session = ?').bind(id).first();
  if (c) {
    const f = c.facture_id ? await env.DB.prepare('SELECT jeton FROM factures WHERE id = ?').bind(c.facture_id).first() : null;
    return json({ type: 'commande', reference: c.reference, statut: c.statut, montant: c.montant_ttc, lignes: JSON.parse(c.lignes), facture: f ? `/facture?t=${encodeURIComponent(f.jeton)}` : null });
  }
  const f = await env.DB.prepare('SELECT numero, statut, montant_ttc, jeton FROM factures WHERE stripe_session = ?').bind(id).first();
  if (f) return json({ type: 'facture', reference: f.numero, statut: f.statut === 'payee' ? 'payee' : 'en_attente', montant: f.montant_ttc, facture: `/facture?t=${encodeURIComponent(f.jeton)}` });
  throw new HttpError(404, 'Paiement introuvable.');
}

/* ---------------------------------------------------------------- administration : boutique */

export async function adminBoutique(request, env) {
  await requireSession(request, env, 'admin');
  const [produits, commandes] = await Promise.all([
    env.DB.prepare('SELECT * FROM produits ORDER BY ordre').all(),
    env.DB.prepare("SELECT c.id, c.reference, c.email, c.lignes, c.montant_ttc, c.statut, c.cree_le, c.payee_le, f.numero AS facture FROM commandes c LEFT JOIN factures f ON f.id = c.facture_id WHERE c.statut != 'en_attente' OR c.cree_le > datetime('now', '-2 days') ORDER BY c.id DESC LIMIT 200").all(),
  ]);
  const fact = await param(env, 'facturation', FACTURATION_DEFAUT);
  return json({ produits: produits.results, commandes: commandes.results.map((c) => ({ ...c, lignes: JSON.parse(c.lignes) })), paiement: paiementActif(env), taux_tva: fact.taux_tva });
}

export async function adminProduit(request, env) {
  const s = await requireSession(request, env, 'admin');
  const data = await readJson(request);
  const p = await env.DB.prepare('SELECT id FROM produits WHERE id = ?').bind(clean(data.id, 60)).first();
  if (!p) throw new HttpError(404, 'Produit introuvable.');
  const brut = String(data.prix_ht ?? '').replace(',', '.').trim();
  const prix = brut === '' ? null : Math.round(Number(brut) * 100);
  if (prix !== null && (!Number.isFinite(prix) || prix <= 0 || prix > 10000000)) throw new HttpError(400, 'Prix invalide.');
  const enLigne = data.achat_en_ligne && prix ? 1 : 0;
  await env.DB.prepare('UPDATE produits SET prix_ht = ?, achat_en_ligne = ? WHERE id = ?').bind(prix, enLigne, p.id).run();
  await journal(env, request, s.email, 'Produit modifié', p.id, prix ? `${euros(prix)} HT · ${enLigne ? 'en vente' : 'sur devis'}` : 'sur devis');
  return json({ ok: true, message: enLigne ? 'Produit en vente en ligne.' : 'Produit sur devis uniquement.' });
}

/* ---------------------------------------------------------------- webhook Stripe */

export async function webhook(request, env, ctx) {
  requireDb(env);
  const evt = await verifierWebhook(env, request);
  // Idempotence : Stripe peut envoyer deux fois le même événement
  const { meta } = await env.DB.prepare('INSERT OR IGNORE INTO stripe_evenements (id, type) VALUES (?, ?)').bind(clean(evt.id, 100), clean(evt.type, 80)).run();
  if (!meta.changes) return json({ ok: true, deja: true });
  const s = evt.data?.object || {};
  const md = s.metadata || {};
  try {
    if ((evt.type === 'checkout.session.completed' || evt.type === 'checkout.session.async_payment_succeeded') && s.payment_status === 'paid') {
      if (md.type === 'facture') await factureReglee(env, int(md.facture_id), s);
      if (md.type === 'commande') await commandeReglee(env, int(md.commande_id), s);
    }
    // Paiement différé (prélèvement, virement…) finalement refusé : le client peut réessayer, l'administrateur est prévenu
    if (evt.type === 'checkout.session.async_payment_failed') {
      if (md.type === 'facture') await env.DB.prepare('UPDATE factures SET stripe_session = NULL WHERE id = ? AND stripe_session = ?').bind(int(md.facture_id), s.id).run();
      if (md.type === 'commande') await env.DB.prepare("UPDATE commandes SET statut = 'echouee' WHERE id = ? AND statut = 'en_attente'").bind(int(md.commande_id)).run();
      await sendEmail(env, {
        to: notifyEmail(env), subject: `Paiement refusé : ${clean(md.numero || md.reference || '', 40)}`,
        html: emailLayout('Paiement refusé', `<p>Le paiement de <strong>${esc(md.numero || md.reference || '')}</strong> a été refusé par la banque du client. ${md.type === 'facture' ? 'La facture reste à payer : les relances continuent.' : 'La commande n’est pas réglée.'}</p>${emailButton(`${base(env)}/admin#${md.type === 'facture' ? 'factures' : 'boutique'}`, 'Voir dans l’administration')}`),
      });
    }
    if (evt.type === 'checkout.session.expired' && md.type === 'commande') {
      await env.DB.prepare("UPDATE commandes SET statut = 'expiree' WHERE id = ? AND statut = 'en_attente'").bind(int(md.commande_id)).run();
    }
  } catch (e) {
    // Stripe renverra l'événement : on libère la trace pour pouvoir le retraiter
    await env.DB.prepare('DELETE FROM stripe_evenements WHERE id = ?').bind(evt.id).run();
    throw e;
  }
  return json({ ok: true });
}

async function factureReglee(env, id, s) {
  const { meta } = await env.DB.prepare(`UPDATE factures SET statut = 'payee', payee_le = datetime('now'), mode_paiement = 'carte', stripe_session = ?, maj_le = datetime('now')
    WHERE id = ? AND statut = 'a_payer'`).bind(s.id, id).run();
  if (!meta.changes) return;
  const f = await env.DB.prepare('SELECT f.*, c.email, c.nom FROM factures f JOIN clients c ON c.id = f.client_id WHERE f.id = ?').bind(id).first();
  const b = base(env);
  await Promise.all([
    sendEmail(env, { to: f.email, replyTo: notifyEmail(env), subject: `Paiement reçu · facture ${f.numero}`,
      html: emailLayout('Merci, votre paiement est bien reçu', `${emailTable([['Facture', f.numero], ['Montant réglé', euros(f.montant_ttc)]])}<p><a href="${esc(lienFacture(b, f))}">Voir la facture acquittée</a></p>`) }),
    sendEmail(env, { to: notifyEmail(env), subject: `Facture ${f.numero} payée par carte (${euros(f.montant_ttc)})`,
      html: emailLayout('Paiement reçu', `${emailTable([['Facture', f.numero], ['Client', `${f.nom || ''} ${f.email}`], ['Montant', euros(f.montant_ttc)]])}${emailButton(`${b}/admin#factures`, 'Voir les factures')}`) }),
  ]);
}

async function commandeReglee(env, id, s) {
  const c = await env.DB.prepare("SELECT * FROM commandes WHERE id = ? AND statut = 'en_attente'").bind(id).first();
  if (!c) return;
  const email = clean(s.customer_details?.email || s.customer_email, 254).toLowerCase();
  const nom = clean(s.customer_details?.name, 100);
  const client = await upsertClient(env, { email, nom, telephone: clean(s.customer_details?.phone, 30) });
  const lignes = JSON.parse(c.lignes);
  const fact = await param(env, 'facturation', FACTURATION_DEFAUT);
  const taux = Math.round(Number(fact.taux_tva) * 100) || 0;
  // Facture acquittée émise automatiquement, et projet ouvert pour le suivi de la prestation
  const numero = await prochainNumero(env, 'F');
  const jeton = randomToken(24);
  const aujourdhui = parisNow().date;
  const objet = `Commande ${c.reference}`;
  const fl = lignes.map((l) => ({ libelle: l.nom, quantite: l.quantite, prix_unitaire: l.prix_ht }));
  const { meta: fm } = await env.DB.prepare(`INSERT INTO factures (numero, client_id, commande_id, objet, lignes, montant_ht, taux_tva, montant_ttc, emise_le, echeance, statut, payee_le, mode_paiement, stripe_session, jeton, relances_actives)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'payee', datetime('now'), 'carte', ?, ?, 0)`).bind(numero, client.id, c.id, objet, JSON.stringify(fl), c.montant_ht, taux, c.montant_ttc, aujourdhui, aujourdhui, s.id, jeton).run();
  await env.DB.batch([
    env.DB.prepare("UPDATE commandes SET statut = 'payee', payee_le = datetime('now'), client_id = ?, email = ?, facture_id = ? WHERE id = ?").bind(client.id, email, fm.last_row_id, c.id),
    env.DB.prepare("INSERT INTO projets (client_id, titre, service, statut, origine) VALUES (?, ?, ?, 'nouveau', 'admin')").bind(client.id, `${lignes.map((l) => l.nom).join(', ').slice(0, 150)}`, 'Boutique'),
  ]);
  const b = base(env);
  const detail = lignes.map((l) => [`${l.quantite} × ${l.nom}`, euros(l.quantite * l.prix_ttc)]);
  await Promise.all([
    sendEmail(env, { to: email, replyTo: notifyEmail(env), subject: `Confirmation de votre commande ${c.reference}`,
      html: emailLayout(`Merci${nom ? ` ${esc(nom)}` : ''} pour votre commande`, `${emailTable([...detail, ['Total payé', euros(c.montant_ttc)]])}
        <p>Nous vous contactons sous 24 h ouvrées pour planifier la prestation.</p>
        ${emailButton(lienFacture(b, { jeton }), 'Voir ma facture')}`) }),
    sendEmail(env, { to: notifyEmail(env), subject: `Nouvelle commande ${c.reference} (${euros(c.montant_ttc)})`,
      html: emailLayout('Nouvelle commande payée', `${emailTable([['Client', `${nom} ${email}`], ...detail, ['Total', euros(c.montant_ttc)], ['Facture', numero]])}
        <p>Un projet a été ouvert pour le suivi de la prestation.</p>${emailButton(`${b}/admin#boutique`, 'Voir la commande')}`) }),
  ]);
}

/* ---------------------------------------------------------------- espace client */

export async function facturesClient(env, clientId) {
  const { results } = await env.DB.prepare(`SELECT numero, objet, montant_ttc, emise_le, echeance, statut, payee_le, jeton
    FROM factures WHERE client_id = ? AND statut != 'annulee' ORDER BY id DESC`).bind(clientId).all();
  return results;
}
