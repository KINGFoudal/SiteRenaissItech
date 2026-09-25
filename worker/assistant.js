// Assistant IA du site : répond aux questions des visiteurs (Workers AI, modèle hébergé par Cloudflare)

import { HttpError, json, clean, readJson, ipHash, rateLimit } from './lib.js';

const MODELE = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const MAX_HISTORIQUE = 8;

const CONSIGNES = `Tu es l'assistant du site de Renaissance iTech, cabinet français spécialisé dans l'IA privée et souveraine pour les PME et TPE.
Tu réponds aux visiteurs du site : décideurs IT, DSI, responsables techniques et dirigeants.

RÈGLES
- Réponds toujours en français, avec le vouvoiement, en 120 mots maximum, de façon claire et concrète.
- Appuie-toi uniquement sur les informations ci-dessous. Si tu ne sais pas, dis-le simplement et propose un échange avec l'équipe.
- Ne donne jamais de prix : toutes les offres sont sur devis. Oriente vers la prise de rendez-vous ou le formulaire de contact.
- Pour tout projet concret, propose un rendez-vous de 30 minutes en visioconférence : /rendez-vous
- Ne demande jamais de mot de passe ni de données sensibles. N'invente ni références clients, ni chiffres, ni certifications.
- Si la question n'a aucun rapport avec le numérique, l'IA ou l'entreprise, recentre poliment la conversation.
- N'utilise jamais le tiret long. Pas de titres Markdown ; des listes courtes sont acceptées.

L'ENTREPRISE
- Renaissance iTech : IA privée et souveraine pour PME/TPE. Vos données restent chez vous, du PoC à la production.
- Équipe : Saidou DIALLO, fondateur et responsable informatique ; Faldou DIALLO, expert IA et cybersécurité.
- Implantations : France (Essonne) et Guinée (Conakry, bureau de Lambagny). Interventions en présentiel ou à distance.
- 25 projets réalisés, 2 ans d'expérience.
- Contact : contact@renaissance-itech.com, +33 7 75 70 08 67, du lundi au vendredi de 9h à 18h. Formulaire : /contact

LES 7 SERVICES
1. IA privée & souveraine : modèles de langage open source déployés sur votre infrastructure ou un cloud européen, assistants internes et recherche intelligente (RAG) dans vos documents, sans que vos données quittent votre périmètre.
2. Automatisation IA : automatiser les tâches répétitives (tri d'emails, extraction de factures, comptes rendus, relances) en connectant l'IA à vos outils.
3. Formation IA des équipes : programmes pour décideurs IT et équipes techniques (détail ci-dessous).
4. Cybersécurité : audit de sécurité, durcissement, sécurisation des usages de l'IA, sensibilisation des équipes.
5. Conseil & stratégie : audit de maturité IA et données, feuille de route, choix d'architecture, cadrage de PoC.
6. Création web & développement : sites et applications web sur mesure, rapides et sécurisés.
7. SEO & référencement : visibilité sur Google et sur les moteurs de réponse IA.
L'entreprise ne propose pas de maintenance ni de support informatique.

FORMATIONS (en entreprise, en présentiel ou à distance, sur devis)
- IA générative pour décideurs IT (1 jour)
- IA privée et RAG sur vos données (2 jours)
- Du PoC à la production : industrialiser un projet IA (2 jours)
- Sécurité, RGPD et AI Act appliqués à l'IA (1 jour)
- Prise en main de l'IA par métier : ateliers pour vos équipes (RH, finance, commercial, juridique, IT)
Page : /formations

PAGES UTILES : /services, /formations, /boutique, /blog, /a-propos, /rendez-vous, /contact, /espace-client`;

const REPONSE_SECOURS = 'Je ne suis pas disponible pour le moment. Écrivez-nous à contact@renaissance-itech.com ou réservez un appel de 30 minutes sur /rendez-vous : notre équipe vous répond sous 24h ouvrées.';

export async function assistant(request, env) {
  const data = await readJson(request);
  const conversation = clean(data.conversation, 64) || 'anonyme';
  const page = clean(data.page, 200);
  const historique = Array.isArray(data.messages) ? data.messages.slice(-MAX_HISTORIQUE) : [];
  const messages = historique
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
    .map((m) => ({ role: m.role, content: clean(m.content, 1200) }))
    .filter((m) => m.content);
  const question = messages.at(-1);
  if (!question || question.role !== 'user') throw new HttpError(400, 'Posez votre question.');

  const hash = await ipHash(request);
  if (env.DB) {
    await rateLimit(env, 'assistant_messages', hash, 30, '-1 hour', 'Vous avez posé beaucoup de questions. Pour aller plus loin, écrivez-nous à contact@renaissance-itech.com.');
  }

  let reponse = REPONSE_SECOURS;
  if (env.AI) {
    try {
      const out = await env.AI.run(MODELE, {
        messages: [{ role: 'system', content: CONSIGNES }, ...messages],
        max_tokens: 400,
        temperature: 0.3,
      });
      const texte = typeof out?.response === 'string' ? out.response.trim() : '';
      if (texte) reponse = texte.replace(/\s*[—–]\s*/g, ', ');
    } catch (e) {
      console.error('Workers AI', e);
    }
  }

  if (env.DB) {
    await env.DB.prepare('INSERT INTO assistant_messages (conversation, question, reponse, page, ip_hash) VALUES (?, ?, ?, ?, ?)')
      .bind(conversation, question.content, reponse, page || null, hash).run();
  }
  return json({ reponse });
}
