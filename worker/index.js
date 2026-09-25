/*
 * Worker Cloudflare du site Renaissance iTech : fichiers statiques + API.
 *
 * Formulaires      POST /api/contact, GET /api/creneaux, POST /api/rendez-vous
 * Newsletter       POST /api/newsletter, POST /api/newsletter/desinscription
 * Connexion        POST /api/auth/lien, POST /api/auth/verifier, POST /api/auth/deconnexion
 * Espace client    GET /api/client/moi, POST /api/client/message, POST /api/client/profil
 * Administration   /api/admin/…
 * Assistant IA     POST /api/assistant
 *
 * Liaisons et variables (wrangler.jsonc) :
 *   DB (D1), AI (Workers AI), BREVO_API_KEY (secret), BREVO_LIST_ID, BREVO_DOI_TEMPLATE_ID,
 *   NOTIFY_EMAIL, SENDER_EMAIL, ADMIN_EMAILS, SITE_URL
 */

import { HttpError, json } from './lib.js';
import { contact, creneaux, rendezVous } from './formulaires.js';
import { inscription, desinscription } from './newsletter.js';
import { demanderLien, verifierLien, deconnexion } from './auth.js';
import * as espaces from './espaces.js';
import { assistant } from './assistant.js';

const ROUTES = {
  'POST /api/contact': contact,
  'GET /api/creneaux': creneaux,
  'POST /api/rendez-vous': rendezVous,
  'POST /api/newsletter': inscription,
  'POST /api/newsletter/desinscription': desinscription,
  'POST /api/auth/lien': demanderLien,
  'POST /api/auth/verifier': verifierLien,
  'POST /api/auth/deconnexion': deconnexion,
  'GET /api/client/moi': espaces.clientMoi,
  'POST /api/client/message': espaces.clientMessage,
  'POST /api/client/profil': espaces.clientProfil,
  'GET /api/admin/resume': espaces.adminResume,
  'GET /api/admin/rendez-vous': espaces.adminRendezVous,
  'POST /api/admin/rendez-vous/statut': espaces.adminRendezVousStatut,
  'GET /api/admin/projets': espaces.adminProjets,
  'GET /api/admin/projet': espaces.adminProjet,
  'POST /api/admin/projet/maj': espaces.adminProjetMaj,
  'POST /api/admin/projet/creer': espaces.adminProjetCreer,
  'POST /api/admin/message': espaces.adminMessage,
  'GET /api/admin/demandes': espaces.adminDemandes,
  'POST /api/admin/demande/traiter': espaces.adminDemandeTraiter,
  'GET /api/admin/clients': espaces.adminClients,
  'GET /api/admin/assistant': espaces.adminAssistant,
  'POST /api/assistant': assistant,
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
