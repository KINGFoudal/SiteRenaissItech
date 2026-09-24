# SiteRenaissItech

Site statique de Renaissance iTech (HTML/CSS/JS, sans dépendance), fidèle à la maquette validée.

| Page | Fichier |
|---|---|
| Accueil | `index.html` |
| Services | `services.html` |
| Rendez-vous | `rendez-vous.html` |
| Espace client (CRM) | `espace-client.html` |
| Boutique | `boutique.html` |
| Formations | `formations.html` |
| Tuteur IA | `tuteur-ia.html` |
| Blog | `blog.html` (généré) + `blog/<article>/` |
| Contact | `contact.html` |
| À propos | `a-propos.html` |

Styles : `assets/css/style.css` · Scripts : `assets/js/main.js` · Visuels : `assets/img/`

Aperçu local : `npm install && npm run build && npm run dev`

- **Publier un article** : voir [PUBLIER-UN-ARTICLE.md](PUBLIER-UN-ARTICLE.md) (articles dans `content/blog/`, générés par `scripts/build-blog.mjs`)
- **Newsletter** : voir [NEWSLETTER.md](NEWSLETTER.md) (Worker `worker/index.js` + Brevo)
- **Déploiement Cloudflare** : `wrangler.jsonc` (fichiers statiques + `/api/newsletter`)
