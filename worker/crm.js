// CRM de l'administration : contacts (prospects et clients), opportunités commerciales, notes d'échanges et tâches.
//
//   GET  /api/admin/clients        liste des contacts avec leurs chiffres (CA, opportunités, tâches)
//   GET  /api/admin/crm/fiche      fiche complète d'un contact (?id=)
//   POST /api/admin/crm/contact    créer ou modifier un contact
//   POST /api/admin/crm/note       ajouter ou supprimer une note (appel, email, réunion…)
//   GET  /api/admin/crm/pipeline   opportunités en cours et récemment clôturées
//   POST /api/admin/crm/opportunite créer, modifier, faire avancer une opportunité
//   GET  /api/admin/crm/taches     tâches à faire et récemment faites
//   POST /api/admin/crm/tache      créer, cocher, supprimer une tâche
//   GET  /api/admin/crm/export     export CSV des contacts (Excel)
//   GET  /api/admin/crm/entreprises  liste des entreprises
//   GET  /api/admin/crm/entreprise   fiche entreprise (?id=)
//   POST /api/admin/crm/entreprise   créer ou modifier une entreprise

import {
  HttpError, json, clean, readJson, EMAIL_RE, esc, emailLayout, emailButton,
  sendEmail, notifyEmail, upsertClient, validDate, parisNow,
} from './lib.js';
import { requireSession } from './auth.js';
import { journal } from './securite.js';

const int = (v) => Number.parseInt(v, 10);
const centimes = (v) => Math.max(0, Math.round(Number(String(v ?? '').replace(/\s/g, '').replace(',', '.')) * 100) || 0);

export const STATUTS = ['prospect', 'client', 'ancien'];
export const SOURCES = ['formulaire', 'rendez_vous', 'boutique', 'recommandation', 'reseaux', 'salon', 'appel', 'autre'];
// Étapes du pipeline et probabilité de signature par défaut
export const ETAPES = { nouveau: 10, qualifie: 25, proposition: 50, negociation: 75, gagne: 100, perdu: 0 };
const TYPES_NOTE = ['note', 'appel', 'email', 'reunion'];

const etiquettes = (v) => [...new Set(String(v || '').split(',').map((t) => clean(t, 30).toLowerCase()).filter(Boolean))].slice(0, 12).join(',');
// Rattache un contact à la fiche entreprise du même nom (créée si besoin) ; nom vide = aucun rattachement
export async function lierEntreprise(env, clientId, nom) {
  const n = clean(nom, 120);
  if (!n) {
    await env.DB.prepare('UPDATE clients SET entreprise_id = NULL, entreprise = NULL WHERE id = ?').bind(clientId).run();
    return null;
  }
  await env.DB.prepare('INSERT OR IGNORE INTO entreprises (nom) VALUES (?)').bind(n).run();
  const e = await env.DB.prepare('SELECT id, nom FROM entreprises WHERE nom = ? COLLATE NOCASE').bind(n).first();
  await env.DB.prepare('UPDATE clients SET entreprise_id = ?, entreprise = ? WHERE id = ?').bind(e.id, e.nom, clientId).run();
  return e.id;
}

const toucher = (env, clientId) => env.DB.prepare("UPDATE clients SET dernier_contact = datetime('now') WHERE id = ?").bind(clientId).run();

/* ---------------------------------------------------------------- automatismes (appelés par le site) */

