// Connexion par email et mot de passe
//
// Espace client : réservé aux clients « premium », dont l'accès est créé par l'administrateur
// avec un mot de passe provisoire à changer à la première connexion.
// Administration : adresses listées dans ADMIN_EMAILS (premier mot de passe via « mot de passe oublié »).
//
//   POST /api/auth/connexion            { email, mot_de_passe, espace }
//   POST /api/auth/mot-de-passe-oublie  { email, espace }        → lien valable 30 minutes
//   POST /api/auth/reinitialiser        { jeton, mot_de_passe }
//   POST /api/auth/changer              { actuel, nouveau }      (connecté)
//   POST /api/auth/deconnexion
//
// Mots de passe : PBKDF2-SHA256, 100 000 itérations, sel aléatoire. Jamais stockés en clair.

import {
  HttpError, json, clean, readJson, ipHash, rateLimit, requireDb, EMAIL_RE, sha256, randomToken,
  getCookie, emailLayout, emailButton, sendEmail, siteUrl,
} from './lib.js';

const COOKIE = 'rit_session';
const SESSION_JOURS = 30;
const LIEN_MINUTES = 30;
const ITERATIONS = 100000;
const MAX_ECHECS_EMAIL = 8;   // par adresse, sur 15 minutes
const MAX_ECHECS_IP = 25;     // par connexion internet, sur 15 minutes
export const PROVISOIRE_JOURS = 7; // durée de validité d'un mot de passe provisoire

export const adminEmails = (env) => (env.ADMIN_EMAILS || 'contact@renaissance-itech.com').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);

/* ---------------------------------------------------------------- mots de passe */

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function pbkdf2(motDePasse, sel, iterations) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(motDePasse), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: sel, iterations }, key, 256);
}

export async function hacherMotDePasse(motDePasse) {
  const sel = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2-sha256$${ITERATIONS}$${b64(sel)}$${b64(await pbkdf2(motDePasse, sel, ITERATIONS))}`;
}

// Empreinte factice : la vérification prend le même temps, que le compte existe ou non
const EMPREINTE_FACTICE = 'pbkdf2-sha256$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

async function verifierMotDePasse(motDePasse, empreinte) {
  const [algo, it, sel, attendu] = String(empreinte || EMPREINTE_FACTICE).split('$');
  if (algo !== 'pbkdf2-sha256') return false;
  const calcule = new Uint8Array(await pbkdf2(motDePasse, unb64(sel), Number(it)));
  const ref = unb64(attendu);
  let diff = calcule.length ^ ref.length;
  for (let i = 0; i < calcule.length; i++) diff |= calcule[i] ^ (ref[i] ?? 0);
  return diff === 0 && Boolean(empreinte);
}

export function validerMotDePasse(motDePasse, email) {
  const m = String(motDePasse || '');
  if (m.length < 10) throw new HttpError(400, 'Le mot de passe doit contenir au moins 10 caractères.');
  if (m.length > 128) throw new HttpError(400, 'Le mot de passe est trop long (128 caractères maximum).');
  if (!/[a-zA-Z]/.test(m) || !/\d/.test(m)) throw new HttpError(400, 'Le mot de passe doit contenir au moins une lettre et un chiffre.');
  if (email && m.toLowerCase().includes(email.split('@')[0].toLowerCase())) throw new HttpError(400, 'Le mot de passe ne doit pas contenir votre adresse email.');
}

// Mot de passe provisoire lisible (sans caractères ambigus), ex. : Rit-7kpX-4mQa-9wZe
export function motDePasseProvisoire() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bloc = () => [...crypto.getRandomValues(new Uint8Array(4))].map((n) => alphabet[n % alphabet.length]).join('');
  let mdp;
  do { mdp = `Rit-${bloc()}-${bloc()}-${bloc()}`; } while (!/\d/.test(mdp));
  return mdp;
}

/* ---------------------------------------------------------------- comptes */

async function compte(env, email, role) {
  if (role === 'admin') {
    if (!adminEmails(env).includes(email)) return null;
    const row = await env.DB.prepare('SELECT email, mot_de_passe, doit_changer_mdp FROM administrateurs WHERE email = ?').bind(email).first();
    return row || { email, mot_de_passe: null, doit_changer_mdp: 0 };
  }
  return env.DB.prepare(`SELECT id, email, nom, mot_de_passe, doit_changer_mdp,
      (doit_changer_mdp = 1 AND mdp_maj_le < datetime('now', '-${PROVISOIRE_JOURS} days')) AS provisoire_expire
    FROM clients WHERE email = ? AND acces_premium = 1`).bind(email).first();
}

async function enregistrerMotDePasse(env, email, role, motDePasse, provisoire = false) {
  const empreinte = await hacherMotDePasse(motDePasse);
  const flag = provisoire ? 1 : 0;
  if (role === 'admin') {
    await env.DB.prepare(`INSERT INTO administrateurs (email, mot_de_passe, doit_changer_mdp, mdp_maj_le) VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(email) DO UPDATE SET mot_de_passe = excluded.mot_de_passe, doit_changer_mdp = excluded.doit_changer_mdp, mdp_maj_le = excluded.mdp_maj_le`)
      .bind(email, empreinte, flag).run();
  } else {
    await env.DB.prepare("UPDATE clients SET mot_de_passe = ?, doit_changer_mdp = ?, mdp_maj_le = datetime('now') WHERE email = ?").bind(empreinte, flag, email).run();
  }
}

export const fermerSessions = (env, email, role, sauf = null) => env.DB.prepare('DELETE FROM sessions WHERE email = ? AND role = ? AND hash IS NOT ?').bind(email, role, sauf).run();

async function ouvrirSession(env, request, email, role, extra = {}) {
  const session = randomToken();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO sessions (hash, email, role, expire_le) VALUES (?, ?, ?, datetime('now', ?))`).bind(await sha256(session), email, role, `+${SESSION_JOURS} days`),
    role === 'admin'
      ? env.DB.prepare("UPDATE administrateurs SET derniere_connexion = datetime('now') WHERE email = ?").bind(email)
      : env.DB.prepare("UPDATE clients SET derniere_connexion = datetime('now') WHERE email = ?").bind(email),
    env.DB.prepare("DELETE FROM sessions WHERE expire_le < datetime('now')"),
    env.DB.prepare("DELETE FROM jetons_mdp WHERE expire_le < datetime('now', '-1 day')"),
    env.DB.prepare("DELETE FROM tentatives_connexion WHERE cree_le < datetime('now', '-30 days')"),
  ]);
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return json(
    { ok: true, role, redirect: role === 'admin' ? '/admin' : '/espace-client', ...extra },
    200,
    { 'Set-Cookie': `${COOKIE}=${session}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_JOURS * 86400}${secure}` },
  );
}

