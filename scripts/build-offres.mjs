/*
 * Génère une page par offre (offre-*.html) à partir de content/offres.json.
 * L'en-tête et le pied de page sont repris de boutique.html pour rester identiques au reste du site.
 * Prix : "prix": null → « Sur devis » ; "prix": 890 → « À partir de 890 € HT ».
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://www.renaissance-itech.com';
const { offres } = JSON.parse(readFileSync(join(ROOT, 'content/offres.json'), 'utf8'));
const boutique = readFileSync(join(ROOT, 'boutique.html'), 'utf8');
const header = boutique.slice(boutique.indexOf('  <header class="site-header">'), boutique.indexOf('</header>') + 9);
const footer = boutique.slice(boutique.indexOf('  <footer class="site-footer">'), boutique.indexOf('</html>') + 7);

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const CHECK = svg('<path d="M20 6 9 17l-5-5"/>');
const prixTexte = (p) => (p == null ? 'Sur devis' : `À partir de ${Number(p).toLocaleString('fr-FR')} € HT`);

const POURQUOI = [
  ['<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>', 'Confidentialité', 'Vos contrats, vos données clients et vos procédures restent sur votre infrastructure ou dans un cloud européen. Rien ne part vers un service public d’IA.'],
  ['<path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7l8-4Z"/><path d="M9 12l2 2 4-4"/>', 'Conformité', 'Une architecture pensée pour le RGPD et l’AI Act : journalisation, contrôle des accès, hébergement maîtrisé et documentation pour votre DPO.'],
  ['<path d="M12 2v20M2 12h20"/><circle cx="12" cy="12" r="9"/>', 'Indépendance', 'Des modèles open source, sans abonnement par utilisateur ni dépendance à un fournisseur. Vous gardez la main sur les coûts et sur l’évolution de l’outil.'],
];
const METHODE = [
  ['Cadrage', 'Audit de vos données et de vos cas d’usage, choix de l’architecture. Une à deux semaines.'],
  ['PoC', 'Un prototype qui fonctionne sur vos vraies données, mesuré avec vos équipes. Trois à six semaines.'],
  ['Production', 'Sécurité, supervision, intégration à votre SI et à vos outils. Mise en service progressive.'],
  ['Adoption', 'Formation des utilisateurs et des équipes techniques pour qu’elles restent autonomes.'],
];

function page(o) {
  const url = `${SITE}/${o.slug}`;
  const devis = `/contact?produit=${encodeURIComponent(o.produit)}`;
  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Accueil', item: `${SITE}/` },
        { '@type': 'ListItem', position: 2, name: 'Offres', item: `${SITE}/boutique` },
        { '@type': 'ListItem', position: 3, name: o.produit, item: url },
      ] },
      { '@type': 'Service', name: o.produit, description: o.description, url, serviceType: o.categorie,
        provider: { '@id': `${SITE}/#organisation` }, areaServed: ['FR', 'GN'],
        ...(o.prix == null ? {} : { offers: { '@type': 'Offer', priceCurrency: 'EUR', priceSpecification: { '@type': 'PriceSpecification', minPrice: o.prix, priceCurrency: 'EUR', valueAddedTaxIncluded: false } } }) },
    ],
  };
  const title = esc(o.titre_seo);
  const desc = esc(o.description);
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <meta name="description" content="${desc}">
  <link rel="canonical" href="${url}">
  <meta property="og:site_name" content="Renaissance iTech">
  <meta property="og:locale" content="fr_FR">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${desc}">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${SITE}/assets/img/og-image.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="theme-color" content="#0A0A0A">
  <link rel="icon" href="/assets/img/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="/assets/img/favicon-32.png" type="image/png" sizes="32x32">
  <link rel="apple-touch-icon" href="/assets/img/apple-touch-icon.png">
  <link rel="manifest" href="/site.webmanifest">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="assets/css/style.css">
  <script data-seo-graph type="application/ld+json">${JSON.stringify(ld)}</script>
</head>
<body>
${header}
  <main class="page">
    <div class="container">
      <nav class="breadcrumb" aria-label="Fil d’Ariane"><a href="/">Accueil</a> <span aria-hidden="true">/</span> <a href="/boutique">Offres</a> <span aria-hidden="true">/</span> <span aria-current="page">${esc(o.produit)}</span></nav>
      <div class="offer-hero">
        <div>
          <span class="eyebrow">${esc(o.categorie)}</span>
          <h1 class="page-title">${esc(o.h1)}${o.h1_accent ? ` <span class="accent">${esc(o.h1_accent)}</span>` : ''}</h1>
          <p class="page-lead page-lead-wide">${esc(o.lead)}</p>
          <div class="offer-price">
            <span>Tarif</span>
            <strong data-prix="${o.prix ?? ''}">${prixTexte(o.prix)}</strong>
            <small>Chiffré après un premier échange · devis gratuit sous 48 h ouvrées</small>
          </div>
          <div class="hero-ctas">
            <a class="btn btn-primary" href="${devis}">Demander un devis</a>
            <a class="btn btn-outline" href="/rendez-vous">Prendre rendez-vous</a>
          </div>
        </div>
        <div class="offer-visual"><img src="assets/img/${o.image}" alt="" width="400" height="260"></div>
      </div>

      <section class="block">
        <h2 class="block-title">${esc(o.inclus_titre)}</h2>
        ${o.intro ? `<p class="block-lead">${esc(o.intro)}</p>` : ''}
        <ul class="svc-list offer-list">
          ${o.inclus.map((x) => `<li>${CHECK}${esc(x)}</li>`).join('\n          ')}
        </ul>
        ${o.lien_plus ? `<p class="offer-more"><a class="link-arrow" href="${o.lien_plus[0]}">${esc(o.lien_plus[1])}</a></p>` : ''}
      </section>
${o.pour_qui ? `
      <section class="block">
        <h2 class="block-title">Pour qui ?</h2>
        <div class="dark-grid">
          ${o.pour_qui.map(([t, p]) => `<article class="dark-card"><h3>${esc(t)}</h3><p>${esc(p)}</p></article>`).join('\n          ')}
        </div>
      </section>
` : ''}${o.methode ? `
      <section class="block">
        <h2 class="block-title">Du PoC à la production, en quatre étapes</h2>
        <ol class="steps-line">
          ${METHODE.map(([t, p], i) => `<li><span class="step-n">0${i + 1}</span><h3>${t}</h3><p>${p}</p></li>`).join('\n          ')}
        </ol>
      </section>
` : ''}${o.pourquoi_ia ? `
      <section class="block">
        <h2 class="block-title">L’efficacité de l’IA générative, sans la fuite de données</h2>
        <div class="dark-grid">
          ${POURQUOI.map(([d, t, p]) => `<article class="dark-card">${svg(d).replace('<svg ', '<svg class="dc-icon" ')}<h3>${t}</h3><p>${p}</p></article>`).join('\n          ')}
        </div>
      </section>
` : ''}
      <div class="trust">
        <div>${svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M9 13h6M9 17h6"/>')}Devis gratuit sous 48 h ouvrées</div>
        <div>${svg('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>')}Rendez-vous en visioconférence</div>
        <div>${svg('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>')}Accompagnement sur mesure</div>
        <div>${svg('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>')}Vos données restent chez vous</div>
      </div>

      <section class="block">
        <div class="band">
          <div>
            <h2>Un cas d’usage en tête ?</h2>
            <p>Parlons-en 30 minutes. Nous vous disons franchement si l’IA privée est la bonne réponse, et par où commencer.</p>
          </div>
          <div class="hero-ctas">
            <a class="btn btn-primary" href="/rendez-vous">Prendre rendez-vous</a>
            <a class="btn btn-ghost-dark" href="${devis}">Demander un devis</a>
          </div>
        </div>
      </section>
    </div>
  </main>
${footer}
`;
}

for (const o of offres) writeFileSync(join(ROOT, `${o.slug}.html`), page(o));
console.log(`✓ Offres générées : ${offres.length} page(s).`);
