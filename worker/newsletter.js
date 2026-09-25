// Newsletter (liste Brevo) : inscription et désinscription

import { HttpError, json, clean, readJson, EMAIL_RE, siteUrl } from './lib.js';

const brevo = (env, path, method, body) => fetch(`https://api.brevo.com/v3${path}`, {
  method,
  headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
  body: JSON.stringify(body),
});

function checkConfig(env) {
  if (!env.BREVO_API_KEY || !env.BREVO_LIST_ID) throw new HttpError(503, 'La newsletter ouvre très bientôt. Revenez dans quelques jours !');
}

export async function inscription(request, env) {
  const data = await readJson(request);
  if (data.website) return json({ ok: true, message: 'Merci !' });

  const email = clean(data.email, 254).toLowerCase();
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Merci d’indiquer un email valide.');
  if (data.consent !== true) throw new HttpError(400, 'Le consentement est obligatoire.');
  checkConfig(env);

  const listId = Number(env.BREVO_LIST_ID);
  const doi = env.BREVO_DOI_TEMPLATE_ID;
  const res = doi
    ? await brevo(env, '/contacts/doubleOptinConfirmation', 'POST', { email, includeListIds: [listId], templateId: Number(doi), redirectionUrl: `${siteUrl(env, request)}/newsletter-confirmee` })
    : await brevo(env, '/contacts', 'POST', { email, listIds: [listId], updateEnabled: true });

  if (res.ok || res.status === 204) {
    return json({ ok: true, message: doi ? 'Merci ! Un email de confirmation vient de vous être envoyé.' : 'Merci ! Votre inscription est confirmée.' });
  }
  const err = await res.json().catch(() => ({}));
  if (err.code === 'duplicate_parameter') return json({ ok: true, message: 'Vous êtes déjà inscrit(e). Merci !' });
  console.error('Brevo', res.status, JSON.stringify(err));
  throw new HttpError(502, 'Inscription impossible pour le moment. Réessayez plus tard.');
}

export async function desinscription(request, env) {
  const data = await readJson(request);
  const email = clean(data.email, 254).toLowerCase();
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Merci d’indiquer un email valide.');
  checkConfig(env);

  const res = await brevo(env, `/contacts/lists/${Number(env.BREVO_LIST_ID)}/contacts/remove`, 'POST', { emails: [email] });
  // Adresse inconnue ou déjà retirée : on répond pareil, sans révéler qui est inscrit
  if (!res.ok && res.status !== 400 && res.status !== 404) {
    console.error('Brevo désinscription', res.status, await res.text());
    throw new HttpError(502, 'Désinscription impossible pour le moment. Écrivez-nous à contact@renaissance-itech.com.');
  }
  return json({ ok: true, message: 'C’est fait : vous ne recevrez plus notre newsletter.' });
}