/* ---------------------------------------------------------------- routes */

export async function connexion(request, env) {
  const data = await readJson(request);
  const email = clean(data.email, 254).toLowerCase();
  const motDePasse = String(data.mot_de_passe || '').slice(0, 128);
  const role = data.espace === 'admin' ? 'admin' : 'client';
  if (!EMAIL_RE.test(email) || !motDePasse) throw new HttpError(400, 'Indiquez votre email et votre mot de passe.');
  requireDb(env);

  const ip = await ipHash(request);
  const [parEmail, parIp] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS n FROM tentatives_connexion WHERE email = ? AND reussi = 0 AND cree_le > datetime('now', '-15 minutes')").bind(email).first(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM tentatives_connexion WHERE ip_hash = ? AND reussi = 0 AND cree_le > datetime('now', '-15 minutes')").bind(ip).first(),
  ]);
  if (parEmail.n >= MAX_ECHECS_EMAIL || parIp.n >= MAX_ECHECS_IP) {
    throw new HttpError(429, 'Trop de tentatives. Par sécurité, réessayez dans 15 minutes ou utilisez « Mot de passe oublié ».');
  }

  const c = await compte(env, email, role);
  const ok = await verifierMotDePasse(motDePasse, c?.mot_de_passe);
  await env.DB.prepare('INSERT INTO tentatives_connexion (email, ip_hash, reussi) VALUES (?, ?, ?)').bind(email, ip, ok ? 1 : 0).run();
  // Même message dans tous les cas : on ne révèle pas quelles adresses ont un accès
  if (!ok) throw new HttpError(401, 'Email ou mot de passe incorrect.');
  if (c.provisoire_expire) throw new HttpError(401, `Votre mot de passe provisoire a expiré (validité ${PROVISOIRE_JOURS} jours). Cliquez sur « Mot de passe oublié ? » pour en choisir un nouveau.`);

  return ouvrirSession(env, request, email, role, { doit_changer: Boolean(c.doit_changer_mdp) });
}

