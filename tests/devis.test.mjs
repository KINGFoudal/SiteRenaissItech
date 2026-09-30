// Entreprises (plusieurs contacts) et devis : envoi, acceptation en ligne, acompte, solde, refus, expiration
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { demarrer } from './helpers.mjs';

let t;
before(async () => { t = await demarrer(8830); });
after(async () => { await t?.arreter(); });

const contactId = (email) => t.sql(`SELECT id FROM clients WHERE email = '${email}'`)[0]?.id;
const creerDevis = (extra = {}) => t.api('/api/admin/devis/creer', {
  email: 'dg@pme.fr', nom: 'Marie Martin', entreprise: 'PME Conseil', objet: 'Assistant IA interne',
  lignes: [{ libelle: 'Mise en place', quantite: 1, prix_unitaire: '3000' }, { libelle: 'Formation', quantite: 2, prix_unitaire: '500' }],
  taux_tva: 20, acompte_pct: 30, envoyer: false, ...extra,
});

test('entreprises : deux contacts rattachés à la même fiche, sans doublon de nom', async () => {
  await t.api('/api/admin/crm/contact', { email: 'a@acme.fr', nom: 'Alice', entreprise: 'ACME', statut: 'prospect' });
  await t.api('/api/admin/crm/contact', { email: 'b@acme.fr', nom: 'Bruno', entreprise: 'acme', statut: 'prospect' });
  const ents = t.sql("SELECT id, nom FROM entreprises WHERE nom = 'ACME' COLLATE NOCASE");
  assert.equal(ents.length, 1);
  const fiche = await t.api(`/api/admin/crm/entreprise?id=${ents[0].id}`);
  assert.equal(fiche.status, 200);
  assert.deepEqual(fiche.data.contacts.map((c) => c.email).sort(), ['a@acme.fr', 'b@acme.fr']);
  const contact = await t.api(`/api/admin/crm/fiche?id=${contactId('a@acme.fr')}`);
  assert.equal(contact.data.entreprise.nom, 'ACME');
  assert.equal(contact.data.collegues[0].email, 'b@acme.fr');
});

test('entreprises : modification, SIRET contrôlé, nom déjà pris refusé', async () => {
  const [e] = t.sql("SELECT id FROM entreprises WHERE nom = 'ACME'");
  assert.equal((await t.api('/api/admin/crm/entreprise', { id: e.id, nom: 'ACME', siret: '123' })).status, 400);
  const ok = await t.api('/api/admin/crm/entreprise', { id: e.id, nom: 'ACME SAS', siret: '123 456 789 00012', adresse: '1 rue de Paris', code_postal: '75001', ville: 'Paris', tva_intracom: 'fr12 345678901' });
  assert.equal(ok.status, 200);
  assert.equal(t.sql(`SELECT entreprise FROM clients WHERE email = 'a@acme.fr'`)[0].entreprise, 'ACME SAS');
  assert.equal(t.sql(`SELECT tva_intracom FROM entreprises WHERE id = ${e.id}`)[0].tva_intracom, 'FR12345678901');
  await t.api('/api/admin/crm/entreprise', { nom: 'Autre' });
  assert.equal((await t.api('/api/admin/crm/entreprise', { nom: 'acme sas' })).status, 409);
});

test('devis : montants, numéro, opportunité « Devis envoyé » et tâche de relance', async () => {
  const r = await creerDevis();
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.match(r.data.devis.numero, /^D-\d{4}-\d{4}$/);
  assert.equal(r.data.devis.montant_ht, 400000);
  assert.equal(r.data.devis.montant_ttc, 480000);
  const id = contactId('dg@pme.fr');
  assert.equal(t.sql(`SELECT etape FROM opportunites WHERE client_id = ${id}`)[0].etape, 'proposition');
  assert.ok(t.sql(`SELECT titre FROM taches WHERE client_id = ${id}`)[0].titre.startsWith('Relancer le devis'));
  assert.equal(t.sql(`SELECT e.nom FROM clients c JOIN entreprises e ON e.id = c.entreprise_id WHERE c.id = ${id}`)[0].nom, 'PME Conseil');
});

test('devis : page publique sans champs internes, validations d’acceptation', async () => {
  const { data } = await creerDevis();
  const pub = await t.api(`/api/devis?t=${data.devis.jeton}`, undefined, { admin: false });
  assert.equal(pub.status, 200);
  for (const cache of ['id', 'client_id', 'jeton', 'accepte_ip']) assert.equal(pub.data.devis[cache], undefined, cache);
  assert.equal(pub.data.devis.entreprise, 'PME Conseil');
  assert.equal((await t.api('/api/devis/accepter', { t: data.devis.jeton, nom: 'M', accord: true }, { admin: false })).status, 400);
  assert.equal((await t.api('/api/devis/accepter', { t: data.devis.jeton, nom: 'Marie Martin', accord: false }, { admin: false })).status, 400);
  assert.equal((await t.api('/api/devis?t=inconnu-inconnu-inconnu', undefined, { admin: false })).status, 404);
});

