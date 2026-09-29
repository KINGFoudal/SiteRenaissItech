# Paiements en ligne (Stripe) : mise en place

Le site encaisse les factures et les achats de la boutique avec **Stripe Checkout** (page de paiement hébergée par
Stripe). Aucune donnée de carte ne passe par le site. Sans clés Stripe, les boutons de paiement restent cachés et la
boutique fonctionne « sur devis ».

## Secrets Cloudflare (Worker `renaissance-itech` › Settings › Variables and Secrets)

| Nom | Où le trouver | Remarque |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | Stripe › Développeurs › Clés API › clé restreinte | `rk_test_…` en test, `rk_live_…` en production. Permission unique : **Checkout Sessions → Écriture** |
| `STRIPE_WEBHOOK_SECRET` | Stripe › Développeurs › Webhooks › destination › Clé secrète de signature | `whsec_…`, propre à chaque destination |

- Onglet **Previews** : clés de **test** uniquement (site de prévisualisation des PR).
- Onglet **Production** : clés **réelles**, seulement quand l'entreprise est immatriculée (SIRET) et le compte Stripe activé.
- Ne jamais écrire une clé dans le code ni la partager par message.

## Destination webhook Stripe

- URL : `https://<adresse du site>/api/stripe/webhook`
- Événements :
  - `checkout.session.completed`
  - `checkout.session.async_payment_succeeded`
  - `checkout.session.async_payment_failed`
  - `checkout.session.expired`
- Une destination en mode test (adresse du site de prévisualisation) et une autre en mode réel (`https://www.renaissance-itech.com`).

## Cartes de test

| Carte | Résultat |
| --- | --- |
| `4242 4242 4242 4242` | Paiement accepté |
| `4000 0025 0000 3155` | Demande une validation 3D Secure |
| `4000 0000 0000 0002` | Paiement refusé |

Date d'expiration : n'importe quelle date future. Code : n'importe quels 3 chiffres.

## Avant d'accepter de vrais paiements

1. SIRET obtenu, mentions légales et CGV à jour sur le site.
2. Compte Stripe activé (identité, IBAN) et double authentification par application.
3. Clé restreinte `rk_live_…` et destination webhook réelle créées, secrets ajoutés dans l'onglet **Production**.
4. Migration `0005_factures_paiements.sql` appliquée à la base de production (faite automatiquement au déploiement).
5. Admin › Factures : raison sociale, adresse, SIRET, TVA (ou mention « TVA non applicable, art. 293 B du CGI »).
6. Admin › Boutique : prix HT et case « En vente » pour chaque offre vendue en ligne.
7. Un premier paiement réel de faible montant, puis un remboursement depuis Stripe, pour tout vérifier.
