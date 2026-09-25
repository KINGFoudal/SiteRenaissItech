// Outils communs du Worker Renaissance iTech

export const TZ = 'Europe/Paris';
export const EMAIL_RE = /^[^@\s]{1,64}@[^@\s]{1,255}\.[^@\s]{2,}$/;

export class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

export const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
});

export const esc = (s = '') => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const clean = (v, max) => String(v ?? '').trim().slice(0, max);
// Adresse du site telle que le visiteur l'utilise (domaine officiel ou adresse de test)
export const siteUrl = (env, request) => new URL(request.url).origin;

export function checkOrigin(request) {
  const origin = request.headers.get('Origin');
  if (origin && new URL(origin).host !== new URL(request.url).host) throw new HttpError(403, 'Origine non autorisée.');
}

export async function readJson(request) {
  checkOrigin(request);
  try { return await request.json(); } catch { throw new HttpError(400, 'Requête invalide.'); }
}

export async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const ipHash = async (request) => (await sha256(`rit:${request.headers.get('CF-Connecting-IP') || ''}`)).slice(0, 24);

export function randomToken(bytes = 32) {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function rateLimit(env, table, hash, max, window = '-1 hour', message = 'Trop de demandes. Réessayez dans une heure ou écrivez-nous par email.') {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ip_hash = ? AND cree_le > datetime('now', ?)`).bind(hash, window).first();
  if (row && row.n >= max) throw new HttpError(429, message);
}

export function requireDb(env) {
  if (!env.DB) throw new HttpError(503, 'Service momentanément indisponible. Écrivez-nous à contact@renaissance-itech.com.');
}

/* ---------- Dates (heure de Paris) ---------- */

const parts = (d) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).formatToParts(d).map((x) => [x.type, x.value]));

export function parisNow() {
  const p = parts(new Date());
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

export function parisToUtc(date, time) {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const p = parts(new Date(guess));
  const shown = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return new Date(guess - (shown - guess));
}

export function validDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export const frDate = (s) => new Date(`${s}T12:00:00Z`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/* ---------- Cookies ---------- */

export function getCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

/* ---------- Emails (Brevo) ---------- */

export const emailLayout = (title, body) => `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#111">
  <div style="background:#0A0A0A;padding:18px 24px;border-radius:8px 8px 0 0"><strong style="color:#fff;font-size:16px">RENAISSANCE <span style="color:#FF6B1A">ITECH</span></strong></div>
  <div style="border:1px solid #eee;border-top:0;padding:24px;border-radius:0 0 8px 8px">
    <h2 style="margin:0 0 16px;font-size:20px">${title}</h2>${body}
    <p style="margin-top:24px;font-size:13px;color:#666">Renaissance iTech · contact@renaissance-itech.com · +33 7 75 70 08 67</p>
  </div></div>`;

export const emailButton = (href, label) => `<p style="margin:24px 0"><a href="${esc(href)}" style="display:inline-block;background:#C2410C;color:#fff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:6px">${esc(label)}</a></p>`;

export const emailTable = (rows) => `<table style="width:100%;border-collapse:collapse;font-size:14px">${rows.filter(([, v]) => v).map(([k, v]) => `<tr><td style="padding:8px 0;color:#666;width:130px;vertical-align:top">${esc(k)}</td><td style="padding:8px 0">${esc(v).replace(/\n/g, '<br>')}</td></tr>`).join('')}</table>`;

// N'échoue jamais : les données sont déjà enregistrées en base
export async function sendEmail(env, { to, subject, html, replyTo, attachment }) {
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

export const toBase64 = (text) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));

export const notifyEmail = (env) => env.NOTIFY_EMAIL || 'contact@renaissance-itech.com';

/* ---------- Clients ---------- */

// Crée le client s'il n'existe pas, complète son nom et son téléphone sinon
export async function upsertClient(env, { email, nom, telephone }) {
  await env.DB.prepare(`INSERT INTO clients (email, nom, telephone) VALUES (?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET nom = COALESCE(clients.nom, excluded.nom), telephone = COALESCE(clients.telephone, excluded.telephone)`)
    .bind(email, nom || null, telephone || null).run();
  return env.DB.prepare('SELECT * FROM clients WHERE email = ?').bind(email).first();
}
