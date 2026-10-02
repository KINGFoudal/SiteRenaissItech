// Devis : création dans l'administration, envoi par email, acceptation ou refus en ligne par le client,
// facture d'acompte automatique (payable par carte), puis facture de solde.
//
//   GET  /api/admin/devis           liste et indicateurs
//   POST /api/admin/devis/creer     créer (et envoyer) un devis
//   POST /api/admin/devis/action    renvoyer, annuler, facturer le solde, dupliquer
//   GET  /api/devis?t=              devis consultable par le client (lien non devinable)
//   POST /api/devis/accepter        « Bon pour accord » : nom du signataire + case cochée
//   POST /api/devis/refuser         refus, avec la raison facultative

import {
  HttpError, json, clean, readJson, EMAIL_RE, esc, emailLayout, emailButton, emailTable,
  sendEmail, envoyerEmail, notifyEmail, siteUrl, upsertClient, randomToken, validDate, parisNow, requireDb, ipHash,
} from './lib.js';
import { requireSession } from './auth.js';
import { journal } from './securite.js';
import { paiementActif } from './stripe.js';
import { ETAPES, lierEntreprise } from './crm.js';
import {
  param, FACTURATION_DEFAUT, prochainNumero, euros, dateFr, ajouterJours, base, lienFacture,
  lireLignes, tauxTva, totaux, creerFacture, envoyerFacture,
} from './factures.js';

const int = (v) => Number.parseInt(v, 10);
const VALIDITE_JOURS = 30;
const CONDITIONS_DEVIS = 'Devis valable jusqu’à la date indiquée. Les travaux démarrent à réception de l’acompte, le cas échéant. Solde payable à réception de facture.';
const lienDevis = (b, d) => `${b}/devis?t=${encodeURIComponent(d.jeton)}`;

async function devisParJeton(env, jeton) {
  const t = clean(jeton, 64);
  if (t.length < 20) return null;
  return env.DB.prepare(`SELECT d.*, c.email, c.nom, c.entreprise,
      COALESCE(e.adresse, c.adresse) AS client_adresse, e.code_postal AS client_cp, COALESCE(e.ville, c.ville) AS client_ville,
      COALESCE(e.pays, c.pays) AS client_pays, COALESCE(e.siret, c.siret) AS client_siret, e.tva_intracom AS client_tva
    FROM devis d JOIN clients c ON c.id = d.client_id LEFT JOIN entreprises e ON e.id = c.entreprise_id WHERE d.jeton = ?`).bind(t).first();
}

async function envoyerDevis(env, b, d, client) {
  const fact = await param(env, 'facturation', FACTURATION_DEFAUT);
  return envoyerEmail(env, {
    to: client.email, replyTo: notifyEmail(env),
    subject: `Devis ${d.numero} · ${fact.raison_sociale}`,
    html: emailLayout(`Bonjour${client.nom ? ` ${esc(client.nom)}` : ''}`, `<p>Voici notre proposition pour : <strong>${esc(d.objet)}</strong>.</p>
      ${emailTable([['Devis', d.numero], ['Montant HT', euros(d.montant_ht)], ['Montant TTC', euros(d.montant_ttc)], ['Valable jusqu’au', dateFr(d.valide_jusqu)], ['Acompte à la commande', d.acompte_pct ? `${d.acompte_pct} %` : '']])}
      <p>Vous pouvez le consulter, l’accepter en ligne en un clic ou nous faire part de vos remarques.</p>${emailButton(lienDevis(b, d), 'Consulter et accepter le devis')}`),
  });
}