// Ne bloque jamais le site : si le CRM n'est pas encore migré, l'événement est simplement ignoré
export async function crmEvenement(env, type, d) {
  try {
    if (type === 'demande') {
      await env.DB.batch([
        env.DB.prepare("UPDATE clients SET source = COALESCE(source, 'formulaire'), dernier_contact = datetime('now') WHERE id = ?").bind(d.clientId),
        env.DB.prepare("INSERT INTO opportunites (client_id, titre, etape, probabilite, origine) VALUES (?, ?, 'nouveau', ?, 'formulaire')").bind(d.clientId, `Demande : ${d.sujet}`, ETAPES.nouveau),
        env.DB.prepare("INSERT INTO taches (client_id, titre, echeance, priorite) VALUES (?, ?, date('now', '+1 day'), 'haute')").bind(d.clientId, `Répondre à la demande « ${d.sujet} »`),
      ]);
    }
    if (type === 'rdv') {
      const existe = await env.DB.prepare("SELECT id FROM opportunites WHERE client_id = ? AND etape NOT IN ('gagne', 'perdu') LIMIT 1").bind(d.clientId).first();
      await env.DB.batch([
        env.DB.prepare("UPDATE clients SET source = COALESCE(source, 'rendez_vous'), dernier_contact = datetime('now') WHERE id = ?").bind(d.clientId),
        existe
          ? env.DB.prepare("UPDATE opportunites SET etape = CASE WHEN etape = 'nouveau' THEN 'qualifie' ELSE etape END, probabilite = MAX(probabilite, ?), maj_le = datetime('now') WHERE id = ?").bind(ETAPES.qualifie, existe.id)
          : env.DB.prepare("INSERT INTO opportunites (client_id, titre, etape, probabilite, origine) VALUES (?, ?, 'qualifie', ?, 'rendez_vous')").bind(d.clientId, d.service, ETAPES.qualifie),
        env.DB.prepare('INSERT INTO taches (client_id, titre, echeance) VALUES (?, ?, ?)').bind(d.clientId, `Préparer le rendez-vous (${d.service}) et envoyer le lien de visio`, d.date),
      ]);
    }
    if (type === 'paiement') {
      await env.DB.prepare("UPDATE clients SET statut = 'client', dernier_contact = datetime('now') WHERE id = ?").bind(d.clientId).run();
    }
    if (type === 'boutique') {
      await env.DB.prepare("UPDATE clients SET statut = 'client', source = COALESCE(source, 'boutique'), dernier_contact = datetime('now') WHERE id = ?").bind(d.clientId).run();
    }
  } catch (e) {
    console.error('CRM', type, e);
  }
}

/* ---------------------------------------------------------------- contacts */

export async function adminContacts(request, env) {
  await requireSession(request, env, 'admin');
  const { results } = await env.DB.prepare(`SELECT c.id, c.email, c.nom, c.telephone, c.entreprise, c.entreprise_id, c.poste, c.ville, c.pays, c.statut, c.source, c.etiquettes,
      c.cree_le, c.derniere_connexion, c.dernier_contact, c.acces_premium, c.doit_changer_mdp, c.acces_cree_le, c.mdp_maj_le,
      (SELECT COUNT(*) FROM projets p WHERE p.client_id = c.id) AS nb_projets,
      (SELECT COUNT(*) FROM rendez_vous r WHERE r.email = c.email) AS nb_rdv,
      (SELECT COALESCE(SUM(montant_ttc), 0) FROM factures f WHERE f.client_id = c.id AND f.statut = 'payee') AS ca,
      (SELECT COALESCE(SUM(montant_ttc), 0) FROM factures f WHERE f.client_id = c.id AND f.statut = 'a_payer') AS a_payer,
      (SELECT COUNT(*) FROM opportunites o WHERE o.client_id = c.id AND o.etape NOT IN ('gagne', 'perdu')) AS nb_opportunites,
      (SELECT COALESCE(SUM(montant_ht), 0) FROM opportunites o WHERE o.client_id = c.id AND o.etape NOT IN ('gagne', 'perdu')) AS montant_opportunites,
      (SELECT COUNT(*) FROM taches t WHERE t.client_id = c.id AND t.faite = 0) AS nb_taches
    FROM clients c ORDER BY COALESCE(c.dernier_contact, c.cree_le) DESC LIMIT 1000`).all();
  return json({ clients: results, statuts: STATUTS, sources: SOURCES });
}

