/*
 * Worker Cloudflare du site Renaissance iTech.
 *
 *   POST /api/contact      formulaire de contact        → base D1 + email
 *   GET  /api/creneaux     créneaux déjà réservés        (?date=AAAA-MM-JJ)
 *   POST /api/rendez-vous  prise de rendez-vous          → base D1 + emails (+ invitation .ics)
 *   POST /api/newsletter   inscription newsletter        → Brevo
 *   tout le reste          fichiers statiques du site    (binding ASSETS)
 *
 * Liaisons et variables (voir wrangler.jsonc et NEWSLETTER.md) :
 *   DB                     base D1 « renaissance-itech-db »
 *   BREVO_API_KEY          (secret) clé API Brevo : envoi des emails et newsletter
 *   BREVO_LIST_ID          liste « Newsletter »
 *   BREVO_DOI_TEMPLATE_ID  (option) modèle de double opt-in
 *   NOTIFY_EMAIL           adresse qui reçoit les demandes
 *   SENDER_EMAIL           expéditeur des emails (vérifié dans Brevo)
 *   SITE_URL               ex. https://www.renaissance-itech.com
 */

const TZ = 'Europe/Paris';
const SLOTS = ['09:00', '10:00', '11:00', '14:00', '15:00'];
const RDV_MINUTES = 30;
const SERVICES = ['Conseil & stratégie digitale', 'Création de site web', 'Automatisation IA', 'Cybersécurité', 'Formations en ligne', 'SEO & Référencement'];
const SUJETS = ['Création de site web', 'Automatisation IA', 'Cybersécurité', 'Formations', 'Demande sur un produit', 'Autre demande'];
const EMAIL_RE = /^[^@\s]{1,64}@[^@\s]{1,255}\.[^@\s]{2,}$/;
const MAX_PER_HOUR = 5;

/* ---------------------------------------------------------------- utilitaires */

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

const esc = (s = '') => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clean = (v, max) => String(v ?? '').replace(/\s+$/g, '').trim().slice(0, max);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function checkOrigin(request) {
  const origin = request.headers.get('Origin');
  if (origin && new URL(origin).host !== new URL(request.url).host) throw new HttpError(403, 'Origine non autorisée.');
}

async function readJson(request) {
  checkOrigin(request);
  try { return await request.json(); } catch { throw new HttpError(400, 'Requête invalide.'); }
}

