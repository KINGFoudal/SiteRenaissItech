// CRM : automatismes du site, contacts, opportunités, tâches, export et nettoyage RGPD
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { demarrer } from './helpers.mjs';

let t;
before(async () => { t = await demarrer(8820); });
after(async () => { await t?.arreter(); });

const contact = (email) => t.sql(`SELECT * FROM clients WHERE email = '${email}'`)[0];

test('une demande de contact crée le contact, une opportunité et une tâche', async () => {
  const r = await t.api('/api/contact', { nom: 'Awa Diallo', email: 'awa@pme.gn', sujet: 'Automatisation IA', message: 'Je veux automatiser mes factures.' }, { admin: false });
  assert.equal(r.status, 200);
  const c = contact('awa@pme.gn');
  assert.equal(c.statut, 'prospect');
  assert.equal(c.source, 'formulaire');
  assert.equal(t.sql(`SELECT COUNT(*) AS n FROM opportunites WHERE client_id = ${c.id}`)[0].n, 1);
  assert.equal(t.sql(`SELECT COUNT(*) AS n FROM taches WHERE client_id = ${c.id} AND faite = 0`)[0].n, 1);
});

test('un rendez-vous qualifie l’opportunité et ajoute une tâche de préparation', async () => {
  const jour = new Date(Date.now() + 7 * 864e5);
  while ([0, 6].includes(jour.getUTCDay())) jour.setUTCDate(jour.getUTCDate() + 1);
  const r = await t.api('/api/rendez-vous', { service: 'IA privée & souveraine', date: jour.toISOString().slice(0, 10), heure: '10:00', nom: 'Awa Diallo', email: 'awa@pme.gn' }, { admin: false });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const c = contact('awa@pme.gn');
  assert.deepEqual(t.sql(`SELECT etape FROM opportunites WHERE client_id = ${c.id}`).map((o) => o.etape), ['qualifie']);
  assert.equal(t.sql(`SELECT COUNT(*) AS n FROM taches WHERE client_id = ${c.id} AND faite = 0`)[0].n, 2);
});

test('contacts : création, doublon refusé, modification', async () => {
  const cree = await t.api('/api/admin/crm/contact', { email: 'jean@corp.fr', nom: 'Jean Dupont', statut: 'prospect', source: 'salon', etiquettes: 'Salon, IA, ia' });
  assert.equal(cree.status, 200);
  assert.equal(contact('jean@corp.fr').etiquettes, 'salon,ia');
  assert.equal((await t.api('/api/admin/crm/contact', { email: 'jean@corp.fr' })).status, 409);
  assert.equal((await t.api('/api/admin/crm/contact', { email: 'invalide' })).status, 400);
  const maj = await t.api('/api/admin/crm/contact', { id: cree.data.id, nom: 'Jean Dupont', poste: 'DSI', statut: 'prospect' });
  assert.equal(maj.status, 200);
  assert.equal(contact('jean@corp.fr').poste, 'DSI');
});

test('notes : ajout, refus d’une note vide, date du dernier contact mise à jour', async () => {
  const c = contact('jean@corp.fr');
  t.sql(`UPDATE clients SET dernier_contact = '2020-01-01 00:00:00' WHERE id = ${c.id}`);
  assert.equal((await t.api('/api/admin/crm/note', { client_id: c.id, type: 'appel', contenu: 'Appel de 20 min.' })).status, 200);
  assert.equal((await t.api('/api/admin/crm/note', { client_id: c.id, contenu: '   ' })).status, 400);
  assert.notEqual(contact('jean@corp.fr').dernier_contact, '2020-01-01 00:00:00');
});

test('opportunités : montant, étapes, gagnée → contact client', async () => {
  const c = contact('jean@corp.fr');
  const o = await t.api('/api/admin/crm/opportunite', { client_id: c.id, titre: 'Assistant IA', montant: '4 500,50' });
  assert.equal(o.status, 200);
  assert.equal(t.sql(`SELECT montant_ht FROM opportunites WHERE id = ${o.data.id}`)[0].montant_ht, 450050);
  await t.api('/api/admin/crm/opportunite', { id: o.data.id, etape: 'proposition' });
  assert.equal(t.sql(`SELECT probabilite FROM opportunites WHERE id = ${o.data.id}`)[0].probabilite, 50);
  await t.api('/api/admin/crm/opportunite', { id: o.data.id, etape: 'gagne' });
  const [g] = t.sql(`SELECT etape, cloture_le FROM opportunites WHERE id = ${o.data.id}`);
  assert.equal(g.etape, 'gagne');
  assert.ok(g.cloture_le);
  assert.equal(contact('jean@corp.fr').statut, 'client');
  assert.equal((await t.api('/api/admin/crm/opportunite', { client_id: c.id, titre: '' })).status, 400);
});

test('tâches : création, cochée, visible dans les tâches du jour', async () => {
  const c = contact('jean@corp.fr');
  const today = new Date().toISOString().slice(0, 10);
  await t.api('/api/admin/crm/tache', { titre: 'Envoyer le devis', client_id: c.id, echeance: today, priorite: 'haute' });
  const r = await t.api('/api/admin/resume');
  assert.ok(r.data.crm.taches_du_jour.some((x) => x.titre === 'Envoyer le devis'));
  const [tache] = t.sql("SELECT id FROM taches WHERE titre = 'Envoyer le devis'");
  await t.api('/api/admin/crm/tache', { id: tache.id, faite: true });
  assert.equal(t.sql(`SELECT faite FROM taches WHERE id = ${tache.id}`)[0].faite, 1);
});

test('export CSV : en-têtes, formules Excel neutralisées', async () => {
  await t.api('/api/admin/crm/contact', { email: 'formule@exemple.fr', nom: '=HYPERLINK("http://x")', statut: 'prospect' });
  const r = await t.api('/api/admin/crm/export', undefined, { brut: true });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/csv/);
  assert.match(r.data, /"Nom";"Entreprise";"Email"/);
  assert.match(r.data, /"'=HYPERLINK/);
});

test('nettoyage RGPD : un prospect inactif depuis 3 ans disparaît, un client avec facture reste', async () => {
  t.sql(`INSERT INTO clients (email, nom, cree_le, dernier_contact) VALUES ('vieux@exemple.fr', 'Vieux', '2020-01-01 00:00:00', '2020-01-01 00:00:00')`);
  const [v] = t.sql("SELECT id FROM clients WHERE email = 'vieux@exemple.fr'");
  t.sql(`INSERT INTO crm_notes (client_id, contenu, cree_le) VALUES (${v.id}, 'ancienne note', '2020-01-01 00:00:00')`);
  t.sql(`UPDATE clients SET cree_le = '2020-01-01 00:00:00', dernier_contact = '2020-01-01 00:00:00' WHERE email = 'jean@corp.fr'`);
  const [j] = t.sql("SELECT id FROM clients WHERE email = 'jean@corp.fr'");
  t.sql(`INSERT INTO factures (numero, client_id, objet, montant_ht, montant_ttc, emise_le, echeance, jeton) VALUES ('F-TEST-1', ${j.id}, 'x', 100, 100, '2020-01-01', '2020-01-31', 'jeton-test-rgpd-0000000000')`);
  await t.planifie('17 3 * * *');
  assert.equal(contact('vieux@exemple.fr'), undefined);
  assert.equal(t.sql(`SELECT COUNT(*) AS n FROM crm_notes WHERE client_id = ${v.id}`)[0].n, 0);
  assert.ok(contact('jean@corp.fr'));
});
