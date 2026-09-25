// Sécurité : double authentification (TOTP), anti-robot Cloudflare Turnstile,
// journal d'administration et nettoyage automatique des données (RGPD)

import { HttpError, ipHash, sha256 } from './lib.js';

/* ---------------------------------------------------------------- TOTP (RFC 6238) */

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function secretTotp() {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  return bits.match(/.{5}/g).map((c) => B32[parseInt(c, 2)]).join('');
}

function base32(secret) {
  const bits = [...secret.replace(/=+$/, '').toUpperCase()].map((c) => B32.indexOf(c).toString(2).padStart(5, '0')).join('');
  return Uint8Array.from(bits.match(/.{8}/g) || [], (b) => parseInt(b, 2));
}

async function codeTotp(secret, pas) {
  const key = await crypto.subtle.importKey('raw', base32(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const msg = new ArrayBuffer(8);
  new DataView(msg).setUint32(4, pas);
  new DataView(msg).setUint32(0, Math.floor(pas / 2 ** 32));
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  const o = h[19] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1e6).padStart(6, '0');
}

// Renvoie le pas de temps du code s'il est valable (tolérance de ±30 secondes), sinon null
export async function verifierTotp(secret, code, dernierPas = null) {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c) || !secret) return null;
  const maintenant = Math.floor(Date.now() / 30000);
  for (const pas of [maintenant, maintenant - 1, maintenant + 1]) {
    if (dernierPas !== null && pas <= dernierPas) continue; // un code ne sert qu'une fois
    if (await codeTotp(secret, pas) === c) return pas;
  }
  return null;
}

export const uriTotp = (secret, email) => `otpauth://totp/${encodeURIComponent(`Renaissance iTech:${email}`)}?secret=${secret}&issuer=${encodeURIComponent('Renaissance iTech')}&algorithm=SHA1&digits=6&period=30`;

// 10 codes de secours à usage unique, ex. : 4K7Q-9MZT
export function codesSecours() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 10 }, () => {
    const c = [...crypto.getRandomValues(new Uint8Array(8))].map((n) => alphabet[n % alphabet.length]).join('');
    return `${c.slice(0, 4)}-${c.slice(4)}`;
  });
}
export const normaliserCodeSecours = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/* ---------------------------------------------------------------- Turnstile (anti-robot Cloudflare) */

// Actif seulement si la clé secrète TURNSTILE_SECRET est configurée dans Cloudflare
export async function verifierTurnstile(env, request, jeton) {
  if (!env.TURNSTILE_SECRET) return;
  if (!jeton) throw new HttpError(400, 'Merci de valider la vérification anti-robot.');
  let res;
  try {
    const form = new FormData();
    form.append('secret', env.TURNSTILE_SECRET);
    form.append('response', String(jeton).slice(0, 2048));
    const ip = request.headers.get('CF-Connecting-IP');
    if (ip) form.append('remoteip', ip);
    res = await (await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form })).json();
  } catch (e) {
    console.error('Turnstile', e);
    throw new HttpError(503, 'Vérification anti-robot indisponible. Réessayez dans un instant.');
  }
  if (!res.success) throw new HttpError(403, 'La vérification anti-robot a échoué. Rechargez la page et réessayez.');
}

/* ---------------------------------------------------------------- journal d'administration */

export async function journal(env, request, email, action, cible = null, details = null) {
  try {
    await env.DB.prepare('INSERT INTO journal_admin (email, action, cible, details, ip_hash) VALUES (?, ?, ?, ?, ?)')
      .bind(email, action, cible ? String(cible).slice(0, 200) : null, details ? String(details).slice(0, 500) : null, request ? await ipHash(request) : null).run();
  } catch (e) {
    console.error('journal', e);
  }
}

/* ---------------------------------------------------------------- nettoyage automatique (chaque nuit) */

// Durées de conservation, conformes aux mentions légales
export async function purger(env) {
  if (!env.DB) return;
  const db = env.DB;
  const trois = "datetime('now', '-3 years')";
  await db.batch([
    // Données techniques
    db.prepare("DELETE FROM sessions WHERE expire_le < datetime('now')"),
    db.prepare("DELETE FROM jetons_mdp WHERE expire_le < datetime('now', '-1 day')"),
    db.prepare("DELETE FROM defis_2fa WHERE expire_le < datetime('now')"),
    db.prepare("DELETE FROM tentatives_connexion WHERE cree_le < datetime('now', '-30 days')"),
    db.prepare("DELETE FROM assistant_messages WHERE cree_le < datetime('now', '-12 months')"),
    db.prepare("DELETE FROM journal_admin WHERE cree_le < datetime('now', '-12 months')"),
    // Demandes de contact et rendez-vous de plus de 3 ans (les projets gardent leur historique)
    db.prepare(`UPDATE projets SET contact_id = NULL WHERE contact_id IN (SELECT id FROM contacts WHERE cree_le < ${trois})`),
    db.prepare(`DELETE FROM contacts WHERE cree_le < ${trois}`),
    db.prepare(`UPDATE projets SET rdv_id = NULL WHERE rdv_id IN (SELECT id FROM rendez_vous WHERE cree_le < ${trois})`),
    db.prepare(`DELETE FROM rendez_vous WHERE cree_le < ${trois}`),
  ]);
  // Prospects sans accès premium et sans activité depuis 3 ans : suppression complète
  const inactifs = `SELECT c.id FROM clients c WHERE c.acces_premium = 0 AND c.cree_le < ${trois}
    AND NOT EXISTS (SELECT 1 FROM projets p WHERE p.client_id = c.id AND p.maj_le >= ${trois})`;
  await db.batch([
    db.prepare(`DELETE FROM messages WHERE projet_id IN (SELECT id FROM projets WHERE client_id IN (${inactifs}))`),
    db.prepare(`DELETE FROM projets WHERE client_id IN (${inactifs})`),
    db.prepare(`DELETE FROM clients WHERE id IN (${inactifs})`),
  ]);
}

export const empreinteCode = (c) => sha256(`secours:${normaliserCodeSecours(c)}`);
