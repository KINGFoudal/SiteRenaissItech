// Factures, paiement Stripe, boutique et sécurité des routes d'administration
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { demarrer } from './helpers.mjs';

let t;
before(async () => { t = await demarrer(8810); });
after(async () => { await t?.arreter(); });

const nouvelleFacture = (extra = {}) => t.api('/api/admin/facture/creer', {
  email: 'client@exemple.fr', nom: 'Client Test', objet: 'Diagnostic IA',
  lignes: [{ libelle: 'Diagnostic', quantite: 2, prix_unitaire: '250,50' }], taux_tva: 20, envoyer: false, ...extra,
});

test('les routes d’administration refusent un visiteur non connecté', async () => {
  for (const chemin of ['/api/admin/resume', '/api/admin/factures', '/api/admin/clients', '/api/admin/crm/pipeline']) {
    assert.equal((await t.api(chemin, undefined, { admin: false })).status, 401, chemin);
  }
});

test('une requête POST venant d’un autre site est refusée, même avec la session admin (CSRF)', async () => {
  const res = await fetch(`${t.B}/api/admin/facture/creer`, { method: 'POST', headers: { Origin: 'https://pirate.example', Cookie: 'rit_session=jeton-admin-de-test', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 403);
});

test('facture : montants, TVA et numérotation continue', async () => {
  const a = await nouvelleFacture();
  assert.equal(a.status, 200);
  assert.equal(a.data.facture.montant_ttc, 60120); // 2 × 250,50 € HT + 20 %
  const b = await nouvelleFacture({ objet: 'Autre' });
  const n = (x) => Number(x.data.facture.numero.split('-')[2]);
  assert.equal(n(b), n(a) + 1);
});

test('facture : validations', async () => {
  assert.equal((await nouvelleFacture({ email: 'pas-un-email' })).status, 400);
  assert.equal((await nouvelleFacture({ lignes: [] })).status, 400);
  assert.equal((await nouvelleFacture({ objet: '' })).status, 400);
});

test('page publique : champs internes cachés, lien inconnu refusé', async () => {
  const { data } = await nouvelleFacture();
  const pub = await t.api(`/api/facture?t=${data.facture.jeton}`, undefined, { admin: false });
  assert.equal(pub.status, 200);
  for (const cache of ['id', 'client_id', 'stripe_session', 'jeton']) assert.equal(pub.data.facture[cache], undefined, cache);
  assert.equal((await t.api('/api/facture?t=inconnu-inconnu-inconnu', undefined, { admin: false })).status, 404);
});

test('paiement : session Stripe réutilisée, webhook signé, rejeu sans effet', async () => {
  const { data } = await nouvelleFacture();
  const f = data.facture;
  const p1 = await t.api(`/api/paiement/facture?t=${f.jeton}`, undefined, { admin: false });
  const p2 = await t.api(`/api/paiement/facture?t=${f.jeton}`, undefined, { admin: false });
  assert.equal(p1.status, 303);
  assert.equal(p1.headers.get('location'), p2.headers.get('location'));
  const session = p1.headers.get('location').split('/').pop();

  const faux = await t.webhook({ id: 'evt_x', type: 'checkout.session.completed', data: { object: {} } }, 'whsec_mauvais');
  assert.equal(faux.status, 400);

  const evt = { id: `evt_${session}`, type: 'checkout.session.completed', data: { object: { id: session, payment_status: 'paid', metadata: { type: 'facture', facture_id: String(f.id) } } } };
  assert.equal((await t.webhook(evt)).status, 200);
  assert.equal((await t.webhook(evt)).data.deja, true);
  const pub = await t.api(`/api/facture?t=${f.jeton}`, undefined, { admin: false });
  assert.equal(pub.data.facture.statut, 'payee');
  // Une facture payée ne se paie plus : retour vers la facture
  const p3 = await t.api(`/api/paiement/facture?t=${f.jeton}`, undefined, { admin: false });
  assert.match(p3.headers.get('location'), /\/facture\?t=/);
});

test('boutique : prix lus en base, quantité plafonnée, produit non vendu refusé', async () => {
  t.sql("UPDATE produits SET prix_ht = 49000, achat_en_ligne = 1 WHERE id = 'diagnostic-ia'");
  const forge = await t.api('/api/boutique/commande', { lignes: [{ id: 'diagnostic-ia', quantite: 99, prix: 1 }] }, { admin: false });
  assert.equal(forge.status, 200);
  const [c] = t.sql('SELECT montant_ht, lignes FROM commandes ORDER BY id DESC LIMIT 1');
  assert.equal(JSON.parse(c.lignes)[0].quantite, 10);
  assert.equal(c.montant_ht, 490000);
  const refuse = await t.api('/api/boutique/commande', { lignes: [{ id: 'poc-ia', quantite: 1 }] }, { admin: false });
  assert.equal(refuse.status, 409);
});

test('boutique : paiement reçu → facture payée, client, projet ; paiement refusé → commande échouée', async () => {
  const cmd = await t.api('/api/boutique/commande', { lignes: [{ id: 'diagnostic-ia', quantite: 1 }] }, { admin: false });
  const session = cmd.data.url.split('/').pop();
  const [c] = t.sql(`SELECT id, reference FROM commandes WHERE stripe_session = '${session}'`);
  const ok = await t.webhook({ id: 'evt_cmd_ok', type: 'checkout.session.completed', data: { object: { id: session, payment_status: 'paid', metadata: { type: 'commande', commande_id: String(c.id) }, customer_details: { email: 'acheteur@exemple.fr', name: 'Ali Acheteur' } } } });
  assert.equal(ok.status, 200);
  const [apres] = t.sql(`SELECT statut, facture_id, client_id FROM commandes WHERE id = ${c.id}`);
  assert.equal(apres.statut, 'payee');
  assert.ok(apres.facture_id);
  const [client] = t.sql(`SELECT statut FROM clients WHERE id = ${apres.client_id}`);
  assert.equal(client.statut, 'client');

  const cmd2 = await t.api('/api/boutique/commande', { lignes: [{ id: 'diagnostic-ia', quantite: 1 }] }, { admin: false });
  const s2 = cmd2.data.url.split('/').pop();
  const [c2] = t.sql(`SELECT id FROM commandes WHERE stripe_session = '${s2}'`);
  await t.webhook({ id: 'evt_cmd_ko', type: 'checkout.session.async_payment_failed', data: { object: { id: s2, payment_status: 'unpaid', metadata: { type: 'commande', commande_id: String(c2.id) } } } });
  assert.equal(t.sql(`SELECT statut FROM commandes WHERE id = ${c2.id}`)[0].statut, 'echouee');
});

test('relances : une seule par étape, même si la tâche tourne deux fois', async () => {
  const { data } = await nouvelleFacture();
  t.sql(`UPDATE factures SET echeance = date('now', '-15 days') WHERE id = ${data.facture.id}`);
  await t.planifie('12 7 * * *');
  await t.planifie('12 7 * * *');
  // Sans Brevo, l'envoi échoue : la relance est libérée pour un nouvel essai, jamais dupliquée
  const rel = t.sql(`SELECT COUNT(*) AS n FROM relances WHERE facture_id = ${data.facture.id}`);
  assert.ok(rel[0].n <= 1);
});

test('tableau de bord : chiffres et activité', async () => {
  const r = await t.api('/api/admin/resume');
  assert.equal(r.status, 200);
  assert.ok(r.data.finances);
  assert.ok(Array.isArray(r.data.activite));
  assert.ok(r.data.crm?.pipeline);
});
