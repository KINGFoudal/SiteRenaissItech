# Publier un article sur le blog

Chaque article est un simple fichier texte dans `content/blog/`.
Le site (liste du blog, page de l'article, sommaire, sources, flux RSS, plan du site, balises SEO) se met à jour tout seul.

## Méthode simple : depuis GitHub, sans rien installer

1. Ouvrez le dépôt sur GitHub, dossier **`content/blog`**.
2. Ouvrez **`_modele.md`**, copiez tout son contenu.
3. Cliquez sur **Add file → Create new file**.
4. Nommez le fichier avec l'adresse voulue, en minuscules et avec des tirets : `mon-nouvel-article.md`
   → il sera en ligne sur `renaissance-itech.com/blog/mon-nouvel-article/`
5. Collez le modèle, remplissez l'en-tête et écrivez l'article en dessous.
6. Mettez `brouillon: false` pour publier.
7. Cliquez sur **Commit changes**.

C'est tout : quelques minutes plus tard, l'article est en ligne.
Si une information manque ou est incorrecte, rien n'est publié et l'onglet **Actions** de GitHub explique précisément quoi corriger.

## Les métadonnées (l'en-tête entre les lignes `---`)

| Champ | Obligatoire | Rôle |
|---|---|---|
| `titre` | oui | Titre de l'article et de l'onglet (60 caractères idéalement, 90 max.) |
| `description` | oui | Résumé affiché sur Google et sur la carte (50 à 160 caractères) |
| `date` | oui | Date de publication, format `AAAA-MM-JJ` |
| `mise_a_jour` | non | Date de dernière mise à jour, affichée sur l'article |
| `auteur` | non | « Renaissance iTech » par défaut |
| `categorie` | oui | `IA`, `Développement Web`, `Entrepreneuriat`, `Cybersécurité` ou `Design` |
| `tags` | non | Mots-clés, ex. `["ia", "pme"]` |
| `image` | oui | Image de couverture (JPG/WebP 1200×630 conseillé, à déposer dans `assets/img/blog/`) |
| `image_alt` | oui | Description de l'image (accessibilité et SEO) |
| `a_la_une` | non | `true` pour mettre l'article en avant en haut du blog |
| `brouillon` | non | `true` = pas publié |
| `references` | non | Liste des sources (voir ci-dessous) |

## Les références

Déclarez les sources dans l'en-tête, dans l'ordre :

```yaml
references:
  - titre: "Guide d'hygiène informatique"
    source: "ANSSI"
    url: "https://cyber.gouv.fr/publications/guide-dhygiene-informatique"
    date: "2024"        # facultatif
```

Puis citez-les dans le texte avec leur numéro entre crochets : `… selon l'ANSSI [1].`

Sur le site, `[1]` devient un renvoi cliquable vers la section « Sources et références » en bas de l'article.
Une citation vers une source qui n'existe pas bloque la publication.

## Mise en forme du texte (Markdown)

| Vous écrivez | Résultat |
|---|---|
| `## Intertitre` | Intertitre (ajouté au sommaire) |
| `### Sous-intertitre` | Sous-intertitre (ajouté au sommaire) |
| `**gras**` | **gras** |
| `*italique*` | *italique* |
| `- élément` | liste à puces |
| `1. élément` | liste numérotée |
| `> phrase` | encadré mis en avant |
| `[texte](https://…)` | lien |
| `![description](/assets/img/blog/image.jpg)` | image dans l'article |

## Vérifier avant de publier (facultatif, sur ordinateur)

```bash
npm install
npm run check   # vérifie les articles
npm run build   # génère les pages
npm run dev     # aperçu sur http://localhost:3000
```
