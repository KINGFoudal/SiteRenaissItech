// Audit complet du site : liens, SEO, accessibilité, responsive, mobile, sécurité, contenu, parcours.
// Usage : node scripts/audit-site.cjs http://localhost:8787 audit   (serveur lancé avec « npx wrangler dev »)
// Les parcours envoient de vrais formulaires : à lancer uniquement sur une copie locale, jamais sur le site en ligne.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('fs');
const BASE = process.argv[2] || 'http://localhost:8787';
const OUT = process.argv[3] || 'audit';
fs.mkdirSync(OUT, { recursive: true });
const F = []; // constats
const add = (sev, cat, page, msg) => F.push({ sev, cat, page, msg });
const IGNORE_NET = /fonts\.(googleapis|gstatic)\.com|cloudflareinsights/;

(async () => {
  const b = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const ctx = await b.newContext({ ignoreHTTPSErrors: true });

  // Pages : sitemap + pages non indexées
  const sm = await (await fetch(BASE + '/sitemap.xml')).text();
  const pages = [...sm.matchAll(/<loc>https:\/\/www\.renaissance-itech\.com(\/[^<]*)<\/loc>/g)].map((m) => m[1]);
  const extra = ['/merci-contact', '/rendez-vous-confirme?service=Cybers%C3%A9curit%C3%A9&date=2026-10-06&heure=10:00', '/newsletter-confirmee', '/desinscription', '/espace-client', '/admin', '/connexion', '/page-inexistante'];
  const all = [...new Set([...pages, ...extra])];

  // robots / sitemap
  const robots = await (await fetch(BASE + '/robots.txt')).text();
  if (!/Sitemap:/.test(robots)) add('HAUTE', 'SEO', '/robots.txt', 'robots.txt sans ligne Sitemap');
  for (const p of pages) { const r = await fetch(BASE + p, { redirect: 'manual' }); if (r.status !== 200) add('HAUTE', 'SEO', p, `URL du sitemap en ${r.status} (doit être 200)`); }

  // En-têtes de sécurité
  const h = (await fetch(BASE + '/')).headers;
  for (const k of ['content-security-policy', 'strict-transport-security', 'x-content-type-options', 'x-frame-options', 'referrer-policy', 'permissions-policy']) if (!h.get(k)) add('MOYENNE', 'Sécurité', '/', `En-tête manquant : ${k}`);
  const cssH = (await fetch(BASE + '/assets/css/style.css')).headers.get('cache-control');

  const titles = {}, descs = {}, links = new Set();
  const page = await ctx.newPage();
  let consoleErr = [], failed = [];
  page.on('console', (m) => { if (m.type() === 'error' && !IGNORE_NET.test(m.text()) && !/401|404/.test(m.text())) consoleErr.push(m.text()); });
  page.on('pageerror', (e) => consoleErr.push('JS: ' + e.message));
  page.on('requestfailed', (r) => { if (!IGNORE_NET.test(r.url())) failed.push(r.url()); });

  for (const p of all) {
    consoleErr = []; failed = [];
    const res = await page.goto(BASE + p, { waitUntil: 'networkidle' });
    const st = res.status();
    if (p === '/page-inexistante') { if (st !== 404) add('HAUTE', 'Liens', p, `Page inexistante renvoie ${st} au lieu de 404`); }
    else if (st !== 200) add('CRITIQUE', 'Liens', p, `Statut HTTP ${st}`);
    const d = await page.evaluate(() => {
      const q = (s) => document.querySelector(s);
      const txt = document.body.innerText;
      const rgb = (c) => (c.match(/[\d.]+/g) || []).map(Number);
      const lum = ([r, g, bl]) => { const f = (v) => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(bl); };
      const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.backgroundImage !== 'none' && !/gradient/.test(cs.backgroundImage)) return null; const c = rgb(cs.backgroundColor); if (c.length >= 3 && (c[3] === undefined || c[3] > .9)) return c; if (/gradient/.test(cs.backgroundImage)) return null; } return [255, 255, 255]; };
      const contrast = [];
      for (const el of document.querySelectorAll('body *')) {
        if (!el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
        const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
        const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || +cs.opacity === 0 || el.closest('[hidden],[aria-hidden="true"]')) continue;
        const fg = rgb(cs.color); const bg = bgOf(el); if (!bg || (fg[3] !== undefined && fg[3] < .9)) continue;
        const L1 = lum(fg), L2 = lum(bg); const ratio = (Math.max(L1, L2) + .05) / (Math.min(L1, L2) + .05);
        const size = parseFloat(cs.fontSize), bold = +cs.fontWeight >= 700; const large = size >= 24 || (bold && size >= 18.66);
        const need = large ? 3 : 4.5;
        if (ratio < need) contrast.push(`${ratio.toFixed(2)}:1 (min ${need}) « ${el.textContent.trim().slice(0, 40)} » ${cs.color} sur rgb(${bg.join(',')})`);
      }
      const noName = [...document.querySelectorAll('a[href],button')].filter((e) => e.offsetParent !== null && !(e.innerText.trim() || e.getAttribute('aria-label') || e.getAttribute('title') || e.querySelector('img[alt]:not([alt=""])'))).map((e) => e.outerHTML.slice(0, 80));
      const unlabeled = [...document.querySelectorAll('input:not([type=hidden]):not([tabindex="-1"]),select,textarea')].filter((e) => e.offsetParent !== null && !(e.labels?.length || e.getAttribute('aria-label') || e.getAttribute('aria-labelledby'))).map((e) => e.name || e.id || e.type);
      const heads = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter((e) => e.offsetParent !== null).map((e) => +e.tagName[1]);
      let skip = null; for (let i = 1; i < heads.length; i++) if (heads[i] > heads[i - 1] + 1) { skip = `h${heads[i - 1]} → h${heads[i]}`; break; }
      const imgs = [...document.images];
      const ld = [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => { try { JSON.parse(s.textContent); return 'ok'; } catch { return 'invalide'; } });
      return {
        lang: document.documentElement.lang, title: document.title, desc: q('meta[name=description]')?.content || '', canonical: q('link[rel=canonical]')?.href || '',
        og: !!q('meta[property="og:title"]') && !!q('meta[property="og:image"]'), robots: q('meta[name=robots]')?.content || '', h1: document.querySelectorAll('h1').length,
        viewport: !!q('meta[name=viewport]'), noAlt: imgs.filter((i) => !i.hasAttribute('alt')).map((i) => i.src), broken: imgs.filter((i) => i.complete && i.naturalWidth === 0 && !/fonts/.test(i.src)).map((i) => i.src),
        dash: (txt.match(/.{0,25}[—–].{0,25}/g) || []).slice(0, 3), placeholder: (txt.match(/lorem ipsum|TODO|TBD|xxx|à compléter/gi) || []),
        links: [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')), contrast: contrast.slice(0, 8), contrastN: contrast.length, noName, unlabeled, skip, ld,
        words: txt.split(/\s+/).length,
      };
    });
    const priv = /espace-client|admin|connexion|merci|confirme|desinscription|inexistante/.test(p);
    if (d.lang !== 'fr') add('MOYENNE', 'SEO', p, `lang="${d.lang}"`);
    if (!d.viewport) add('HAUTE', 'Mobile', p, 'meta viewport absente');
    if (!d.title) add('HAUTE', 'SEO', p, 'Titre absent'); else if (!priv && (d.title.length < 20 || d.title.length > 70)) add('BASSE', 'SEO', p, `Titre de ${d.title.length} caractères (idéal 30 à 65) : « ${d.title} »`);
    if (!priv) {
      if (!d.desc) add('HAUTE', 'SEO', p, 'Meta description absente'); else if (d.desc.length < 70 || d.desc.length > 165) add('BASSE', 'SEO', p, `Description de ${d.desc.length} caractères (idéal 70 à 160)`);
      if (!d.canonical) add('MOYENNE', 'SEO', p, 'Balise canonical absente');
      if (!d.og) add('BASSE', 'SEO', p, 'Balises Open Graph incomplètes');
      (titles[d.title] ||= []).push(p); (descs[d.desc] ||= []).push(p);
      if (d.words < 150 && !/plan-du-site/.test(p)) add('BASSE', 'Contenu', p, `Page courte (${d.words} mots)`);
    }
    if (d.h1 !== 1 && !/admin|espace-client/.test(p)) add('MOYENNE', 'SEO', p, `${d.h1} balise(s) H1 (il en faut 1)`);
    if (d.ld.includes('invalide')) add('HAUTE', 'SEO', p, 'JSON-LD invalide');
    d.noAlt.forEach((s) => add('HAUTE', 'Accessibilité', p, `Image sans attribut alt : ${s}`));
    d.broken.forEach((s) => add('CRITIQUE', 'Liens', p, `Image cassée : ${s}`));
    d.dash.forEach((s) => add('MOYENNE', 'Contenu', p, `Tiret long : « ${s} »`));
    d.placeholder.forEach((s) => add('HAUTE', 'Contenu', p, `Texte provisoire : ${s}`));
    d.contrast.forEach((s) => add('MOYENNE', 'Accessibilité', p, `Contraste insuffisant ${s}`));
    if (d.contrastN > 8) add('MOYENNE', 'Accessibilité', p, `… et ${d.contrastN - 8} autre(s) contraste(s) insuffisant(s)`);
    d.noName.forEach((s) => add('HAUTE', 'Accessibilité', p, `Lien ou bouton sans nom accessible : ${s}`));
    d.unlabeled.forEach((s) => add('HAUTE', 'Accessibilité', p, `Champ de formulaire sans étiquette : ${s}`));
    if (d.skip) add('BASSE', 'Accessibilité', p, `Titres qui sautent un niveau : ${d.skip}`);
    consoleErr.forEach((s) => add('HAUTE', 'Erreurs', p, `Console : ${s.slice(0, 150)}`));
    failed.forEach((s) => add('HAUTE', 'Erreurs', p, `Requête échouée : ${s}`));
    d.links.forEach((l) => links.add(new URL(l, BASE + p).href));
  }
  Object.entries(titles).filter(([, v]) => v.length > 1).forEach(([t, v]) => add('MOYENNE', 'SEO', v.join(', '), `Titre en double : « ${t} »`));
  Object.entries(descs).filter(([k, v]) => k && v.length > 1).forEach(([, v]) => add('MOYENNE', 'SEO', v.join(', '), 'Description en double'));

  // Liens internes
  let nInt = 0, nExt = 0;
  for (const l of links) {
    const u = new URL(l);
    if (!/^https?:$/.test(u.protocol)) continue;
    if (u.origin !== new URL(BASE).origin) { nExt++; continue; }
    nInt++;
    const r = await fetch(u.origin + u.pathname + u.search, { redirect: 'follow' });
    if (r.status >= 400) add('CRITIQUE', 'Liens', u.pathname, `Lien interne cassé (${r.status})`);
  }

  // Responsive : débordement horizontal à 8 largeurs
  const widths = [320, 375, 414, 768, 1024, 1280, 1440, 1920];
  for (const w of widths) {
    const rp = await ctx.newPage(); await rp.setViewportSize({ width: w, height: 900 });
    for (const p of all.filter((x) => x !== '/page-inexistante')) {
      await rp.goto(BASE + p, { waitUntil: 'networkidle' });
      const o = await rp.evaluate(() => {
        const W = document.documentElement.clientWidth;
        if (document.documentElement.scrollWidth <= W + 1) return null;
        const bad = [...document.querySelectorAll('body *')].filter((e) => { const r = e.getBoundingClientRect(); return r.right > W + 1 && r.width > 0 && getComputedStyle(e).position !== 'fixed'; }).slice(0, 3).map((e) => e.tagName.toLowerCase() + (e.className ? '.' + String(e.className).split(' ')[0] : ''));
        return `${document.documentElement.scrollWidth}px > ${W}px (${bad.join(', ')})`;
      });
      if (o) add('HAUTE', 'Responsive', p, `Défilement horizontal à ${w}px : ${o}`);
      if (w === 375 || w === 1440) await rp.screenshot({ path: `${OUT}/${w}-${(p.split('?')[0].replace(/\//g, '_') || '_accueil')}.png`, fullPage: true });
    }
    await rp.close();
  }

  // Mobile : zones tactiles et petite police (375px)
  const mp = await ctx.newPage(); await mp.setViewportSize({ width: 375, height: 812 });
  for (const p of pages) {
    await mp.goto(BASE + p, { waitUntil: 'networkidle' });
    const m = await mp.evaluate(() => {
      const small = [...document.querySelectorAll('a[href],button,input,select,textarea')].filter((e) => { const r = e.getBoundingClientRect(); return e.offsetParent !== null && r.width > 0 && (r.height < 32 || r.width < 32) && !e.closest('nav, .prose, p, li, footer'); }).map((e) => `${(e.innerText || e.getAttribute('aria-label') || e.tagName).trim().slice(0, 25)} (${Math.round(e.getBoundingClientRect().width)}×${Math.round(e.getBoundingClientRect().height)})`);
      const tiny = [...document.querySelectorAll('p,li,span,a,small,td')].filter((e) => e.offsetParent !== null && e.innerText.trim() && parseFloat(getComputedStyle(e).fontSize) < 12 && !e.closest('[aria-hidden="true"]')).length;
      return { small: small.slice(0, 5), nSmall: small.length, tiny };
    });
    if (m.nSmall) add('BASSE', 'Mobile', p, `${m.nSmall} zone(s) tactile(s) < 32px : ${m.small.join(' ; ')}`);
    if (m.tiny) add('BASSE', 'Mobile', p, `${m.tiny} élément(s) de texte < 12px`);
  }

  // Parcours fonctionnels
  const fp = await ctx.newPage();
  try {
    await fp.goto(BASE + '/contact?sujet=Cybers%C3%A9curit%C3%A9');
    if (await fp.inputValue('[name=sujet]') !== 'Cybersécurité') add('HAUTE', 'Parcours', '/contact', 'Pré-remplissage du sujet inopérant');
    await fp.fill('[name=nom]', 'Audit Robot'); await fp.fill('[name=email]', 'audit@example.com'); await fp.fill('[name=message]', 'Message de test automatique de l’audit.');
    await Promise.all([fp.waitForURL('**/merci-contact', { timeout: 10000 }), fp.click('[data-contact-form] button[type=submit]')]);
  } catch (e) { add('CRITIQUE', 'Parcours', '/contact', 'Envoi du formulaire de contact : ' + e.message.split('\n')[0]); }
  try {
    await fp.goto(BASE + '/rendez-vous?service=Automatisation%20IA');
    if (await fp.inputValue('[data-service]') !== 'Automatisation IA') add('HAUTE', 'Parcours', '/rendez-vous', 'Pré-sélection du service inopérante');
    await fp.waitForSelector('.slot:not([disabled])', { timeout: 10000 });
    await fp.click('.slot:not([disabled])');
    const next = fp.locator('[data-next]:visible, [data-step="2"] .btn-primary:visible').first(); if (await next.count()) await next.click();
    await fp.fill('form[data-step="3"] [name=nom]', 'Audit Robot'); await fp.fill('form[data-step="3"] [name=email]', 'audit-rdv@example.com');
    await Promise.all([fp.waitForURL('**/rendez-vous-confirme**', { timeout: 10000 }), fp.click('form[data-step="3"] button[type=submit]')]);
    if (!(await fp.isVisible('[data-cal-google]'))) add('HAUTE', 'Parcours', '/rendez-vous-confirme', 'Boutons « ajouter à l’agenda » absents');
  } catch (e) { add('CRITIQUE', 'Parcours', '/rendez-vous', 'Prise de rendez-vous : ' + e.message.split('\n')[0]); }
  try {
    await fp.goto(BASE + '/');
    await fp.click('.assistant-fab'); await fp.fill('.assistant-form textarea, .assistant-form input', 'Proposez-vous de la maintenance ?');
    await fp.press('.assistant-form textarea, .assistant-form input', 'Enter');
    await fp.waitForFunction(() => document.querySelectorAll('.assistant-msg').length >= 3, null, { timeout: 15000 });
  } catch (e) { add('HAUTE', 'Parcours', '/', 'Assistant : ' + e.message.split('\n')[0]); }
  try {
    await fp.goto(BASE + '/admin');
    await fp.fill('[data-login] input[type=email]', 'contact@renaissance-itech.com');
    await fp.click('[data-login] button[type=submit]');
    await fp.waitForSelector('[data-login] .form-msg:not([hidden]), [data-login] [data-msg]:not([hidden])', { timeout: 10000 });
  } catch (e) { add('HAUTE', 'Parcours', '/admin', 'Demande de lien de connexion : ' + e.message.split('\n')[0]); }
  try {
    await fp.goto(BASE + '/services');
    await fp.setViewportSize({ width: 1440, height: 900 });
    await fp.hover('#cybersecurite');
    if (!(await fp.isVisible('#svc-cybersecurite')) || await fp.isVisible('#svc-ia-privee')) add('HAUTE', 'Parcours', '/services', 'Le survol n’affiche pas un seul service');
  } catch (e) { add('HAUTE', 'Parcours', '/services', 'Survol des services : ' + e.message.split('\n')[0]); }

  await b.close();
  const order = { CRITIQUE: 0, HAUTE: 1, MOYENNE: 2, BASSE: 3 };
  F.sort((a, c) => order[a.sev] - order[c.sev] || a.cat.localeCompare(c.cat));
  const counts = Object.fromEntries(Object.keys(order).map((k) => [k, F.filter((f) => f.sev === k).length]));
  fs.writeFileSync(`${OUT}/constats.json`, JSON.stringify({ base: BASE, pages: all.length, liensInternes: nInt, liensExternes: nExt, cacheCss: cssH, counts, constats: F }, null, 2));
  console.log(JSON.stringify({ pages: all.length, liensInternes: nInt, liensExternes: nExt, cacheCss: cssH, counts }));
  for (const f of F) console.log(`[${f.sev}] ${f.cat} | ${f.page} | ${f.msg}`);
})();