export async function adminFiche(request, env) {
  await requireSession(request, env, 'admin');
  const id = int(new URL(request.url).searchParams.get('id'));
  const client = await env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(id).first();
  if (!client) throw new HttpError(404, 'Contact introuvable.');
  delete client.mot_de_passe;
  const all = (sql, ...b) => env.DB.prepare(sql).bind(...b).all().then((r) => r.results);
  const [opportunites, notes, taches, projets, factures, rdv, demandes, commandes, messages, devis, entreprise] = await Promise.all([
    all('SELECT * FROM opportunites WHERE client_id = ? ORDER BY cloture_le IS NOT NULL, id DESC', id),
    all('SELECT * FROM crm_notes WHERE client_id = ? ORDER BY id DESC LIMIT 200', id),
    all('SELECT * FROM taches WHERE client_id = ? ORDER BY faite, echeance IS NULL, echeance, id DESC LIMIT 100', id),
    all('SELECT id, titre, statut, avancement, cree_le, maj_le FROM projets WHERE client_id = ? ORDER BY id DESC', id),
    all('SELECT id, numero, objet, montant_ttc, emise_le, echeance, statut, payee_le, mode_paiement, jeton FROM factures WHERE client_id = ? ORDER BY id DESC', id),
    all('SELECT id, service, date, heure, statut, message, cree_le FROM rendez_vous WHERE email = ? ORDER BY date DESC', client.email),
    all('SELECT id, sujet, message, traite, cree_le FROM contacts WHERE email = ? ORDER BY id DESC', client.email),
    all("SELECT id, reference, montant_ttc, statut, cree_le, payee_le FROM commandes WHERE client_id = ? AND statut = 'payee' ORDER BY id DESC", id),
    all("SELECT m.id, m.auteur, m.contenu, m.cree_le, p.titre FROM messages m JOIN projets p ON p.id = m.projet_id WHERE p.client_id = ? ORDER BY m.id DESC LIMIT 30", id),
    all('SELECT id, numero, objet, montant_ht, montant_ttc, statut, emis_le, valide_jusqu, accepte_le, accepte_par, refuse_le, raison_refus, jeton FROM devis WHERE client_id = ? ORDER BY id DESC', id),
    client.entreprise_id ? env.DB.prepare('SELECT * FROM entreprises WHERE id = ?').bind(client.entreprise_id).first() : null,
  ]);
  const collegues = client.entreprise_id
    ? await all('SELECT id, nom, email, poste, statut FROM clients WHERE entreprise_id = ? AND id <> ? ORDER BY nom', client.entreprise_id, id) : [];
  return json({ client, entreprise, collegues, opportunites, notes, taches, projets, factures, devis, rdv, demandes, commandes, messages, statuts: STATUTS, sources: SOURCES, etapes: ETAPES });
}

