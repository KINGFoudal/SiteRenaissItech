---
titre: "Shadow AI : sécuriser l'IA générative en entreprise"
description: "Outils d'IA utilisés sans validation, injection de consignes, droits d'accès : les recommandations de l'ANSSI pour sécuriser l'IA générative en PME."
date: 2026-11-03
auteur: "Renaissance iTech"
categorie: "Cybersécurité"
tags: ["shadow AI", "ANSSI", "sécurité", "IA générative"]
image: "/assets/img/blog/shadow-ai-couverture.svg"
image_alt: "Fenêtres d'outils d'IA non validés en périphérie d'un réseau d'entreprise protégé"
a_la_une: false
brouillon: false
references:
  - titre: "Recommandations de sécurité pour un système d'IA générative (ANSSI-PA-102, version 1.0)"
    source: "ANSSI"
    url: "https://cyber.gouv.fr/sites/default/files/document/Recommandations_de_s%C3%A9curit%C3%A9_pour_un_syst%C3%A8me_d_IA_g%C3%A9n%C3%A9rative.pdf"
    date: "2024"
  - titre: "Les questions-réponses de la CNIL sur l'utilisation d'un système d'IA générative"
    source: "CNIL"
    url: "https://cnil.fr/fr/les-questions-reponses-de-la-cnil-sur-lutilisation-dun-systeme-dia-generative"
    date: "2024"
---

On appelle « shadow AI » l'usage d'outils d'IA par les salariés sans que l'entreprise l'ait validé : un compte gratuit pour traduire un devis, une extension de navigateur qui résume les emails, un assistant de code branché sur le dépôt. Ces usages partent d'une bonne intention, gagner du temps, mais ils font sortir des données sans contrôle. L'ANSSI a publié un guide de 35 recommandations pour sécuriser les systèmes d'IA générative [1]. Voici celles qui comptent le plus pour une PME.

## Le risque n°1 : les données qui sortent

La recommandation est claire : proscrire l'utilisation d'outils d'IA générative sur Internet pour un usage professionnel impliquant des données sensibles [1]. La CNIL ajoute qu'en cas d'usage d'un service grand public, il faut éviter les comptes personnels et désactiver la réutilisation des données par le fournisseur [2].

Interdire ne suffit pas : si l'entreprise ne propose aucune alternative, les usages continuent en dehors de tout contrôle. La réponse durable est de fournir un outil validé, idéalement une IA privée hébergée dans un environnement de confiance [1].

## Le risque n°2 : l'injection de consignes

Un assistant IA lit des contenus qu'il ne maîtrise pas : un email, une page web, un document reçu. Un attaquant peut y glisser des instructions cachées pour détourner l'assistant. L'ANSSI recommande de :

- filtrer les entrées et les sorties des utilisateurs [1] ;
- maîtriser et sécuriser les interactions de l'IA avec les autres applications métier [1] ;
- limiter les actions automatiques déclenchées par une IA qui traite des entrées non maîtrisées [1].

> Une IA qui peut envoyer un email ou modifier un fichier doit avoir un humain dans la boucle.

Pour les actions critiques sur le système d'information, l'ANSSI va plus loin et en proscrit l'usage automatisé [1].

## Le risque n°3 : un assistant qui en sait trop

Un assistant connecté à tous les documents de l'entreprise peut révéler à un stagiaire la grille des salaires. L'ANSSI demande de prendre en compte le besoin d'en connaître dès la conception [1] : chaque utilisateur ne doit obtenir que des réponses issues des documents qu'il a le droit de consulter. Les droits des outils d'IA sur les applications métier doivent aussi être revus régulièrement [1].

## Les bases techniques à ne pas oublier

- **Héberger dans un environnement de confiance**, adapté au niveau de sensibilité, et privilégier un hébergement qualifié SecNumCloud en cloud public [1].
- **Cloisonner** le système d'IA dans des environnements techniques dédiés [1].
- **Journaliser** l'ensemble des traitements réalisés par le système [1] : en cas d'incident, c'est la seule façon de savoir ce qui s'est passé.

## Un plan d'action en quatre étapes

1. **Recenser** les outils d'IA réellement utilisés, en interrogeant les équipes sans chercher de coupable.
2. **Proposer une alternative validée** pour les usages légitimes.
3. **Écrire une charte** qui dit ce qu'on peut confier à l'IA, et ce qu'on garde [2].
4. **Sensibiliser** les équipes aux fuites de données et à l'injection de consignes.

La sécurité de l'IA n'est pas un projet à part : elle s'intègre à votre politique de sécurité existante. C'est ce que nous faisons lors d'un audit sécurité et IA, avec un plan de remédiation priorisé.
