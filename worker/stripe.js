// Paiements Stripe : sessions Checkout (page de paiement hébergée par Stripe) et webhooks signés.
// Aucune donnée de carte ne transite par le site : Stripe gère la saisie, 3D Secure, Apple Pay et Google Pay.
//
// Secrets Cloudflare : STRIPE_SECRET_KEY, de préférence une clé restreinte (rk_test_… puis rk_live_…) limitée à
// « Checkout Sessions : écriture » ; STRIPE_WEBHOOK_SECRET (whsec_…)
// STRIPE_API (facultatif) : autre adresse de l'API, pour les tests automatisés uniquement.

import { HttpError } from './lib.js';

export const paiementActif = (env) => Boolean(env.STRIPE_SECRET_KEY);

// Aplatit un objet au format attendu par l'API Stripe : line_items[0][price_data][currency]=eur
function formEncode(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') formEncode(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

async function stripe(env, method, path, params) {
  if (!paiementActif(env)) throw new HttpError(503, 'Le paiement en ligne n’est pas encore activé. Contactez-nous pour régler par virement.');
  const res = await fetch(`${env.STRIPE_API || 'https://api.stripe.com'}/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Version': '2026-08-26.dahlia',
    },
    body: params ? formEncode(params) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('Stripe', path, res.status, data?.error?.message);
    throw new HttpError(502, 'Le service de paiement ne répond pas. Réessayez dans un instant.');
  }
  return data;
}

/**
 * Ouvre une page de paiement Stripe et renvoie son adresse.
 * lignes : [{ nom, quantite, montant_unitaire_ttc (centimes) }]
 */
export function creerSessionPaiement(env, { lignes, email, reference, succes, annulation, metadata, parcours }) {
  return stripe(env, 'POST', 'checkout/sessions', {
    mode: 'payment',
    // Étiquette visible dans le tableau de bord Stripe pour comparer les parcours (factures / boutique)
    integration_identifier: parcours,
    locale: 'fr',
    client_reference_id: reference,
    customer_email: email || undefined,
    success_url: succes,
    cancel_url: annulation,
    billing_address_collection: 'auto',
    metadata,
    payment_intent_data: { metadata, description: reference },
    expires_at: Math.floor(Date.now() / 1000) + 60 * 60 * 24, // lien valable 24 h
    line_items: Object.fromEntries(lignes.map((l, i) => [i, {
      quantity: l.quantite,
      price_data: { currency: 'eur', unit_amount: l.montant_unitaire_ttc, product_data: { name: l.nom.slice(0, 250) } },
    }])),
  });
}

export const lireSession = (env, id) => stripe(env, 'GET', `checkout/sessions/${encodeURIComponent(id)}`);

// Vérifie la signature d'un webhook Stripe (en-tête Stripe-Signature, tolérance 5 minutes)
export async function verifierWebhook(env, request) {
  const payload = await request.text();
  if (!env.STRIPE_WEBHOOK_SECRET) throw new HttpError(503, 'Webhook non configuré.');
  const header = request.headers.get('Stripe-Signature') || '';
  let t = null; const v1 = [];
  for (const p of header.split(',')) {
    const [k, v] = p.split('=');
    if (k === 't') t = v;
    if (k === 'v1' && v) v1.push(v);
  }
  if (!t || !v1.length || Math.abs(Date.now() / 1000 - Number(t)) > 300) throw new HttpError(400, 'Signature invalide.');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${payload}`)));
  const attendu = [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
  const egal = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
  if (!v1.some((s) => egal(s, attendu))) throw new HttpError(400, 'Signature invalide.');
  try { return JSON.parse(payload); } catch { throw new HttpError(400, 'Requête invalide.'); }
}
