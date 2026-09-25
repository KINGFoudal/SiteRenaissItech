# SiteRenaissItech

Site de Renaissance iTech (HTML/CSS/JS sans framework) servi par un Worker Cloudflare : pages statiques, API, base D1, emails Brevo et assistant IA (Workers AI).

| Page | Fichier |
|---|---|
| Accueil (démo animée IA privée) | `index.html` |
| Services (7 services) | `services.html` |
| Formations IA en entreprise | `formations.html` |
| Boutique (offres, sans prix) | `boutique.html` |
| Blog | `blog.html` (généré) + `blog/<article>/` |
| À propos | `a-propos.html` |
| Rendez-vous / confirmation | `rendez-vous.html`, `rendez-vous-confirme.html` |
| Contact / confirmation | `contact.html`, `merci-contact.html` |
| Espace client (lien magique par email) | `espace-client.html`, `connexion.html` |
| Administration (tableau de bord) | `admin.html` |
| Newsletter | `newsletter-confirmee.html`, `desinscription.html` |
| Légal | `mentions-legales.html`, `cookies.html`, `plan-du-site.html`, `404.html` |

Styles : `assets/css/style.css` · Scripts : `assets/js/main.js` · Visuels : `assets/img/`

Aperçu local : `npm install && npm run build && npm run dev` (pages seules) ou `npx wrangler dev` (pages + formulaires)

- **Checklist de validation** : [CHECKLIST-VALIDATION.md](CHECKLIST-VALIDATION.md)

- **Publier un article** : voir [PUBLIER-UN-ARTICLE.md](PUBLIER-UN-ARTICLE.md) (articles dans `content/blog/`, générés par `scripts/build-blog.mjs`)
- **Formulaires, emails et newsletter** : voir [NEWSLETTER.md](NEWSLETTER.md) (Worker `worker/index.js`, base D1 `migrations/`, Brevo)
- **Déploiement Cloudflare** : `wrangler.jsonc` (fichiers statiques + API : voir l’en-tête de `worker/index.js`)

## Sécurité

- Administration : mot de passe + double authentification (TOTP) obligatoire, codes de secours, session de 12 h, journal des actions (`/admin#journal`).
- Espace client : réservé aux clients premium (accès créé par l'admin), mot de passe provisoire valable 7 jours.
- Mots de passe : PBKDF2-SHA256 ; blocage après 8 échecs en 15 minutes.
- API : origine et format vérifiés sur chaque action (anti-CSRF), en-têtes de sécurité, limites d'envoi.
- Anti-robot Cloudflare Turnstile (facultatif) : variable `TURNSTILE_SITE_KEY` dans `wrangler.jsonc` et secret `TURNSTILE_SECRET` dans Cloudflare.
- RGPD : nettoyage automatique chaque nuit (tâche planifiée du Worker, `worker/securite.js`).
- Admin bloqué sans téléphone ni codes de secours : dans la console D1 de Cloudflare, exécuter
  `UPDATE administrateurs SET totp_actif = 0, totp_secret = NULL WHERE email = '…';` puis se reconnecter pour reconfigurer.
- Vérification : `node scripts/audit-site.cjs http://localhost:8787` (sur une copie locale uniquement).