export async function adminContactSave(request, env) {
  const s = await requireSession(request, env, 'admin');
  const d = await readJson(request);
  const champs = {
    nom: clean(d.nom, 100), entreprise: clean(d.entreprise, 120), telephone: clean(d.telephone, 30), poste: clean(d.poste, 80),
    adresse: clean(d.adresse, 300), ville: clean(d.ville, 80), pays: clean(d.pays, 60), site_web: clean(d.site_web, 200),
    siret: clean(d.siret, 20), etiquettes: etiquettes(d.etiquettes),
    statut: STATUTS.includes(d.statut) ? d.statut : 'prospect', source: SOURCES.includes(d.source) ? d.source : null,
  };
  let id = int(d.id);
  if (!id) {
    const email = clean(d.email, 254).toLowerCase();
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Email invalide.');
    const existant = await env.DB.prepare('SELECT id FROM clients WHERE email = ?').bind(email).first();
    if (existant) throw new HttpError(409, 'Ce contact existe déjà : ouvrez sa fiche pour le modifier.');
    id = (await upsertClient(env, { email, nom: champs.nom, telephone: champs.telephone })).id;
    await journal(env, request, s.email, 'Contact créé', email);
  } else if (!await env.DB.prepare('SELECT id FROM clients WHERE id = ?').bind(id).first()) {
    throw new HttpError(404, 'Contact introuvable.');
  }
  const cols = Object.keys(champs).filter((c) => c !== 'entreprise');
  await env.DB.prepare(`UPDATE clients SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
    .bind(...cols.map((c) => champs[c] || null), id).run();
  if (d.entreprise !== undefined) await lierEntreprise(env, id, champs.entreprise);
  return json({ ok: true, id, message: int(d.id) ? 'Fiche enregistrée.' : 'Contact créé.' });
}

/* ---------------------------------------------------------------- notes d'échanges */

export async function adminNote(request, env) {
  const s = await requireSession(request, env, 'admin');
  const d = await readJson(request);
  if (d.supprimer) {
    await env.DB.prepare('DELETE FROM crm_notes WHERE id = ?').bind(int(d.id)).run();
    return json({ ok: true, message: 'Note supprimée.' });
  }
  const clientId = int(d.client_id);
  const contenu = clean(d.contenu, 5000);
  if (!contenu) throw new HttpError(400, 'La note est vide.');
  if (!await env.DB.prepare('SELECT id FROM clients WHERE id = ?').bind(clientId).first()) throw new HttpError(404, 'Contact introuvable.');
  await env.DB.prepare('INSERT INTO crm_notes (client_id, opportunite_id, type, contenu, auteur) VALUES (?, ?, ?, ?, ?)')
    .bind(clientId, int(d.opportunite_id) || null, TYPES_NOTE.includes(d.type) ? d.type : 'note', contenu, s.email).run();
  await toucher(env, clientId);
  return json({ ok: true, message: 'Échange ajouté à l’historique.' });
}

/* ---------------------------------------------------------------- opportunités (pipeline) */

export async function adminPipeline(request, env) {
  await requireSession(request, env, 'admin');
  const { results } = await env.DB.prepare(`SELECT o.*, c.nom, c.entreprise, c.email,
      (SELECT MIN(t.echeance) FROM taches t WHERE t.opportunite_id = o.id AND t.faite = 0) AS prochaine_tache
    FROM opportunites o JOIN clients c ON c.id = o.client_id
    WHERE o.etape NOT IN ('gagne', 'perdu') OR o.cloture_le >= datetime('now', '-90 days')
    ORDER BY o.maj_le DESC LIMIT 500`).all();
  return json({ opportunites: results, etapes: ETAPES, aujourdhui: parisNow().date });
}

export async function adminOpportunite(request, env) {
  const s = await requireSession(request, env, 'admin');
  const d = await readJson(request);
  if (d.supprimer) {
    const id = int(d.id);
    await env.DB.batch([
      env.DB.prepare('UPDATE taches SET opportunite_id = NULL WHERE opportunite_id = ?').bind(id),
      env.DB.prepare('UPDATE crm_notes SET opportunite_id = NULL WHERE opportunite_id = ?').bind(id),
      env.DB.prepare('DELETE FROM opportunites WHERE id = ?').bind(id),
    ]);
    return json({ ok: true, message: 'Opportunité supprimée.' });
  }
  const etape = d.etape in ETAPES ? d.etape : null;
  const echeance = validDate(d.echeance) ? d.echeance : null;
  const proba = d.probabilite === undefined || d.probabilite === '' ? null : Math.max(0, Math.min(100, int(d.probabilite) || 0));

  if (!int(d.id)) {
    const clientId = int(d.client_id);
    const titre = clean(d.titre, 150);
    if (!titre) throw new HttpError(400, 'Donnez un titre à l’opportunité.');
    if (!await env.DB.prepare('SELECT id FROM clients WHERE id = ?').bind(clientId).first()) throw new HttpError(404, 'Contact introuvable.');
    const e = etape || 'nouveau';
    const { meta } = await env.DB.prepare("INSERT INTO opportunites (client_id, titre, montant_ht, etape, probabilite, echeance, origine) VALUES (?, ?, ?, ?, ?, ?, 'manuel')")
      .bind(clientId, titre, centimes(d.montant), e, proba ?? ETAPES[e], echeance).run();
    await toucher(env, clientId);
    return json({ ok: true, id: meta.last_row_id, message: 'Opportunité créée.' });
  }

  const o = await env.DB.prepare('SELECT * FROM opportunites WHERE id = ?').bind(int(d.id)).first();
  if (!o) throw new HttpError(404, 'Opportunité introuvable.');
  const nouvelleEtape = etape || o.etape;
  const cloture = ['gagne', 'perdu'].includes(nouvelleEtape);
  // Changer d'étape remet la probabilité par défaut de l'étape, sauf si l'administrateur en fixe une
  const probabilite = proba ?? (etape && etape !== o.etape ? ETAPES[etape] : o.probabilite);
  await env.DB.prepare(`UPDATE opportunites SET titre = ?, montant_ht = ?, etape = ?, probabilite = ?, echeance = ?, raison_perte = ?,
      cloture_le = CASE WHEN ? THEN COALESCE(cloture_le, datetime('now')) ELSE NULL END, maj_le = datetime('now') WHERE id = ?`)
    .bind(clean(d.titre, 150) || o.titre, d.montant === undefined ? o.montant_ht : centimes(d.montant), nouvelleEtape, probabilite,
      d.echeance === undefined ? o.echeance : echeance, nouvelleEtape === 'perdu' ? clean(d.raison_perte, 300) || o.raison_perte : null, cloture ? 1 : 0, o.id).run();
  if (nouvelleEtape === 'gagne' && o.etape !== 'gagne') {
    await env.DB.prepare("UPDATE clients SET statut = 'client' WHERE id = ?").bind(o.client_id).run();
    await journal(env, request, s.email, 'Opportunité gagnée', o.titre);
  }
  if (etape && etape !== o.etape) await toucher(env, o.client_id);
  const msg = { gagne: 'Bravo ! Opportunité gagnée : le contact passe en client.', perdu: 'Opportunité classée perdue.' }[nouvelleEtape];
  return json({ ok: true, message: etape && etape !== o.etape && msg ? msg : 'Opportunité mise à jour.' });
}

/* ---------------------------------------------------------------- tâches */

export async function adminTaches(request, env) {
  await requireSession(request, env, 'admin');
  const { results } = await env.DB.prepare(`SELECT t.*, c.nom, c.entreprise, c.email, o.titre AS opportunite
    FROM taches t LEFT JOIN clients c ON c.id = t.client_id LEFT JOIN opportunites o ON o.id = t.opportunite_id
    WHERE t.faite = 0 OR t.faite_le >= datetime('now', '-30 days')
    ORDER BY t.faite, t.echeance IS NULL, t.echeance, t.priorite = 'haute' DESC, t.id DESC LIMIT 500`).all();
  return json({ taches: results, aujourdhui: parisNow().date });
}

export async function adminTache(request, env) {
  await requireSession(request, env, 'admin');
  const d = await readJson(request);
  const id = int(d.id);
  if (id && d.supprimer) {
    await env.DB.prepare('DELETE FROM taches WHERE id = ?').bind(id).run();
    return json({ ok: true, message: 'Tâche supprimée.' });
  }
  if (id && d.faite !== undefined) {
    await env.DB.prepare("UPDATE taches SET faite = ?, faite_le = CASE WHEN ? THEN datetime('now') ELSE NULL END WHERE id = ?").bind(d.faite ? 1 : 0, d.faite ? 1 : 0, id).run();
    const t = await env.DB.prepare('SELECT client_id FROM taches WHERE id = ?').bind(id).first();
    if (d.faite && t?.client_id) await toucher(env, t.client_id);
    return json({ ok: true, message: d.faite ? 'Tâche terminée ✓' : 'Tâche rouverte.' });
  }
  if (id && d.echeance !== undefined) {
    await env.DB.prepare('UPDATE taches SET echeance = ? WHERE id = ?').bind(validDate(d.echeance) ? d.echeance : null, id).run();
    return json({ ok: true, message: 'Échéance modifiée.' });
  }
  const titre = clean(d.titre, 200);
  if (!titre) throw new HttpError(400, 'Décrivez la tâche.');
  await env.DB.prepare('INSERT INTO taches (client_id, opportunite_id, titre, echeance, priorite) VALUES (?, ?, ?, ?, ?)')
    .bind(int(d.client_id) || null, int(d.opportunite_id) || null, titre, validDate(d.echeance) ? d.echeance : null, d.priorite === 'haute' ? 'haute' : 'normale').run();
  return json({ ok: true, message: 'Tâche ajoutée.' });
}

/* ---------------------------------------------------------------- export CSV */

export async function adminExport(request, env) {
  const s = await requireSession(request, env, 'admin');
  const { results } = await env.DB.prepare(`SELECT c.nom, c.entreprise, c.email, c.telephone, c.poste, c.ville, c.pays, c.statut, c.source, c.etiquettes,
      c.cree_le, c.dernier_contact,
      (SELECT COALESCE(SUM(montant_ttc), 0) FROM factures f WHERE f.client_id = c.id AND f.statut = 'payee') AS ca
    FROM clients c ORDER BY c.nom`).all();
  const cellule = (v) => {
    const t = String(v ?? '');
    // Neutralise les formules Excel (=, +, -, @) et échappe les guillemets
    return `"${(/^[=+\-@]/.test(t) ? `'${t}` : t).replace(/"/g, '""')}"`;
  };
  const entetes = ['Nom', 'Entreprise', 'Email', 'Téléphone', 'Poste', 'Ville', 'Pays', 'Statut', 'Source', 'Étiquettes', 'Créé le', 'Dernier contact', 'CA encaissé TTC (€)'];
  const lignes = results.map((r) => [r.nom, r.entreprise, r.email, r.telephone, r.poste, r.ville, r.pays, r.statut, r.source, r.etiquettes, r.cree_le, r.dernier_contact, (r.ca / 100).toFixed(2).replace('.', ',')].map(cellule).join(';'));
  await journal(env, request, s.email, 'Export des contacts', `${results.length} contacts`);
  return new Response(`﻿${entetes.map(cellule).join(';')}\r\n${lignes.join('\r\n')}\r\n`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="contacts-renaissance-itech-${parisNow().date}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}

/* ---------------------------------------------------------------- tableau de bord et rappel du matin */

export async function resumeCrm(env) {
  try {
    const [pipeline, gagnees, taches] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(montant_ht), 0) AS total, COALESCE(SUM(montant_ht * probabilite / 100), 0) AS pondere FROM opportunites WHERE etape NOT IN ('gagne', 'perdu')").first(),
      env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(montant_ht), 0) AS total FROM opportunites WHERE etape = 'gagne' AND cloture_le >= date('now', 'start of month')").first(),
      env.DB.prepare(`SELECT t.id, t.titre, t.echeance, t.priorite, t.client_id, c.nom, c.entreprise, c.email FROM taches t LEFT JOIN clients c ON c.id = t.client_id
        WHERE t.faite = 0 AND t.echeance IS NOT NULL AND t.echeance <= date('now') ORDER BY t.echeance, t.priorite = 'haute' DESC LIMIT 8`).all().then((r) => r.results),
    ]);
    return { crm: { pipeline, gagnees_mois: gagnees, taches_du_jour: taches } };
  } catch (e) {
    console.error('Tableau de bord CRM', e);
    return {};
  }
}