async function ipHash(request) {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`rit:${ip}`));
  return [...new Uint8Array(buf)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function rateLimit(env, table, hash) {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ip_hash = ? AND cree_le > datetime('now', '-1 hour')`).bind(hash).first();
  if (row && row.n >= MAX_PER_HOUR) throw new HttpError(429, 'Trop de demandes. Réessayez dans une heure ou écrivez-nous par email.');
}

// Date et heure actuelles à Paris
function parisNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

// Convertit une date/heure de Paris en instant UTC
function parisToUtc(date, time) {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
  const shown = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return new Date(guess - (shown - guess));
}

function validDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const frDate = (s) => new Date(`${s}T12:00:00Z`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/* ---------------------------------------------------------------- emails (Brevo) */

const emailLayout = (title, body) => `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#111">
  <div style="background:#0A0A0A;padding:18px 24px;border-radius:8px 8px 0 0"><strong style="color:#fff;font-size:16px">RENAISSANCE <span style="color:#FF6B1A">ITECH</span></strong></div>
  <div style="border:1px solid #eee;border-top:0;padding:24px;border-radius:0 0 8px 8px">
    <h2 style="margin:0 0 16px;font-size:20px">${title}</h2>${body}
    <p style="margin-top:24px;font-size:13px;color:#666">Renaissance iTech · contact@renaissance-itech.com · +33 7 75 70 08 67</p>
  </div></div>`;

const table = (rows) => `<table style="width:100%;border-collapse:collapse;font-size:14px">${rows.filter(([, v]) => v).map(([k, v]) => `<tr><td style="padding:8px 0;color:#666;width:130px;vertical-align:top">${esc(k)}</td><td style="padding:8px 0">${esc(v).replace(/\n/g, '<br>')}</td></tr>`).join('')}</table>`;

// N'échoue jamais : la demande est déjà enregistrée en base
async function sendEmail(env, { to, subject, html, replyTo, attachment }) {
  if (!env.BREVO_API_KEY) return false;
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        sender: { name: 'Renaissance iTech', email: env.SENDER_EMAIL || 'contact@renaissance-itech.com' },
        to: [{ email: to }],
        subject,
        htmlContent: html,
        ...(replyTo ? { replyTo: { email: replyTo } } : {}),
        ...(attachment ? { attachment: [attachment] } : {}),
      }),
    });
    if (!res.ok) console.error('Brevo email', res.status, await res.text());
    return res.ok;
  } catch (e) {
    console.error('Brevo email', e);
    return false;
  }
}

const toBase64 = (text) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));

function ics({ id, start, service, site }) {
  const fmt = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const end = new Date(start.getTime() + RDV_MINUTES * 60000);
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Renaissance iTech//Rendez-vous//FR', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:rdv-${id}@renaissance-itech.com`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:Rendez-vous Renaissance iTech — ${service}`,
    'DESCRIPTION:Visioconférence Google Meet. Le lien de la réunion vous est envoyé par email avant le rendez-vous.',
    `URL:${site}`,
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
}

/* ---------------------------------------------------------------- routes */

async function contact(request, env, ctx) {
  const data = await readJson(request);
  if (data.website) return json({ ok: true });

  const nom = clean(data.nom, 100);
  const email = clean(data.email, 254).toLowerCase();
  const sujet = clean(data.sujet, 60);
  const message = clean(data.message, 5000);
  if (nom.length < 2) throw new HttpError(400, 'Merci d’indiquer votre nom.');
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Merci d’indiquer un email valide.');
  if (!SUJETS.includes(sujet)) throw new HttpError(400, 'Merci de choisir un sujet.');
  if (message.length < 10) throw new HttpError(400, 'Votre message est un peu court (10 caractères minimum).');
  if (!env.DB) throw new HttpError(503, 'Le formulaire est momentanément indisponible. Écrivez-nous à contact@renaissance-itech.com.');

  const hash = await ipHash(request);
  await rateLimit(env, 'contacts', hash);
  const { meta } = await env.DB.prepare('INSERT INTO contacts (nom, email, sujet, message, ip_hash) VALUES (?, ?, ?, ?, ?)')
    .bind(nom, email, sujet, message, hash).run();

  const notify = env.NOTIFY_EMAIL || 'contact@renaissance-itech.com';
  ctx.waitUntil(Promise.all([
    sendEmail(env, {
      to: notify, replyTo: email,
      subject: `Nouvelle demande : ${sujet} — ${nom}`,
      html: emailLayout('Nouvelle demande de contact', table([['Nom', nom], ['Email', email], ['Sujet', sujet], ['Message', message], ['Référence', `#${meta.last_row_id}`]])),
    }),
    sendEmail(env, {
      to: email,
      subject: 'Nous avons bien reçu votre message',
      html: emailLayout(`Merci ${esc(nom)} !`, `<p>Nous avons bien reçu votre message et vous répondons sous 24h ouvrées.</p>${table([['Sujet', sujet], ['Message', message]])}<p>Besoin d’en parler de vive voix ? <a href="${esc(env.SITE_URL || '')}/rendez-vous" style="color:#E55A0C">Réservez un appel</a>.</p>`),
    }),
  ]));

  return json({ ok: true, message: 'Merci ! Votre message a bien été envoyé. Nous vous répondons sous 24h ouvrées.' });
}

async function creneaux(request, env) {
  const date = new URL(request.url).searchParams.get('date') || '';
  if (!validDate(date)) throw new HttpError(400, 'Date invalide.');
  if (!env.DB) return json({ date, pris: [] });
  const { results } = await env.DB.prepare("SELECT heure FROM rendez_vous WHERE date = ? AND statut = 'confirme'").bind(date).all();
  const now = parisNow();
  const passes = date === now.date ? SLOTS.filter((s) => s <= now.time) : [];
  return json({ date, pris: [...new Set([...results.map((r) => r.heure), ...passes])] });
}