// Un devis envoyé fait avancer l'opportunité à « Devis envoyé » (ou en crée une) et programme une relance à J+7
async function suiviCommercial(env, d, client, opportuniteId) {
  let oid = opportuniteId;
  if (oid) {
    await env.DB.prepare(`UPDATE opportunites SET etape = CASE WHEN etape IN ('nouveau', 'qualifie') THEN 'proposition' ELSE etape END,
        probabilite = MAX(probabilite, ?), montant_ht = CASE WHEN montant_ht = 0 THEN ? ELSE montant_ht END, maj_le = datetime('now') WHERE id = ? AND client_id = ?`)
      .bind(ETAPES.proposition, d.montant_ht, oid, client.id).run();
  } else {
    const { meta } = await env.DB.prepare("INSERT INTO opportunites (client_id, titre, montant_ht, etape, probabilite, echeance, origine) VALUES (?, ?, ?, 'proposition', ?, ?, 'devis')")
      .bind(client.id, d.objet, d.montant_ht, ETAPES.proposition, d.valide_jusqu).run();
    oid = meta.last_row_id;
  }
  await env.DB.batch([
    env.DB.prepare('UPDATE devis SET opportunite_id = ? WHERE id = ?').bind(oid, d.id),
    env.DB.prepare('INSERT INTO taches (client_id, opportunite_id, titre, echeance) VALUES (?, ?, ?, ?)')
      .bind(client.id, oid, `Relancer le devis ${d.numero} (${d.objet})`, ajouterJours(parisNow().date, 7)),
    env.DB.prepare("UPDATE clients SET dernier_contact = datetime('now') WHERE id = ?").bind(client.id),
  ]);
}

/* ---------------------------------------------------------------- administration */

export async function adminDevis(request, env) {
  await requireSession(request, env, 'admin');
  const { results } = await env.DB.prepare(`SELECT d.id, d.numero, d.objet, d.montant_ht, d.montant_ttc, d.acompte_pct, d.statut, d.emis_le, d.valide_jusqu,
      d.accepte_le, d.accepte_par, d.refuse_le, d.raison_refus, d.jeton, c.id AS client_id, c.email, c.nom, c.entreprise,
      (SELECT COUNT(*) FROM factures f WHERE f.devis_id = d.id) AS nb_factures
    FROM devis d JOIN clients c ON c.id = d.client_id ORDER BY d.id DESC LIMIT 500`).all();
  const fact = await param(env, 'facturation', FACTURATION_DEFAUT);
  return json({ devis: results, facturation: fact, aujourdhui: parisNow().date, validite: VALIDITE_JOURS, conditions: CONDITIONS_DEVIS });
}

