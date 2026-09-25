#!/usr/bin/env node
/*
 * Générateur du blog Renaissance iTech.
 *
 * Lit les articles Markdown de content/blog/*.md, vérifie leurs métadonnées,
 * puis génère :
 *   - blog.html                (liste des articles)
 *   - blog/<slug>/index.html   (une page par article)
 *   - rss.xml, sitemap.xml
 *
 * Usage : npm run build     (génère)
 *         npm run check     (vérifie seulement, sans rien écrire)
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { Marked } from 'marked';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = join(ROOT, 'content', 'blog');
const SITE = 'https://www.renaissance-itech.com';
const CHECK_ONLY = process.argv.includes('--check');

const CATEGORIES = {
  'IA': 'ia',
  'Développement Web': 'web',
  'Entrepreneuriat': 'entrepreneuriat',
  'Cybersécurité': 'cyber',
  'Design': 'design',
};

// Appel à l'action adapté à la catégorie de l'article
const CTA = {
  ia: ['Une IA privée sur vos données ?', 'Nous déployons des assistants IA hébergés chez vous et formons vos équipes, du PoC à la production.'],
  web: ['Un projet de site web ?', 'Site vitrine, e-commerce ou application : parlons de votre projet.'],
  entrepreneuriat: ['Prêt à passer à la vitesse supérieure ?', 'Audit digital et stratégie sur-mesure pour accélérer votre croissance.'],
  cyber: ['Votre site est-il bien protégé ?', 'Audit de sécurité, durcissement et sécurisation de vos usages de l’IA.'],
  design: ['Besoin d’une identité qui marque ?', 'Maquettes, interfaces et identité visuelle pour votre marque.'],
};

const PAGES = ['index.html', 'services.html', 'formations.html', 'rendez-vous.html', 'boutique.html', 'blog.html', 'contact.html', 'a-propos.html', 'mentions-legales.html', 'cookies.html', 'plan-du-site.html'];

/* ---------------------------------------------------------------- utilitaires */

const esc = (s = '') => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const frDate = (d) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
const isoDate = (d) => d.toISOString().slice(0, 10);
const slugify = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const errors = [];
const fail = (file, msg) => errors.push(`  ✗ ${file} : ${msg}`);

/* ---------------------------------------------------------------- lecture et validation */

function toDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && isoDate(d) === value ? d : null;
}