// Chaque matin : les tâches du jour et en retard, par email à l'administrateur
export async function rappelTaches(env) {
  try {
    const { results } = await env.DB.prepare(`SELECT t.titre, t.echeance, t.priorite, c.nom, c.entreprise, c.email FROM taches t LEFT JOIN clients c ON c.id = t.client_id
      WHERE t.faite = 0 AND t.echeance IS NOT NULL AND t.echeance <= ? ORDER BY t.echeance LIMIT 30`).bind(parisNow().date).all();
    if (!results.length) return;
    const aujourdhui = parisNow().date;
    const base = env.SITE_URL || 'https://www.renaissance-itech.com';
    await sendEmail(env, {
      to: notifyEmail(env), subject: `${results.length} tâche(s) à faire aujourd’hui`,
      html: emailLayout('Vos tâches du jour', `<ul>${results.map((t) => `<li>${t.priorite === 'haute' ? '<strong>[Prioritaire]</strong> ' : ''}${esc(t.titre)}${t.nom || t.email ? ` · ${esc(t.entreprise || t.nom || t.email)}` : ''}${t.echeance < aujourdhui ? ' <span style="color:#B91C1C">(en retard)</span>' : ''}</li>`).join('')}</ul>${emailButton(`${base}/admin#taches`, 'Ouvrir mes tâches')}`),
    });
  } catch (e) {
    console.error('Rappel des tâches', e);
  }
}

/* ---------------------------------------------------------------- entreprises */

const TAILLES = ['1-9', '10-49', '50-249', '250+'];

export async function adminEntreprises(request, env) {
  await requireSession(request, env, 'admin');
  const { results } = await env.DB.prepare(`SELECT e.*,
      (SELECT COUNT(*) FROM clients c WHERE c.entreprise_id = e.id) AS nb_contacts,
      (SELECT COALESCE(SUM(f.montant_ttc), 0) FROM factures f JOIN clients c ON c.id = f.client_id WHERE c.entreprise_id = e.id AND f.statut = 'payee') AS ca,
      (SELECT COALESCE(SUM(o.montant_ht), 0) FROM opportunites o JOIN clients c ON c.id = o.client_id WHERE c.entreprise_id = e.id AND o.etape NOT IN ('gagne', 'perdu')) AS montant_opportunites,
      (SELECT MAX(COALESCE(c.dernier_contact, c.cree_le)) FROM clients c WHERE c.entreprise_id = e.id) AS dernier_contact,
      (SELECT CASE WHEN SUM(c.statut = 'client') > 0 THEN 'client' ELSE 'prospect' END FROM clients c WHERE c.entreprise_id = e.id) AS statut
    FROM entreprises e ORDER BY dernier_contact DESC LIMIT 1000`).all();
  return json({ entreprises: results, tailles: TAILLES });
}

export async function adminEntreprise(request, env) {
  await requireSession(request, env, 'admin');
  const id = int(new URL(request.url).searchParams.get('id'));
  const entreprise = await env.DB.prepare('SELECT * FROM entreprises WHERE id = ?').bind(id).first();
  if (!entreprise) throw new HttpError(404, 'Entreprise introuvable.');
  const all = (sql) => env.DB.prepare(sql).bind(id).all().then((r) => r.results);
  const [contacts, opportunites, factures, devis, notes] = await Promise.all([
    all('SELECT id, nom, email, telephone, poste, statut, dernier_contact, acces_premium FROM clients WHERE entreprise_id = ? ORDER BY nom'),
    all("SELECT o.*, c.nom, c.email FROM opportunites o JOIN clients c ON c.id = o.client_id WHERE c.entreprise_id = ? ORDER BY o.cloture_le IS NOT NULL, o.id DESC"),
    all('SELECT f.id, f.numero, f.objet, f.montant_ttc, f.statut, f.echeance, f.emise_le, f.payee_le, f.jeton, c.nom FROM factures f JOIN clients c ON c.id = f.client_id WHERE c.entreprise_id = ? ORDER BY f.id DESC'),
    all('SELECT d.id, d.numero, d.objet, d.montant_ht, d.montant_ttc, d.statut, d.emis_le, d.valide_jusqu, d.jeton, c.nom FROM devis d JOIN clients c ON c.id = d.client_id WHERE c.entreprise_id = ? ORDER BY d.id DESC'),
    all('SELECT n.*, c.nom, c.id AS client_id FROM crm_notes n JOIN clients c ON c.id = n.client_id WHERE c.entreprise_id = ? ORDER BY n.id DESC LIMIT 50'),
  ]);
  return json({ entreprise, contacts, opportunites, factures, devis, notes, tailles: TAILLES });
}

export async function adminEntrepriseSave(request, env) {
  const s = await requireSession(request, env, 'admin');
  const d = await readJson(request);
  const nom = clean(d.nom, 120);
  if (!nom) throw new HttpError(400, 'Indiquez le nom de l’entreprise.');
  const champs = {
    nom, siret: clean(d.siret, 20).replace(/\s/g, ''), tva_intracom: clean(d.tva_intracom, 20).replace(/\s/g, '').toUpperCase(),
    adresse: clean(d.adresse, 300), code_postal: clean(d.code_postal, 12), ville: clean(d.ville, 80), pays: clean(d.pays, 60),
    site_web: clean(d.site_web, 200), secteur: clean(d.secteur, 80), taille: TAILLES.includes(d.taille) ? d.taille : '', etiquettes: etiquettes(d.etiquettes),
  };
  if (champs.siret && !/^\d{9}(\d{5})?$/.test(champs.siret)) throw new HttpError(400, 'SIRET invalide : 14 chiffres (ou SIREN : 9 chiffres).');
  const homonyme = await env.DB.prepare('SELECT id FROM entreprises WHERE nom = ? COLLATE NOCASE').bind(nom).first();
  let id = int(d.id);
  if (homonyme && homonyme.id !== id) throw new HttpError(409, 'Une entreprise porte déjà ce nom.');
  const cols = Object.keys(champs);
  if (id) {
    await env.DB.prepare(`UPDATE entreprises SET ${cols.map((c) => `${c} = ?`).join(', ')}, maj_le = datetime('now') WHERE id = ?`).bind(...cols.map((c) => champs[c] || null), id).run();
    await env.DB.prepare('UPDATE clients SET entreprise = ? WHERE entreprise_id = ?').bind(nom, id).run();
  } else {
    const { meta } = await env.DB.prepare(`INSERT INTO entreprises (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).bind(...cols.map((c) => champs[c] || null)).run();
    id = meta.last_row_id;
    await journal(env, request, s.email, 'Entreprise créée', nom);
  }
  // Rattacher un contact existant à cette entreprise
  if (int(d.contact_id)) await lierEntreprise(env, int(d.contact_id), nom);
  return json({ ok: true, id, message: int(d.id) ? 'Entreprise enregistrée.' : 'Entreprise créée.' });
}