async function rendezVous(request, env, ctx) {
  const data = await readJson(request);
  if (data.website) return json({ ok: true });

  const service = clean(data.service, 60);
  const date = clean(data.date, 10);
  const heure = clean(data.heure, 5);
  const nom = clean(data.nom, 100);
  const email = clean(data.email, 254).toLowerCase();
  const telephone = clean(data.telephone, 30);
  const message = clean(data.message, 2000);

  if (!SERVICES.includes(service)) throw new HttpError(400, 'Merci de choisir un service.');
  if (!validDate(date) || !SLOTS.includes(heure)) throw new HttpError(400, 'Merci de choisir une date et une heure.');
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  const now = parisNow();
  if (day === 0 || day === 6 || date < now.date || (date === now.date && heure <= now.time)) {
    throw new HttpError(400, 'Ce créneau n’est plus disponible. Merci d’en choisir un autre.');
  }
  if (nom.length < 2) throw new HttpError(400, 'Merci d’indiquer votre nom.');
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Merci d’indiquer un email valide.');
  if (!env.DB) throw new HttpError(503, 'La réservation est momentanément indisponible. Écrivez-nous à contact@renaissance-itech.com.');

  const hash = await ipHash(request);
  await rateLimit(env, 'rendez_vous', hash);

  let id;
  try {
    const { meta } = await env.DB.prepare('INSERT INTO rendez_vous (service, date, heure, nom, email, telephone, message, ip_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(service, date, heure, nom, email, telephone || null, message || null, hash).run();
    id = meta.last_row_id;
  } catch (e) {
    if (/UNIQUE/i.test(String(e.message || e))) throw new HttpError(409, 'Ce créneau vient d’être réservé. Merci d’en choisir un autre.');
    throw e;
  }

  const site = env.SITE_URL || new URL(request.url).origin;
  const quand = `${frDate(date)} à ${heure} (heure de Paris)`;
  const invitation = { name: 'rendez-vous-renaissance-itech.ics', content: toBase64(ics({ id, start: parisToUtc(date, heure), service, site })) };
  const notify = env.NOTIFY_EMAIL || 'contact@renaissance-itech.com';

  ctx.waitUntil(Promise.all([
    sendEmail(env, {
      to: notify, replyTo: email,
      subject: `Nouveau rendez-vous : ${frDate(date)} ${heure} — ${nom}`,
      html: emailLayout('Nouveau rendez-vous', `${table([['Service', service], ['Date', quand], ['Nom', nom], ['Email', email], ['Téléphone', telephone], ['Besoin', message], ['Référence', `#${id}`]])}<p><strong>À faire :</strong> créer la réunion Google Meet et envoyer le lien au client.</p>`),
      attachment: invitation,
    }),
    sendEmail(env, {
      to: email,
      subject: `Votre rendez-vous du ${frDate(date)} à ${heure} est confirmé`,
      html: emailLayout('Rendez-vous confirmé', `<p>Bonjour ${esc(nom)},</p><p>Votre rendez-vous avec Renaissance iTech est bien enregistré.</p>${table([['Service', service], ['Date', quand], ['Durée', `${RDV_MINUTES} minutes`], ['Lieu', 'Visioconférence Google Meet']])}<p>Vous recevrez le lien de la réunion par email avant le rendez-vous. L’invitation jointe l’ajoute à votre agenda.</p><p>Un empêchement ? Répondez simplement à cet email.</p>`),
      attachment: invitation,
    }),
  ]));

  return json({ ok: true, id, message: env.BREVO_API_KEY ? 'Rendez-vous confirmé. Un email de confirmation vient de vous être envoyé.' : 'Rendez-vous confirmé. Nous vous recontactons très vite par email.' });
}

async function newsletter(request, env) {
  const data = await readJson(request);
  if (data.website) return json({ ok: true, message: 'Merci !' });

  const email = clean(data.email, 254).toLowerCase();
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Merci d’indiquer un email valide.');
  if (data.consent !== true) throw new HttpError(400, 'Le consentement est obligatoire.');
  if (!env.BREVO_API_KEY || !env.BREVO_LIST_ID) throw new HttpError(503, 'La newsletter ouvre très bientôt. Revenez dans quelques jours !');

  const listId = Number(env.BREVO_LIST_ID);
  const site = env.SITE_URL || new URL(request.url).origin;
  const doi = env.BREVO_DOI_TEMPLATE_ID;
  const url = doi ? 'https://api.brevo.com/v3/contacts/doubleOptinConfirmation' : 'https://api.brevo.com/v3/contacts';
  const payload = doi
    ? { email, includeListIds: [listId], templateId: Number(doi), redirectionUrl: `${site}/blog?newsletter=confirmee` }
    : { email, listIds: [listId], updateEnabled: true };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  if (res.ok || res.status === 204) {
    return json({ ok: true, message: doi ? 'Merci ! Un email de confirmation vient de vous être envoyé.' : 'Merci ! Votre inscription est confirmée.' });
  }
  const err = await res.json().catch(() => ({}));
  if (err.code === 'duplicate_parameter') return json({ ok: true, message: 'Vous êtes déjà inscrit(e). Merci !' });
  console.error('Brevo', res.status, JSON.stringify(err));
  throw new HttpError(502, 'Inscription impossible pour le moment. Réessayez plus tard.');
}

const ROUTES = {
  'POST /api/contact': contact,
  'GET /api/creneaux': creneaux,
  'POST /api/rendez-vous': rendezVous,
  'POST /api/newsletter': newsletter,
};

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (!pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    const route = ROUTES[`${request.method} ${pathname}`];
    if (!route) {
      const known = Object.keys(ROUTES).some((k) => k.endsWith(` ${pathname}`));
      return json({ error: known ? 'Méthode non autorisée.' : 'Introuvable.' }, known ? 405 : 404);
    }
    try {
      return await route(request, env, ctx);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(pathname, e);
      return json({ error: 'Une erreur est survenue. Réessayez ou écrivez-nous à contact@renaissance-itech.com.' }, 500);
    }
  },
};