function parseArticle(file) {
  const raw = readFileSync(join(CONTENT, file), 'utf8');
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) { fail(file, 'l’en-tête (entre les lignes ---) est manquant.'); return null; }

  let meta;
  try { meta = yaml.load(m[1], { schema: yaml.CORE_SCHEMA }) || {}; } catch (e) { fail(file, `en-tête illisible (${e.reason || e.message}). Vérifiez les guillemets et l’indentation.`); return null; }

  const slug = basename(file, '.md');
  if (slug !== slugify(slug)) fail(file, `le nom du fichier doit être en minuscules, sans accents ni espaces (ex. : ${slugify(slug)}.md).`);

  const a = {
    file, slug,
    title: meta.titre,
    description: meta.description,
    date: toDate(meta.date),
    updated: meta.mise_a_jour ? toDate(meta.mise_a_jour) : null,
    author: meta.auteur || 'Renaissance iTech',
    category: meta.categorie,
    catKey: CATEGORIES[meta.categorie],
    tags: meta.tags || [],
    image: meta.image,
    imageAlt: meta.image_alt || '',
    featured: meta.a_la_une === true,
    draft: meta.brouillon === true,
    references: meta.references || [],
    body: m[2],
  };

  if (!a.title || typeof a.title !== 'string') fail(file, '« titre » est obligatoire.');
  else if (a.title.length > 90) fail(file, `« titre » trop long (${a.title.length} caractères, 90 max.).`);
  if (!a.description || typeof a.description !== 'string') fail(file, '« description » est obligatoire.');
  else if (a.description.length < 50 || a.description.length > 160) fail(file, `« description » doit faire entre 50 et 160 caractères (actuellement ${a.description.length}).`);
  if (!a.date) fail(file, '« date » est obligatoire, au format AAAA-MM-JJ.');
  if (meta.mise_a_jour && !a.updated) fail(file, '« mise_a_jour » doit être au format AAAA-MM-JJ.');
  if (a.updated && a.date && a.updated < a.date) fail(file, '« mise_a_jour » ne peut pas être antérieure à « date ».');
  if (!a.catKey) fail(file, `« categorie » doit être l’une de : ${Object.keys(CATEGORIES).join(', ')}.`);
  if (!Array.isArray(a.tags)) fail(file, '« tags » doit être une liste, ex. : ["ia", "pme"].');
  if (!a.image) fail(file, '« image » (couverture) est obligatoire.');
  else if (a.image.startsWith('/') && !existsSync(join(ROOT, a.image))) fail(file, `image introuvable : ${a.image}`);
  if (a.image && !a.imageAlt) fail(file, '« image_alt » est obligatoire (description de l’image pour l’accessibilité).');
  if (!a.body.trim()) fail(file, 'l’article est vide.');
  // Images et schémas du texte : description (alt) obligatoire pour l'accessibilité et le référencement
  for (const [, alt, src] of a.body.matchAll(/!\[([^\]]*)\]\(\s*<?([^)\s>]+)/g)) {
    if (alt.trim().length < 10) fail(file, `l’image ${src} doit avoir une description d’au moins 10 caractères : ![description](${src})`);
    if (src.startsWith('/') && !existsSync(join(ROOT, src))) fail(file, `image introuvable : ${src}`);
  }

  if (!Array.isArray(a.references)) fail(file, '« references » doit être une liste.');
  else a.references.forEach((r, n) => {
    const k = `référence [${n + 1}]`;
    if (!r || typeof r !== 'object') return fail(file, `${k} mal formée.`);
    if (!r.titre) fail(file, `${k} : « titre » manquant.`);
    if (!r.source) fail(file, `${k} : « source » manquante.`);
    if (!r.url || !/^https?:\/\/\S+$/.test(r.url)) fail(file, `${k} : « url » manquante ou invalide.`);
  });

  // Chaque renvoi [n] du texte doit correspondre à une référence
  const cited = new Set([...a.body.matchAll(/\[(\d{1,2})\](?![(:\]])/g)].map((x) => +x[1]));
  for (const n of cited) if (n < 1 || n > a.references.length) fail(file, `le texte cite [${n}] mais il n’y a que ${a.references.length} référence(s).`);
  const unused = a.references.map((_, n) => n + 1).filter((n) => !cited.has(n));
  if (unused.length) console.warn(`  ! ${file} : référence(s) jamais citée(s) dans le texte : ${unused.map((n) => `[${n}]`).join(', ')}`);

  return a;
}

/* ---------------------------------------------------------------- rendu Markdown */