test('devis accepté : client, opportunité gagnée, acompte de 30 % puis facture de solde', async () => {
  const { data } = await creerDevis();
  const ok = await t.api('/api/devis/accepter', { t: data.devis.jeton, nom: 'Marie Martin', accord: true }, { admin: false });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.ok(ok.data.acompte.paiement.startsWith('/api/paiement/facture?t='));
  const [dv] = t.sql(`SELECT statut, accepte_par, accepte_ip, opportunite_id FROM devis WHERE id = ${data.devis.id}`);
  assert.equal(dv.statut, 'accepte');
  assert.equal(dv.accepte_par, 'Marie Martin');
  assert.ok(dv.accepte_ip);
  assert.equal(t.sql(`SELECT etape FROM opportunites WHERE id = ${dv.opportunite_id}`)[0].etape, 'gagne');
  assert.equal(t.sql(`SELECT statut FROM clients WHERE email = 'dg@pme.fr'`)[0].statut, 'client');
  const [acompte] = t.sql(`SELECT montant_ht, montant_ttc, type FROM factures WHERE devis_id = ${data.devis.id}`);
  assert.deepEqual(acompte, { montant_ht: 120000, montant_ttc: 144000, type: 'acompte' });
  // Deuxième acceptation : refusée
  assert.equal((await t.api('/api/devis/accepter', { t: data.devis.jeton, nom: 'Marie Martin', accord: true }, { admin: false })).status, 409);

  const solde = await t.api('/api/admin/devis/action', { id: data.devis.id, action: 'facturer', envoyer: false });
  assert.equal(solde.status, 200, JSON.stringify(solde.data));
  assert.equal(solde.data.facture.montant_ht, 280000);
  assert.equal(solde.data.facture.montant_ttc, 336000);
  assert.equal(t.sql(`SELECT statut FROM devis WHERE id = ${data.devis.id}`)[0].statut, 'facture');
  // La facture de solde affiche les coordonnées de l'entreprise cliente
  const [f] = t.sql(`SELECT jeton FROM factures WHERE id = ${solde.data.facture.id}`);
  const pub = await t.api(`/api/facture?t=${f.jeton}`, undefined, { admin: false });
  assert.equal(pub.data.facture.entreprise, 'PME Conseil');
});

test('devis sans acompte : acceptation sans facture ; refus → opportunité perdue avec la raison', async () => {
  const a = await creerDevis({ acompte_pct: 0 });
  const ok = await t.api('/api/devis/accepter', { t: a.data.devis.jeton, nom: 'Marie Martin', accord: true }, { admin: false });
  assert.equal(ok.data.acompte, null);
  assert.equal(t.sql(`SELECT COUNT(*) AS n FROM factures WHERE devis_id = ${a.data.devis.id}`)[0].n, 0);

  const r = await creerDevis({ email: 'autre@pme.fr', nom: 'Paul' });
  const ko = await t.api('/api/devis/refuser', { t: r.data.devis.jeton, raison: 'Budget reporté' }, { admin: false });
  assert.equal(ko.status, 200);
  const [dv] = t.sql(`SELECT statut, raison_refus, opportunite_id FROM devis WHERE id = ${r.data.devis.id}`);
  assert.equal(dv.statut, 'refuse');
  assert.equal(dv.raison_refus, 'Budget reporté');
  const [o] = t.sql(`SELECT etape, raison_perte FROM opportunites WHERE id = ${dv.opportunite_id}`);
  assert.equal(o.etape, 'perdu');
  assert.match(o.raison_perte, /Budget reporté/);
});

test('devis expiré : acceptation impossible, statut mis à jour chaque matin', async () => {
  const { data } = await creerDevis();
  t.sql(`UPDATE devis SET valide_jusqu = date('now', '-1 day') WHERE id = ${data.devis.id}`);
  const pub = await t.api(`/api/devis?t=${data.devis.jeton}`, undefined, { admin: false });
  assert.equal(pub.data.devis.statut, 'expire');
  assert.equal((await t.api('/api/devis/accepter', { t: data.devis.jeton, nom: 'Marie Martin', accord: true }, { admin: false })).status, 409);
  await t.planifie('12 7 * * *');
  assert.equal(t.sql(`SELECT statut FROM devis WHERE id = ${data.devis.id}`)[0].statut, 'expire');
});

test('devis : actions d’administration (annuler, dupliquer) et liste', async () => {
  const { data } = await creerDevis();
  const dup = await t.api('/api/admin/devis/action', { id: data.devis.id, action: 'dupliquer' });
  assert.equal(dup.status, 200);
  assert.notEqual(dup.data.devis.numero, data.devis.numero);
  assert.equal((await t.api('/api/admin/devis/action', { id: data.devis.id, action: 'annuler' })).status, 200);
  assert.equal((await t.api('/api/admin/devis/action', { id: data.devis.id, action: 'facturer' })).status, 409);
  const liste = await t.api('/api/admin/devis');
  assert.ok(liste.data.devis.length >= 2);
  assert.equal((await t.api('/api/admin/devis', undefined, { admin: false })).status, 401);
});
