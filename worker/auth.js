// Connexion par lien envoyé par email (sans mot de passe)
//
// 1. POST /api/auth/lien      { email, espace }  → envoie un lien valable 20 minutes
// 2. Le lien ouvre /connexion?jeton=…             → la page confirme par un clic (les robots
//    des messageries ouvrent les liens, ils ne cliquent pas sur les boutons)
// 3. POST /api/auth/verifier  { jeton }          → ouvre une session de 30 jours (cookie HttpOnly)

import {
  HttpError, json, clean, readJson, ipHash, rateLimit, requireDb, EMAIL_RE, sha256, randomToken,
  getCookie, emailLayout, emailButton, sendEmail, siteUrl, upsertClient,
} from './lib.js';

const COOKIE = 'rit_session';
const LIEN_MINUTES = 20;
const SESSION_JOURS = 30;

const adminEmails = (env) => (env.ADMIN_EMAILS || 'contact@renaissance-itech.com').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);

export async function demanderLien(request, env, ctx) {
  const data = await readJson(request);
  const email = clean(data.email, 254).toLowerCase();
  const role = data.espace === 'admin' ? 'admin' : 'client';
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Merci d’indiquer un email valide.');
  requireDb(env);

  const hash = await ipHash(request);
  await rateLimit(env, 'jetons_connexion', hash, 5, '-1 hour', 'Trop de demandes de connexion. Réessayez dans une heure.');

  const reponse = json({ ok: true, message: 'Si cette adresse est autorisée, un lien de connexion vient de vous être envoyé. Il est valable 20 minutes.' });
  // Même réponse dans tous les cas : on ne révèle pas quelles adresses ont un accès administrateur
  if (role === 'admin' && !adminEmails(env).includes(email)) return reponse;

  const jeton = randomToken();
  await env.DB.prepare(`INSERT INTO jetons_connexion (hash, email, role, expire_le, ip_hash) VALUES (?, ?, ?, datetime('now', ?), ?)`)
    .bind(await sha256(jeton), email, role, `+${LIEN_MINUTES} minutes`, hash).run();

  const lien = `${siteUrl(env, request)}/connexion?jeton=${encodeURIComponent(jeton)}`;
  const espace = role === 'admin' ? 'l’administration' : 'votre espace client';
  ctx.waitUntil(sendEmail(env, {
    to: email,
    subject: 'Votre lien de connexion Renaissance iTech',
    html: emailLayout('Connexion à votre compte', `<p>Bonjour,</p><p>Cliquez sur le bouton ci-dessous pour accéder à ${espace}. Ce lien est valable ${LIEN_MINUTES} minutes et ne peut servir qu’une fois.</p>${emailButton(lien, 'Me connecter')}<p style="font-size:13px;color:#666">Vous n’êtes pas à l’origine de cette demande ? Ignorez simplement cet email : personne ne pourra se connecter sans ce lien.</p>`),
  }));
  return reponse;
}

export async function verifierLien(request, env) {
  const data = await readJson(request);
  const jeton = clean(data.jeton, 200);
  if (!jeton) throw new HttpError(400, 'Lien de connexion invalide.');
  requireDb(env);

  const hash = await sha256(jeton);
  const row = await env.DB.prepare("SELECT * FROM jetons_connexion WHERE hash = ? AND utilise = 0 AND expire_le > datetime('now')").bind(hash).first();
  if (!row) throw new HttpError(400, 'Ce lien a expiré ou a déjà été utilisé. Demandez un nouveau lien de connexion.');
  await env.DB.prepare('UPDATE jetons_connexion SET utilise = 1 WHERE hash = ?').bind(hash).run();

  if (row.role === 'client') {
    await upsertClient(env, { email: row.email });
    await env.DB.prepare("UPDATE clients SET derniere_connexion = datetime('now') WHERE email = ?").bind(row.email).run();
  }

  const session = randomToken();
  await env.DB.prepare(`INSERT INTO sessions (hash, email, role, expire_le) VALUES (?, ?, ?, datetime('now', ?))`)
    .bind(await sha256(session), row.email, row.role, `+${SESSION_JOURS} days`).run();
  // Ménage des jetons et sessions expirés
  await env.DB.batch([
    env.DB.prepare("DELETE FROM jetons_connexion WHERE expire_le < datetime('now', '-1 day')"),
    env.DB.prepare("DELETE FROM sessions WHERE expire_le < datetime('now')"),
  ]);

  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return json(
    { ok: true, role: row.role, redirect: row.role === 'admin' ? '/admin' : '/espace-client' },
    200,
    { 'Set-Cookie': `${COOKIE}=${session}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_JOURS * 86400}${secure}` },
  );
}

export async function deconnexion(request, env) {
  const token = getCookie(request, COOKIE);
  if (token && env.DB) await env.DB.prepare('DELETE FROM sessions WHERE hash = ?').bind(await sha256(token)).run();
  return json({ ok: true }, 200, { 'Set-Cookie': `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` });
}

export async function getSession(request, env) {
  const token = getCookie(request, COOKIE);
  if (!token || !env.DB) return null;
  return env.DB.prepare("SELECT email, role FROM sessions WHERE hash = ? AND expire_le > datetime('now')").bind(await sha256(token)).first();
}

export async function requireSession(request, env, role) {
  const s = await getSession(request, env);
  if (!s) throw new HttpError(401, 'Veuillez vous connecter.');
  if (role && s.role !== role) throw new HttpError(403, 'Accès réservé.');
  return s;
}