function renderBody(a) {
  const toc = [];
  const used = new Set();
  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens);
        if (depth === 1) depth = 2; // un seul h1 par page : le titre
        let id = slugify(text.replace(/<[^>]+>/g, '')) || 'section';
        while (used.has(id)) id += '-2';
        used.add(id);
        if (depth <= 3) toc.push({ depth, id, text: text.replace(/<[^>]+>/g, '') });
        return `<h${depth} id="${id}">${text}</h${depth}>\n`;
      },
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens);
        const ext = /^https?:\/\//.test(href) && !href.startsWith(SITE);
        return `<a href="${esc(href)}"${title ? ` title="${esc(title)}"` : ''}${ext ? ' target="_blank" rel="noopener"' : ''}>${text}</a>`;
      },
      image({ href, title, text }) {
        return `<figure><img src="${esc(href)}" alt="${esc(text)}" loading="lazy" decoding="async">${title ? `<figcaption>${esc(title)}</figcaption>` : ''}</figure>`;
      },
    },
  });
  // Renvois vers les références : [1] → exposant cliquable
  const src = a.body.replace(/\[(\d{1,2})\](?![(:\]])/g, (_, n) => `<sup class="cite"><a href="#ref-${n}" id="cite-${n}" aria-label="Référence ${n}">[${n}]</a></sup>`);
  const html = marked.parse(src);
  const words = a.body.replace(/[#>*_`\-[\]()]/g, ' ').split(/\s+/).filter(Boolean).length;
  return { html, toc, minutes: Math.max(1, Math.ceil(words / 200)) };
}

/* ---------------------------------------------------------------- gabarits */

const icon = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const I = {
  menu: icon('<path d="M4 6h16M4 12h16M4 18h16"/>'),
  search: icon('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>'),
  clock: icon('<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>'),
  rss: icon('<path d="M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/>'),
  link: icon('<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>'),
  mail: icon('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/>'),
  ext: icon('<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'),
};
const SOCIAL = {
  linkedin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 9h4v12H4zM6 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm4 6h3.8v1.7c.6-1 1.9-2 3.9-2 4 0 4.3 2.6 4.3 6V21h-4v-5.6c0-1.4 0-3.1-1.9-3.1s-2.1 1.5-2.1 3V21h-4Z"/></svg>',
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17.8 3h3.3l-7.2 8.2L22.3 21h-6.6l-5.2-6.8L4.6 21H1.3l7.7-8.8L1 3h6.8l4.7 6.2Zm-1.2 16h1.8L7.5 4.9H5.5Z"/></svg>',
  facebook: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M14 8h3V4h-3c-2.8 0-4 1.8-4 4.5V11H7v4h3v9h4v-9h3l1-4h-4V8.8c0-.6.3-.8 1-.8Z"/></svg>',
  whatsapp: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.3-.5 0-1 .3-3.3-.7-2.8-1.1-4.5-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.9s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.3 0 .5l-.4.6-.4.4c-.1.2-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.3 2.4 1.5.3.1.5.1.6-.1l.9-1.1c.2-.3.4-.2.7-.1l1.9.9c.3.1.5.2.6.3 0 .2 0 .8-.2 1.3Z"/></svg>',
};

const NAV = [['/', 'Accueil'], ['/services', 'Services'], ['/formations', 'Formations'], ['/boutique', 'Boutique'], ['/blog', 'Blog'], ['/a-propos', 'À propos']];

const header = () => `<header class="site-header">
    <div class="container">
      <a class="logo" href="/" aria-label="Renaissance iTech, retour à l’accueil">
        <img class="logo-mark" src="/assets/img/logo-mark.svg" alt="" width="34" height="34">
        <span class="logo-text">Renaissance<span>iTech</span></span>
      </a>
      <nav class="nav" id="nav" aria-label="Navigation principale">
        ${NAV.map(([h, l]) => `<a href="${h}"${l === 'Blog' ? ' aria-current="page"' : ''}>${l}</a>`).join('\n        ')}
      </nav>
      <div class="header-actions">
        <a class="btn btn-outline btn-sm" href="/espace-client">Se connecter</a>
        <a class="btn btn-primary btn-sm" href="/rendez-vous">Prendre rendez-vous</a>
        <button class="burger" type="button" aria-label="Ouvrir le menu" aria-controls="nav" aria-expanded="false" data-burger>${I.menu}</button>
      </div>
    </div>
  </header>`;

const newsletter = (source) => `<section class="newsletter" aria-labelledby="nl-title-${source}">
    <div class="newsletter-text">
      <span class="eyebrow">Newsletter</span>
      <h2 id="nl-title-${source}">Recevez nos meilleurs conseils, <span class="accent">une fois par mois</span></h2>
      <p>IA, web, cybersécurité : des conseils concrets pour faire grandir votre entreprise. Pas de spam, désinscription en un clic.</p>
    </div>
    <form class="newsletter-form" data-newsletter data-source="${source}" novalidate>
      <div class="newsletter-row">
        <label class="sr-only" for="nl-email-${source}">Votre email</label>
        <input class="input" id="nl-email-${source}" name="email" type="email" placeholder="Votre email professionnel" autocomplete="email" required>
        <button class="btn btn-primary" type="submit">S’abonner</button>
      </div>
      <input class="hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
      <label class="consent"><input type="checkbox" name="consent" required><span>J’accepte de recevoir la newsletter de Renaissance iTech. Mes données ne sont jamais revendues et je peux me désinscrire à tout moment (<a href="/mentions-legales#confidentialite">confidentialité</a>).</span></label>
      <p class="form-msg" data-nl-msg role="status" hidden></p>
    </form>
  </section>`;

// Les réseaux sociaux n'affichent pas les images SVG : on utilise alors l'image de partage du site
const socialImage = (image) => (!image || image.endsWith('.svg') ? '/assets/img/og-image.png' : image);

const page = ({ title, desc, canonical, head = '', body, type = 'website', image }) => `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}">
  <link rel="canonical" href="${canonical}">
  <meta name="theme-color" content="#0A0A0A">
  <meta property="og:site_name" content="Renaissance iTech">
  <meta property="og:locale" content="fr_FR">
  <meta property="og:type" content="${type}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${SITE}${esc(socialImage(image))}">
  <meta name="twitter:card" content="summary_large_image">
  ${head}
  <link rel="alternate" type="application/rss+xml" title="Blog Renaissance iTech" href="/rss.xml">
  <link rel="icon" href="/assets/img/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="/assets/img/favicon-32.png" type="image/png" sizes="32x32">
  <link rel="apple-touch-icon" href="/assets/img/apple-touch-icon.png">
  <link rel="manifest" href="/site.webmanifest">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/assets/css/style.css">
</head>
<body>
  ${body.trim()}
  <footer class="site-footer">
    <div class="container">
      <div class="footer-grid">
        <div class="footer-brand">
          <a class="logo" href="/" aria-label="Renaissance iTech, retour à l’accueil"><img class="logo-mark" src="/assets/img/logo-mark.svg" alt="" width="34" height="34"><span class="logo-text">Renaissance<span>iTech</span></span></a>
          <p>IA privée &amp; souveraine pour les PME et TPE : assistants IA sur vos données, automatisation, formation et cybersécurité. En France et en Guinée.</p>
          <a class="btn btn-primary btn-sm" href="/rendez-vous">Prendre rendez-vous</a>
        </div>
        <nav aria-label="Services">
          <h2>Services</h2>
          <a href="/services#ia-privee">IA privée &amp; souveraine</a>
          <a href="/services#automatisation">Automatisation IA</a>
          <a href="/formations">Formation IA des équipes</a>
          <a href="/services#cybersecurite">Cybersécurité</a>
          <a href="/services">Tous nos services</a>
        </nav>
        <nav aria-label="Ressources">
          <h2>Ressources</h2>
          <a href="/blog">Blog</a>
          <a href="/boutique">Boutique</a>
          <a href="/a-propos">À propos</a>
          <a href="/espace-client">Espace client</a>
          <a href="/plan-du-site">Plan du site</a>
        </nav>
        <div>
          <h2>Contact</h2>
          <a href="mailto:contact@renaissance-itech.com">contact@renaissance-itech.com</a>
          <a href="tel:+33775700867">+33 7 75 70 08 67</a>
          <span>Du lundi au vendredi, 9h à 18h</span>
          <span>Évry-Courcouronnes · Conakry</span>
          <a href="/contact">Formulaire de contact →</a>
        </div>
      </div>
      <div class="footer-bottom">
        <span>© <span data-year>2026</span> Renaissance iTech. Tous droits réservés.</span>
        <span><a href="/mentions-legales">Mentions légales</a> · <a href="/mentions-legales#confidentialite">Confidentialité</a> · <a href="/cookies">Cookies</a> · <a href="/rss.xml">RSS</a></span>
      </div>
    </div>
  </footer>
  <div class="toast" role="status" aria-live="polite" data-toast></div>
  <script src="/assets/js/main.js" defer></script>
</body>
</html>
`;

const meta = (a) => `<span>${esc(a.author)}</span><span aria-hidden="true">·</span><time datetime="${isoDate(a.date)}">${frDate(a.date)}</time><span aria-hidden="true">·</span><span>${a.minutes} min de lecture</span>`;

const card = (a) => `<article class="card post" data-cat="${a.catKey}" data-search="${esc(`${a.title} ${a.description} ${a.category} ${a.tags.join(' ')}`.toLowerCase())}">
          <a class="thumb" href="/blog/${a.slug}/" tabindex="-1" aria-hidden="true"><img src="${esc(a.image)}" alt="" width="400" height="260" loading="lazy"><span class="badge">${esc(a.category)}</span></a>
          <div class="post-body">
            <p class="post-date"><time datetime="${isoDate(a.date)}">${frDate(a.date)}</time> · ${a.minutes} min de lecture</p>
            <h3><a href="/blog/${a.slug}/">${esc(a.title)}</a></h3>
            <p class="post-excerpt">${esc(a.description)}</p>
            <div class="post-meta"><span class="post-author"><span class="author-dot" aria-hidden="true">R</span>Écrit par ${esc(a.author)}</span><a class="link-arrow" href="/blog/${a.slug}/">Lire l’article</a></div>
          </div>
        </article>`;

/* ---------------------------------------------------------------- pages */

function listingPage(articles) {
  const featured = articles.find((a) => a.featured) || articles[0];
  const rest = articles.filter((a) => a !== featured);
  const cats = Object.entries(CATEGORIES);
  const body = `${header()}
  <main class="page">
    <div class="container">
      <div class="blog-hero">
        <div>
          <span class="eyebrow">Blog</span>
          <h1 class="page-title">Conseils, actualités et tendances</h1>
          <p class="page-lead">IA privée, automatisation, cybersécurité : des conseils concrets pour les PME et TPE, par l’équipe Renaissance iTech.</p>
        </div>
        <div class="blog-search">
          <label class="sr-only" for="blog-q">Rechercher un article</label>
          ${I.search}
          <input class="input" id="blog-q" type="search" placeholder="Rechercher un article..." data-blog-search>
        </div>
      </div>

      ${featured ? `<article class="card featured" data-cat="${featured.catKey}" data-search="${esc(`${featured.title} ${featured.description} ${featured.category} ${featured.tags.join(' ')}`.toLowerCase())}">
        <a class="thumb" href="/blog/${featured.slug}/" tabindex="-1" aria-hidden="true"><img src="${esc(featured.image)}" alt="" width="400" height="260"></a>
        <div class="featured-body">
          <div class="featured-top"><span class="badge">À la une</span><span class="featured-cat">${esc(featured.category)}</span></div>
          <h2><a href="/blog/${featured.slug}/">${esc(featured.title)}</a></h2>
          <p>${esc(featured.description)}</p>
          <p class="article-meta">${meta(featured)}</p>
          <a class="btn btn-primary" href="/blog/${featured.slug}/">Lire l’article</a>
        </div>
      </article>` : ''}

      <div class="pills" role="tablist" data-filter=".posts .post, .featured">
        <button class="pill is-active" type="button" data-cat="all">Tous</button>
        ${cats.map(([l, k]) => `<button class="pill" type="button" data-cat="${k}">${esc(l)}</button>`).join('\n        ')}
      </div>
      <div class="posts">
        ${rest.map(card).join('\n        ')}
      </div>
      <p class="page-lead" data-empty${rest.length ? ' hidden' : ''}>Aucun article ne correspond pour le moment.</p>
      <div class="center-link"><a class="link-arrow" href="/rss.xml">${I.rss} S’abonner au flux RSS</a></div>

      ${newsletter('blog')}
    </div>
  </main>`;
  return page({
    title: 'Blog : IA privée, cybersécurité et transformation numérique | Renaissance iTech',
    desc: 'IA privée, automatisation, cybersécurité et transformation numérique : des conseils concrets pour les PME et TPE, par l’équipe Renaissance iTech.',
    canonical: `${SITE}/blog`,
    body,
    head: `<script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org', '@type': 'Blog', name: 'Blog Renaissance iTech', url: `${SITE}/blog`,
      blogPost: articles.map((a) => ({ '@type': 'BlogPosting', headline: a.title, url: `${SITE}/blog/${a.slug}/`, datePublished: isoDate(a.date) })),
    })}</script>`,
  });
}

function articlePage(a, articles) {
  const url = `${SITE}/blog/${a.slug}/`;
  const related = [
    ...articles.filter((x) => x !== a && x.catKey === a.catKey),
    ...articles.filter((x) => x !== a && x.catKey !== a.catKey),
  ].slice(0, 3);
  const [ctaTitle, ctaText] = CTA[a.catKey];
  const shareText = encodeURIComponent(a.title);
  const shareUrl = encodeURIComponent(url);

  const jsonld = [
    {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: a.title,
      description: a.description,
      image: `${SITE}${socialImage(a.image)}`,
      datePublished: isoDate(a.date),
      dateModified: isoDate(a.updated || a.date),
      author: { '@type': 'Organization', name: a.author, url: SITE },
      publisher: { '@type': 'Organization', name: 'Renaissance iTech', logo: { '@type': 'ImageObject', url: `${SITE}/assets/img/logo-mark.svg` } },
      mainEntityOfPage: url,
      articleSection: a.category,
      keywords: a.tags.join(', '),
      inLanguage: 'fr-FR',
      wordCount: a.body.split(/\s+/).filter(Boolean).length,
      citation: a.references.map((r) => ({ '@type': 'CreativeWork', name: r.titre, url: r.url, publisher: r.source })),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Accueil', item: `${SITE}/` },
        { '@type': 'ListItem', position: 2, name: 'Blog', item: `${SITE}/blog` },
        { '@type': 'ListItem', position: 3, name: a.title, item: url },
      ],
    },
  ];

  const body = `<div class="read-progress" aria-hidden="true"><i data-read-progress></i></div>
  ${header()}
  <main class="page article-page">
    <div class="container">
      <nav class="breadcrumb" aria-label="Fil d’Ariane"><a href="/">Accueil</a><span>/</span><a href="/blog">Blog</a><span>/</span><span aria-current="page">${esc(a.category)}</span></nav>
      <header class="article-head">
        <span class="badge">${esc(a.category)}</span>
        <h1>${esc(a.title)}</h1>
        <p class="article-lead">${esc(a.description)}</p>
        <p class="article-meta"><span class="author-dot" aria-hidden="true">R</span>${meta(a)}${a.updated ? `<span aria-hidden="true">·</span><span>Mis à jour le <time datetime="${isoDate(a.updated)}">${frDate(a.updated)}</time></span>` : ''}</p>
      </header>
      <figure class="article-cover"><img src="${esc(a.image)}" alt="${esc(a.imageAlt)}" width="1200" height="630"></figure>

      <div class="article-layout">
        <article class="prose">
          ${a.html}

          ${a.references.length ? `<section class="references" aria-labelledby="refs">
            <h2 id="refs">Sources et références</h2>
            <ol>
              ${a.references.map((r, n) => `<li id="ref-${n + 1}"><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.titre)}</a>, ${esc(r.source)}${r.date ? `, ${esc(r.date)}` : ''}. <a class="ref-back" href="#cite-${n + 1}" aria-label="Retour au texte">↩</a></li>`).join('\n              ')}
            </ol>
          </section>` : ''}

          ${a.tags.length ? `<ul class="tags" aria-label="Mots-clés">${a.tags.map((t) => `<li>#${esc(t)}</li>`).join('')}</ul>` : ''}

          <div class="author-box">
            <img src="/assets/img/logo-mark.svg" alt="" width="48" height="48">
            <div><strong>${esc(a.author)}</strong><p>IA privée &amp; souveraine pour PME et TPE. Nous déployons des assistants IA sur vos données, automatisons vos processus et formons vos équipes, en France et en Guinée.</p></div>
          </div>
        </article>

        <aside class="article-aside">
          ${a.toc.length > 1 ? `<nav class="card toc" aria-label="Sommaire">
            <h2>Sommaire</h2>
            <ol>
              ${a.toc.map((t) => `<li class="toc-${t.depth}"><a href="#${t.id}" data-toc-link>${esc(t.text)}</a></li>`).join('\n              ')}
            </ol>
          </nav>` : ''}
          <div class="card share">
            <h2>Partager</h2>
            <div class="share-row">
              <a href="https://www.linkedin.com/sharing/share-offsite/?url=${shareUrl}" target="_blank" rel="noopener" aria-label="Partager sur LinkedIn">${SOCIAL.linkedin}</a>
              <a href="https://x.com/intent/post?text=${shareText}&amp;url=${shareUrl}" target="_blank" rel="noopener" aria-label="Partager sur X">${SOCIAL.x}</a>
              <a href="https://www.facebook.com/sharer/sharer.php?u=${shareUrl}" target="_blank" rel="noopener" aria-label="Partager sur Facebook">${SOCIAL.facebook}</a>
              <a href="https://wa.me/?text=${shareText}%20${shareUrl}" target="_blank" rel="noopener" aria-label="Partager sur WhatsApp">${SOCIAL.whatsapp}</a>
              <button type="button" data-copy-link="${url}" aria-label="Copier le lien">${I.link}</button>
            </div>
          </div>
          <div class="card cta-card">
            <h2>${ctaTitle}</h2>
            <p>${ctaText}</p>
            <a class="btn btn-primary btn-block" href="/contact">Demander un devis</a>
            <a class="btn btn-outline btn-block" href="/rendez-vous">Prendre rendez-vous</a>
          </div>
        </aside>
      </div>

      ${newsletter('article')}

      ${related.length ? `<section class="related" aria-labelledby="related-title">
        <h2 id="related-title">À lire aussi</h2>
        <div class="posts">
          ${related.map(card).join('\n          ')}
        </div>
      </section>` : ''}
    </div>
  </main>`;

  return page({
    title: `${a.title} | Blog Renaissance iTech`,
    desc: a.description,
    canonical: url,
    type: 'article',
    image: a.image,
    body,
    head: `<meta property="article:published_time" content="${isoDate(a.date)}">
  ${a.updated ? `<meta property="article:modified_time" content="${isoDate(a.updated)}">\n  ` : ''}<meta property="article:section" content="${esc(a.category)}">
  ${a.tags.map((t) => `<meta property="article:tag" content="${esc(t)}">`).join('\n  ')}
  <script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, '\\u003c')}</script>`,
  });
}

