/*
 * Worker Cloudflare du site Renaissance iTech.
 *
 * - POST /api/newsletter : inscription à la newsletter (via Brevo)
 * - tout le reste        : fichiers statiques du site (binding ASSETS)
 *
 * Secrets / variables (Cloudflare → Worker → Paramètres → Variables) :
 *   BREVO_API_KEY            (secret)  clé API Brevo
 *   BREVO_LIST_ID                      identifiant de la liste « Newsletter »
 *   BREVO_DOI_TEMPLATE_ID    (option)  modèle d'email de double opt-in (recommandé)
 *   SITE_URL                 (option)  ex. https://www.renaissance-itech.com
 */

const EMAIL_RE = /^[^@\s]{1,64}@[^@\s]{1,255}\.[^@\s]{2,}$/;

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

async function newsletter(request, env) {
  if (request.method !== 'POST') return json({ error: 'Méthode non autorisée.' }, 405);

  // Refuse les envois venant d'un autre site
  const origin = request.headers.get('Origin');
  if (origin && new URL(origin).host !== new URL(request.url).host) return json({ error: 'Origine non autorisée.' }, 403);

  let data;
  try { data = await request.json(); } catch { return json({ error: 'Requête invalide.' }, 400); }

  // Champ piège anti-robots : un humain le laisse vide
  if (data.website) return json({ ok: true, message: 'Merci !' });

  const email = String(data.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return json({ error: 'Merci d’indiquer un email valide.' }, 400);
  if (data.consent !== true) return json({ error: 'Le consentement est obligatoire.' }, 400);

  if (!env.BREVO_API_KEY || !env.BREVO_LIST_ID) {
    return json({ error: 'La newsletter ouvre très bientôt. Revenez dans quelques jours !' }, 503);
  }

  const listId = Number(env.BREVO_LIST_ID);
  const site = env.SITE_URL || new URL(request.url).origin;

  // Double opt-in (recommandé) : Brevo envoie un email de confirmation
  const doi = env.BREVO_DOI_TEMPLATE_ID;
  const url = doi ? 'https://api.brevo.com/v3/contacts/doubleOptinConfirmation' : 'https://api.brevo.com/v3/contacts';
  const payload = doi
    ? { email, includeListIds: [listId], templateId: Number(doi), redirectionUrl: `${site}/blog.html?newsletter=confirmee` }
    : { email, listIds: [listId], updateEnabled: true };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });

  if (res.ok || res.status === 204) {
    return json({
      ok: true,
      message: doi
        ? 'Merci ! Un email de confirmation vient de vous être envoyé.'
        : 'Merci ! Votre inscription est confirmée.',
    });
  }

  const err = await res.json().catch(() => ({}));
  if (err.code === 'duplicate_parameter') return json({ ok: true, message: 'Vous êtes déjà inscrit(e). Merci !' });
  console.error('Brevo', res.status, JSON.stringify(err));
  return json({ error: 'Inscription impossible pour le moment. Réessayez plus tard.' }, 502);
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/newsletter') return newsletter(request, env);
    if (pathname.startsWith('/api/')) return json({ error: 'Introuvable.' }, 404);
    return env.ASSETS.fetch(request);
  },
};
