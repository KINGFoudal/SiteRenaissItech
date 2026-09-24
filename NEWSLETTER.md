# Activer la newsletter

Le formulaire d'inscription (page Blog et bas de chaque article) envoie les emails
au Worker Cloudflare (`worker/index.js`), qui les ajoute à une liste **Brevo**.
Brevo gère ensuite l'envoi des newsletters, la désinscription et la conformité RGPD
(offre gratuite : 300 emails par jour).

Tant que les réglages ci-dessous ne sont pas faits, le formulaire affiche
« La newsletter ouvre très bientôt ».

## 1. Brevo (10 minutes)

1. Créez un compte sur brevo.com.
2. **Contacts → Listes → Créer une liste** « Newsletter ». Notez son **ID**.
3. (Recommandé) **Modèles → Nouveau modèle** de confirmation d'inscription
   (double opt-in, avec le lien `{{ doubleoptin }}`). Notez son **ID**.
4. **Paramètres → SMTP & API → Clés API → Générer une clé**.
5. Authentifiez votre domaine d'envoi (**Expéditeurs & domaines**) pour éviter les spams.

## 2. Cloudflare

Dans le tableau de bord : **Workers & Pages → renaissance-itech → Paramètres → Variables et secrets** :

| Nom | Type | Valeur |
|---|---|---|
| `BREVO_API_KEY` | Secret | la clé API Brevo |
| `BREVO_LIST_ID` | Texte | l'ID de la liste |
| `BREVO_DOI_TEMPLATE_ID` | Texte | l'ID du modèle de confirmation (recommandé) |

Avec le double opt-in, l'abonné reçoit un email de confirmation, puis revient sur
`/blog.html?newsletter=confirmee` où un message lui souhaite la bienvenue.

## 3. Envoyer une newsletter

Dans Brevo : **Campagnes → Créer une campagne email**, liste « Newsletter ».
Idée simple : chaque mois, reprenez les derniers articles du blog (titre, résumé, lien).