function rss(articles) {
  const items = articles.map((a) => `    <item>
      <title>${esc(a.title)}</title>
      <link>${SITE}/blog/${a.slug}/</link>
      <guid isPermaLink="true">${SITE}/blog/${a.slug}/</guid>
      <pubDate>${a.date.toUTCString()}</pubDate>
      <category>${esc(a.category)}</category>
      <description>${esc(a.description)}</description>
    </item>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Blog Renaissance iTech</title>
    <link>${SITE}/blog</link>
    <atom:link href="${SITE}/rss.xml" rel="self" type="application/rss+xml"/>
    <description>Conseils, actualités et tendances : IA, développement web, cybersécurité et entrepreneuriat.</description>
    <language>fr-FR</language>
${items}
  </channel>
</rss>
`;
}

function sitemap(articles) {
  const urls = [
    ...PAGES.map((p) => ({ loc: p === 'index.html' ? `${SITE}/` : `${SITE}/${p.replace(/\.html$/, '')}` })),
    ...articles.map((a) => ({ loc: `${SITE}/blog/${a.slug}/`, lastmod: isoDate(a.updated || a.date) })),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u.loc}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`).join('\n')}
</urlset>
`;
}

/* ---------------------------------------------------------------- exécution */

const files = readdirSync(CONTENT).filter((f) => f.endsWith('.md') && !f.startsWith('_'));
const all = files.map(parseArticle).filter(Boolean);

if (errors.length) {
  console.error(`\nArticles à corriger :\n${errors.join('\n')}\n`);
  process.exit(1);
}

const articles = all.filter((a) => !a.draft).sort((x, y) => y.date - x.date);
const drafts = all.length - articles.length;
for (const a of articles) Object.assign(a, renderBody(a));

if (CHECK_ONLY) {
  console.log(`✓ ${articles.length} article(s) valide(s)${drafts ? `, ${drafts} brouillon(s)` : ''}.`);
  process.exit(0);
}

rmSync(join(ROOT, 'blog'), { recursive: true, force: true });
for (const a of articles) {
  const dir = join(ROOT, 'blog', a.slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), articlePage(a, articles));
}
writeFileSync(join(ROOT, 'blog.html'), listingPage(articles));
writeFileSync(join(ROOT, 'rss.xml'), rss(articles));
writeFileSync(join(ROOT, 'sitemap.xml'), sitemap(articles));

console.log(`✓ Blog généré : ${articles.length} article(s) publié(s)${drafts ? `, ${drafts} brouillon(s) ignoré(s)` : ''}.`);