export async function adminDevisCreer(request, env) {
  const s = await requireSession(request, env, 'admin');
  const data = await readJson(request);
  let client;
  if (int(data.client_id)) {
    client = await env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(int(data.client_id)).first();
    if (!client) throw new HttpError(404, 'Contact introuvable.');
  } else {
    const email = clean(data.email, 254).toLowerCase();
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Email du client invalide.');
    client = await upsertClient(env, { email, nom: clean(data.nom, 100) });
    if (clean(data.entreprise, 120) && !client.entreprise_id) await lierEntreprise(env, client.id, data.entreprise);
  }
  const objet = clean(data.objet, 200);
  if (objet.length < 3) throw new HttpError(400, 'Indiquez l’objet du devis.');
  const lignes = lireLignes(data);
  if (!lignes.length) throw new HttpError(400, 'Ajoutez au moins une ligne avec un prix.');
  const taux = await tauxTva(env, data.taux_tva);
  const acompte = Math.max(0, Math.min(100, int(data.acompte_pct) || 0));
  const emis = parisNow().date;
  const valide = validDate(data.valide_jusqu) ? data.valide_jusqu : ajouterJours(emis, VALIDITE_JOURS);
  if (valide < emis) throw new HttpError(400, 'La date de validité est déjà passée.');
  const { ht, ttc } = totaux(lignes, taux);
  const numero = await prochainNumero(env, 'D');
  const jeton = randomToken(24);
  const { meta } = await env.DB.prepare(`INSERT INTO devis (numero, client_id, objet, lignes, montant_ht, taux_tva, montant_ttc, acompte_pct, emis_le, valide_jusqu, conditions, jeton)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(numero, client.id, objet, JSON.stringify(lignes), ht, taux, ttc, acompte, emis, valide, clean(data.conditions, 1500) || CONDITIONS_DEVIS, jeton).run();
  const d = { id: meta.last_row_id, numero, objet, montant_ht: ht, montant_ttc: ttc, acompte_pct: acompte, valide_jusqu: valide, jeton };
  await suiviCommercial(env, d, client, int(data.opportunite_id) || null);
  const envoi = data.envoyer !== false ? await envoyerDevis(env, siteUrl(env, request), d, client) : null;
  await journal(env, request, s.email, 'Devis créé', numero, `${euros(ht)} HT · ${client.email}`);
  const suite = !envoi ? '' : envoi.ok ? ' et envoyé au client' : `, mais l’email n’est pas parti (${envoi.erreur})`;
  return json({ ok: true, devis: d, message: `Devis ${numero} créé${suite}.` });
}

export async function adminDevisAction(request, env) {
  const s = await requireSession(request, env, 'admin');
  const data = await readJson(request);
  const d = await env.DB.prepare('SELECT d.*, c.email, c.nom FROM devis d JOIN clients c ON c.id = d.client_id WHERE d.id = ?').bind(int(data.id)).first();
  if (!d) throw new HttpError(404, 'Devis introuvable.');
  const b = siteUrl(env, request);
  if (data.action === 'renvoyer') {
    if (d.statut !== 'envoye') throw new HttpError(409, 'Seul un devis en attente de réponse peut être renvoyé.');
    const { ok, erreur } = await envoyerDevis(env, b, d, d);
    return json({ ok, message: ok ? `Devis renvoyé à ${d.email}.` : `L’email n’a pas pu partir : ${erreur}.` });
  }
  if (data.action === 'annuler') {
    if (!['envoye', 'expire'].includes(d.statut)) throw new HttpError(409, 'Ce devis ne peut plus être annulé.');
    await env.DB.prepare("UPDATE devis SET statut = 'annule', maj_le = datetime('now') WHERE id = ?").bind(d.id).run();
    await journal(env, request, s.email, 'Devis annulé', d.numero);
    return json({ ok: true, message: `Devis ${d.numero} annulé.` });
  }
  if (data.action === 'facturer') {
    // Facture de solde : lignes du devis, moins les acomptes déjà facturés
    if (d.statut !== 'accepte') throw new HttpError(409, 'Seul un devis accepté peut être facturé.');
    const { results: acomptes } = await env.DB.prepare("SELECT numero, montant_ht FROM factures WHERE devis_id = ? AND type = 'acompte' AND statut <> 'annulee'").bind(d.id).all();
    const lignes = [...JSON.parse(d.lignes), ...acomptes.map((a) => ({ libelle: `Acompte déjà facturé (${a.numero})`, quantite: 1, prix_unitaire: -a.montant_ht }))];
    const fact = await param(env, 'facturation', FACTURATION_DEFAUT);
    const client = { id: d.client_id, email: d.email, nom: d.nom };
    const f = await creerFacture(env, {
      client, objet: `${d.objet} (devis ${d.numero})`, lignes, taux: d.taux_tva,
      echeance: ajouterJours(parisNow().date, int(fact.delai_paiement) || 30), devisId: d.id, type: acomptes.length ? 'solde' : 'facture',
    });
    await env.DB.prepare("UPDATE devis SET statut = 'facture', maj_le = datetime('now') WHERE id = ?").bind(d.id).run();
    const envoi = data.envoyer !== false ? await envoyerFacture(env, b, f, client) : null;
    await journal(env, request, s.email, 'Devis facturé', d.numero, f.numero);
    return json({ ok: true, facture: f, message: `Facture ${f.numero} créée (${euros(f.montant_ttc)} TTC)${envoi?.ok ? ' et envoyée' : ''}.` });
  }
  if (data.action === 'dupliquer') {
    const numero = await prochainNumero(env, 'D');
    const jeton = randomToken(24);
    const emis = parisNow().date;
    const { meta } = await env.DB.prepare(`INSERT INTO devis (numero, client_id, opportunite_id, objet, lignes, montant_ht, taux_tva, montant_ttc, acompte_pct, emis_le, valide_jusqu, conditions, jeton)
      SELECT ?, client_id, opportunite_id, objet, lignes, montant_ht, taux_tva, montant_ttc, acompte_pct, ?, ?, conditions, ? FROM devis WHERE id = ?`)
      .bind(numero, emis, ajouterJours(emis, VALIDITE_JOURS), jeton, d.id).run();
    const copie = { id: meta.last_row_id, numero, objet: d.objet, montant_ht: d.montant_ht, montant_ttc: d.montant_ttc, acompte_pct: d.acompte_pct, valide_jusqu: ajouterJours(emis, VALIDITE_JOURS), jeton };
    const envoi = data.envoyer ? await envoyerDevis(env, b, copie, d) : null;
    return json({ ok: true, devis: copie, message: `Nouveau devis ${numero} créé à partir de ${d.numero}${envoi?.ok ? ' et envoyé' : ''}.` });
  }
  throw new HttpError(400, 'Action inconnue.');
}

/* ---------------------------------------------------------------- côté client (lien reçu par email) */

export async function devisVoir(request, env) {
  requireDb(env);
  const d = await devisParJeton(env, new URL(request.url).searchParams.get('t'));
  if (!d) throw new HttpError(404, 'Devis introuvable. Vérifiez le lien reçu par email.');
  const fact = await param(env, 'facturation', FACTURATION_DEFAUT);
  const aujourdhui = parisNow().date;
  const statut = d.statut === 'envoye' && d.valide_jusqu < aujourdhui ? 'expire' : d.statut;
  const acompte = await env.DB.prepare("SELECT jeton, statut, montant_ttc FROM factures WHERE devis_id = ? AND type = 'acompte' ORDER BY id DESC LIMIT 1").bind(d.id).first();
  const { id, client_id, opportunite_id, jeton, accepte_ip, ...pub } = d;
  return json({
    devis: { ...pub, statut, lignes: JSON.parse(d.lignes || '[]') }, emetteur: fact,
    acompte: acompte ? { lien: `/facture?t=${encodeURIComponent(acompte.jeton)}`, payee: acompte.statut === 'payee', montant_ttc: acompte.montant_ttc } : null,
    paiement: paiementActif(env),
  });
}

export async function devisAccepter(request, env) {
  requireDb(env);
  const data = await readJson(request);
  const d = await devisParJeton(env, data.t);
  if (!d) throw new HttpError(404, 'Devis introuvable.');
  if (d.statut !== 'envoye') throw new HttpError(409, d.statut === 'accepte' || d.statut === 'facture' ? 'Ce devis est déjà accepté. Merci !' : 'Ce devis n’est plus modifiable. Contactez-nous.');
  const aujourdhui = parisNow().date;
  if (d.valide_jusqu < aujourdhui) throw new HttpError(409, 'Ce devis a expiré. Contactez-nous pour une proposition à jour.');
  const signataire = clean(data.nom, 100);
  if (signataire.length < 2) throw new HttpError(400, 'Indiquez vos nom et prénom.');
  if (data.accord !== true) throw new HttpError(400, 'Cochez la case « Bon pour accord » pour valider.');

  const { meta } = await env.DB.prepare(`UPDATE devis SET statut = 'accepte', accepte_le = datetime('now'), accepte_par = ?, accepte_ip = ?, maj_le = datetime('now')
    WHERE id = ? AND statut = 'envoye'`).bind(signataire, await ipHash(request), d.id).run();
  if (!meta.changes) throw new HttpError(409, 'Ce devis vient d’être traité.');
  const client = { id: d.client_id, email: d.email, nom: d.nom };
  await env.DB.batch([
    env.DB.prepare("UPDATE clients SET statut = 'client', dernier_contact = datetime('now') WHERE id = ?").bind(d.client_id),
    env.DB.prepare("UPDATE opportunites SET etape = 'gagne', probabilite = 100, cloture_le = COALESCE(cloture_le, datetime('now')), maj_le = datetime('now') WHERE id = ?").bind(d.opportunite_id),
    env.DB.prepare("INSERT INTO crm_notes (client_id, opportunite_id, type, contenu, auteur) VALUES (?, ?, 'note', ?, 'client')")
      .bind(d.client_id, d.opportunite_id, `Devis ${d.numero} accepté en ligne par ${signataire} (bon pour accord).`),
    env.DB.prepare("UPDATE taches SET faite = 1, faite_le = datetime('now') WHERE opportunite_id = ? AND faite = 0 AND titre LIKE 'Relancer le devis%'").bind(d.opportunite_id),
  ]);

  // Acompte : facture créée tout de suite, payable par carte dans la foulée
  let acompte = null;
  if (d.acompte_pct > 0) {
    const htAcompte = Math.round(d.montant_ht * d.acompte_pct / 100);
    acompte = await creerFacture(env, {
      client, objet: `Acompte ${d.acompte_pct} % · ${d.objet} (devis ${d.numero})`,
      lignes: [{ libelle: `Acompte de ${d.acompte_pct} % sur le devis ${d.numero}`, quantite: 1, prix_unitaire: htAcompte }],
      taux: d.taux_tva, echeance: ajouterJours(aujourdhui, 7), devisId: d.id, type: 'acompte',
    });
    await envoyerFacture(env, base(env, request), acompte, client);
  }
  const b = base(env, request);
  await sendEmail(env, {
    to: notifyEmail(env), subject: `Devis ${d.numero} accepté par ${signataire} (${euros(d.montant_ht)} HT)`,
    html: emailLayout('Devis accepté 🎉', `${emailTable([['Devis', d.numero], ['Objet', d.objet], ['Client', `${d.nom || ''} ${d.email}`], ['Signataire', signataire], ['Montant HT', euros(d.montant_ht)], ['Acompte', acompte ? `${acompte.numero} · ${euros(acompte.montant_ttc)} TTC` : 'aucun']])}${emailButton(`${b}/admin#devis`, 'Voir le devis')}`),
  });
  return json({
    ok: true,
    message: acompte ? 'Merci ! Votre accord est enregistré. Vous pouvez régler l’acompte dès maintenant.' : 'Merci ! Votre accord est enregistré. Nous revenons vers vous très vite pour démarrer.',
    acompte: acompte ? { lien: lienFacture('', acompte), paiement: paiementActif(env) ? `/api/paiement/facture?t=${encodeURIComponent(acompte.jeton)}` : null, montant_ttc: acompte.montant_ttc } : null,
  });
}

export async function devisRefuser(request, env) {
  requireDb(env);
  const data = await readJson(request);
  const d = await devisParJeton(env, data.t);
  if (!d) throw new HttpError(404, 'Devis introuvable.');
  if (d.statut !== 'envoye') throw new HttpError(409, 'Ce devis n’est plus modifiable.');
  const raison = clean(data.raison, 500);
  await env.DB.batch([
    env.DB.prepare("UPDATE devis SET statut = 'refuse', refuse_le = datetime('now'), raison_refus = ?, maj_le = datetime('now') WHERE id = ?").bind(raison || null, d.id),
    env.DB.prepare("UPDATE opportunites SET etape = 'perdu', probabilite = 0, raison_perte = ?, cloture_le = COALESCE(cloture_le, datetime('now')), maj_le = datetime('now') WHERE id = ? AND etape <> 'gagne'")
      .bind(raison ? `Devis refusé : ${raison}` : 'Devis refusé', d.opportunite_id),
    env.DB.prepare("INSERT INTO crm_notes (client_id, opportunite_id, type, contenu, auteur) VALUES (?, ?, 'note', ?, 'client')")
      .bind(d.client_id, d.opportunite_id, `Devis ${d.numero} refusé en ligne${raison ? ` : ${raison}` : ''}.`),
  ]);
  await sendEmail(env, {
    to: notifyEmail(env), subject: `Devis ${d.numero} refusé`,
    html: emailLayout('Devis refusé', `${emailTable([['Devis', d.numero], ['Client', `${d.nom || ''} ${d.email}`], ['Raison', raison || 'non précisée']])}<p>Un appel rapide permet souvent de comprendre et de rebondir.</p>`),
  });
  return json({ ok: true, message: 'C’est noté, merci pour votre réponse. N’hésitez pas à nous recontacter si votre besoin évolue.' });
}

/* ---------------------------------------------------------------- tâche du matin et espace client */

export async function expirerDevis(env) {
  try {
    await env.DB.prepare("UPDATE devis SET statut = 'expire', maj_le = datetime('now') WHERE statut = 'envoye' AND valide_jusqu < ?").bind(parisNow().date).run();
  } catch (e) {
    console.error('Expiration des devis', e);
  }
}

export async function devisClient(env, clientId) {
  try {
    const { results } = await env.DB.prepare(`SELECT numero, objet, montant_ht, montant_ttc, statut, emis_le, valide_jusqu, jeton FROM devis
      WHERE client_id = ? AND statut <> 'annule' ORDER BY id DESC LIMIT 50`).bind(clientId).all();
    return results;
  } catch {
    return [];
  }
}
