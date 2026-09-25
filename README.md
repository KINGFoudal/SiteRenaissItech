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