export async function motDePasseOublie(request, env, ctx) {
  const data = await readJson(request);
  const email = clean(data.email, 254).toLowerCase();
  const role = data.espace === 'admin' ? 'admin' : 'client';
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Merci d’indiquer un email valide.');
  requireDb(env);

  const ip = await ipHash(request);
  await rateLimit(env, 'jetons_mdp', ip, 5, '-1 hour', 'Trop de demandes. Réessayez dans une heure ou écrivez-nous à contact@renaissance-itech.com.');

  const reponse = json({ ok: true, message: 'Si cette adresse dispose d’un accès, un email avec un lien pour choisir un nouveau mot de passe vient de lui être envoyé. Le lien est valable 30 minutes.' });
  const c = await compte(env, email, role);
  if (!c) return reponse;

  const jeton = randomToken();
  await env.DB.prepare(`INSERT INTO jetons_mdp (hash, email, role, expire_le, ip_hash) VALUES (?, ?, ?, datetime('now', ?), ?)`)
    .bind(await sha256(jeton), email, role, `+${LIEN_MINUTES} minutes`, ip).run();
  const lien = `${siteUrl(env, request)}/mot-de-passe?jeton=${encodeURIComponent(jeton)}`;
  ctx.waitUntil(sendEmail(env, {
    to: email,
    subject: 'Choisissez un nouveau mot de passe (Renaissance iTech)',
    html: emailLayout('Nouveau mot de passe', `<p>Bonjour,</p><p>Vous avez demandé à changer le mot de passe de ${role === 'admin' ? 'l’administration' : 'votre espace client'}. Cliquez sur le bouton ci-dessous pour en choisir un nouveau. Ce lien est valable ${LIEN_MINUTES} minutes et ne peut servir qu’une fois.</p>${emailButton(lien, 'Choisir mon mot de passe')}<p style="font-size:13px;color:#666">Vous n’êtes pas à l’origine de cette demande ? Ignorez cet email : votre mot de passe actuel reste valable.</p>`),
  }));
  return reponse;
}

export async function reinitialiser(request, env) {
  const data = await readJson(request);
  const jeton = clean(data.jeton, 200);
  if (!jeton) throw new HttpError(400, 'Lien invalide.');
  requireDb(env);
  const hash = await sha256(jeton);
  const row = await env.DB.prepare("SELECT * FROM jetons_mdp WHERE hash = ? AND utilise = 0 AND expire_le > datetime('now')").bind(hash).first();
  if (!row) throw new HttpError(400, 'Ce lien a expiré ou a déjà été utilisé. Faites une nouvelle demande.');
  if (!(await compte(env, row.email, row.role))) throw new HttpError(400, 'Ce compte n’a plus d’accès. Contactez-nous.');
  validerMotDePasse(data.mot_de_passe, row.email);

  await env.DB.prepare('UPDATE jetons_mdp SET utilise = 1 WHERE email = ? AND role = ?').bind(row.email, row.role).run();
  await enregistrerMotDePasse(env, row.email, row.role, data.mot_de_passe);
  await fermerSessions(env, row.email, row.role);
  return ouvrirSession(env, request, row.email, row.role, { message: 'Votre mot de passe est enregistré.' });
}

export async function changer(request, env) {
  const s = await requireSession(request, env, null, { autoriserChangement: true });
  const data = await readJson(request);
  const c = await compte(env, s.email, s.role);
  if (!c || !(await verifierMotDePasse(String(data.actuel || '').slice(0, 128), c.mot_de_passe))) throw new HttpError(400, 'Le mot de passe actuel est incorrect.');
  validerMotDePasse(data.nouveau, s.email);
  if (data.nouveau === data.actuel) throw new HttpError(400, 'Choisissez un mot de passe différent de l’actuel.');
  await enregistrerMotDePasse(env, s.email, s.role, data.nouveau);
  await fermerSessions(env, s.email, s.role, s.hash);
  return json({ ok: true, message: 'Votre nouveau mot de passe est enregistré.' });
}

export async function deconnexion(request, env) {
  const token = getCookie(request, COOKIE);
  if (token && env.DB) await env.DB.prepare('DELETE FROM sessions WHERE hash = ?').bind(await sha256(token)).run();
  return json({ ok: true }, 200, { 'Set-Cookie': `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` });
}

/* ---------------------------------------------------------------- sessions */

export async function getSession(request, env) {
  const token = getCookie(request, COOKIE);
  if (!token || !env.DB) return null;
  const hash = await sha256(token);
  const s = await env.DB.prepare("SELECT email, role FROM sessions WHERE hash = ? AND expire_le > datetime('now')").bind(hash).first();
  return s ? { ...s, hash } : null;
}

// Vérifie la session, que le compte a toujours accès, et que le mot de passe provisoire a été changé
export async function requireSession(request, env, role, { autoriserChangement = false } = {}) {
  const s = await getSession(request, env);
  if (!s) throw new HttpError(401, 'Veuillez vous connecter.');
  if (role && s.role !== role) throw new HttpError(403, 'Accès réservé.');
  const c = await compte(env, s.email, s.role);
  if (!c) {
    await fermerSessions(env, s.email, s.role);
    throw new HttpError(401, 'Votre accès n’est plus actif. Contactez-nous.');
  }
  if (c.doit_changer_mdp && !autoriserChangement) throw new HttpError(403, 'Choisissez votre mot de passe personnel pour continuer.', 'mdp_a_changer');
  return s;
}
