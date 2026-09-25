# Checklist de validation : site Renaissance iTech

✅ = vérifié par Claude · ⬜ = à faire / valider par vous

---

## Étape 1 : Design et pages (maquette)

- ✅ Pages : Accueil (démo animée IA privée), Services (7), Formations B2B, Boutique, Blog, À propos, Contact, Rendez-vous, Espace client, Administration
- ✅ Pages annexes : confirmation contact, confirmation RDV (ajout agenda), newsletter confirmée, désinscription, cookies, plan du site
- ✅ Pages ajoutées : À propos, Mentions légales & RGPD, page 404
- ✅ Pied de page sur toutes les pages publiques (services, ressources, contact, liens légaux)
- ✅ Affichage vérifié sur ordinateur (1440 px) et mobile (390 px) : aucun débordement, aucune erreur JavaScript
- ✅ 692 liens et images vérifiés : aucun lien cassé
- ⬜ **Vous** : relire chaque page et valider le design

## Étape 2 : Coordonnées et contenu

- ✅ Partout : **contact@renaissance-itech.com** et **+33 7 75 70 08 67** (site, pied de page, mentions légales, emails, WhatsApp)
- ✅ Abidjan / Côte d’Ivoire, +225 et FCFA retirés
- ✅ Aucun prix affiché : boutique en « Demander un devis » / « Prendre rendez-vous »
- ⬜ **Vous** : envoyer vos liens réseaux sociaux (Facebook, LinkedIn, YouTube, Instagram, X). Icônes retirées de la page Contact tant qu’elles ne mènent nulle part
- ⬜ **Vous** : vos vraies photos (hero, produits, formations) si vous souhaitez remplacer les illustrations
- ✅ Chiffres : 25 projets, 2 ans d’expérience
- ⬜ **Vous** : SIRET à ajouter dans les mentions légales dès réception

## Étape 3 : Formulaires (site dynamique)

- ✅ **Contact** : enregistré dans la base Cloudflare D1 (table `contacts`) + email à vous + accusé de réception au client
- ✅ **Rendez-vous** : enregistré (table `rendez_vous`), créneau réservé grisé pour les visiteurs suivants, pas de double réservation, week-ends et heures passées refusés, heure de Paris
- ✅ **Emails de rendez-vous** : notification pour vous + confirmation au client avec invitation agenda (.ics)
- ✅ **Devis depuis la boutique** : formulaire pré-rempli avec le produit
- ✅ **Anti-spam** : champ piège, contrôle de l’origine, 5 envois maximum par heure et par visiteur
- ✅ Tables créées dans votre base Cloudflare `renaissance-itech-db`
- ✅ Testé de bout en bout dans un vrai navigateur avec le serveur Cloudflare local
- ✅ Compte Brevo créé, domaine renaissance-itech.com authentifié (DKIM, DMARC), clé API ajoutée dans Cloudflare
- ✅ Réception des emails sur contact@renaissance-itech.com (routage Cloudflare vers Gmail)
- ⬜ **Vous** : pour chaque rendez-vous, créer la réunion Google Meet et envoyer le lien au client (l’email de notification le rappelle)

## Étape 4 : Blog et newsletter

- ✅ Blog : article à la une, recherche, filtres, temps de lecture, sommaire, sources numérotées, partage, articles liés, flux RSS
- ✅ Publication par fichier Markdown avec métadonnées vérifiées (`PUBLIER-UN-ARTICLE.md`)
- ✅ Formulaire newsletter + consentement RGPD + double opt-in possible
- ✅ Liste Brevo n°2 reliée au site
- ⬜ (Facultatif) modèle de confirmation double opt-in dans Brevo
- ⬜ **Vous** : remplacer les 3 articles d’exemple par vos propres articles (ou me les demander)

## Étape 5 : Référencement, sécurité, conformité

- ✅ Titre et description propres à chaque page, adresse de référence (canonical), aperçu réseaux sociaux (image 1200×630)
- ✅ Fiche entreprise pour Google (données structurées) sur l’accueil, articles balisés (BlogPosting)
- ✅ `sitemap.xml`, `robots.txt`, flux RSS ; pages privées (espace client, admin, connexion) non indexées
- ✅ Anciennes adresses redirigées (`/creation-site-web`, `/automatisation-ia` → `/services`)
- ✅ En-têtes de sécurité (CSP, HSTS, anti-iframe…), fichiers internes non publiés
- ✅ Icônes (favicon, iPhone, Android) et manifeste
- ✅ Mentions légales & politique de confidentialité à jour (formulaires, rendez-vous, newsletter, Brevo)
- ✅ Aucun cookie de suivi → pas de bannière cookies nécessaire
- ⬜ **Vous** (conseillé) : activer **Cloudflare Web Analytics** (statistiques de visite sans cookie) dans le tableau de bord
- ⬜ **Vous** (après mise en ligne) : déclarer le site dans **Google Search Console** et y soumettre `sitemap.xml`

## Étape 6 : Mise en ligne

- ✅ Configuration Cloudflare vérifiée (`wrangler deploy --dry-run`) : site + API + base de données
- ✅ Pull request fusionnée sur `main`
- ✅ Worker `renaissance-itech` relié à `KINGFoudal/SiteRenaissItech` (branche `main`), mise en ligne automatique
  - Commande de build : `npm ci && npm run build`
  - Commande de déploiement : `npx wrangler d1 migrations apply renaissance-itech-db --remote && npx wrangler deploy`
- ✅ Variables Brevo en place
- ⬜ **Vous** : déplacer le domaine renaissance-itech.com de l’ancien projet Pages `renaissance-itech-depll` vers le Worker `renaissance-itech`
- ⬜ **Claude** : vérifier le site en ligne page par page, puis envoyer un vrai message et un vrai rendez-vous de test

## Étape 7 : Évolutions (après le lancement)

- ⬜ Espace client réel (connexion, suivi des projets, factures). Aujourd’hui : écran de connexion + démonstration
- ✅ Assistant IA du site (Workers AI) sur toutes les pages publiques
- ✅ Espace client réservé aux clients premium : email + mot de passe, accès créé par l’admin (mot de passe provisoire), mot de passe oublié
- ⬜ **Vous** : première connexion admin via « Mot de passe oublié » sur /admin avec contact@renaissance-itech.com
- ⬜ **Vous** : remplacer les illustrations du blog par de vraies photos si souhaité (dossier `assets/img/blog/`)
- ⬜ Formations : la page affiche une progression d’exemple (65 %) ; à relier aux comptes clients
- ⬜ Création automatique des réunions Google Meet
- ⬜ Guide PDF offert contre l’email, simulateur de devis, études de cas clients
