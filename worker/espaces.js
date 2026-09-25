// Espace client et administration

import {
  HttpError, json, clean, readJson, EMAIL_RE, esc, emailLayout, emailButton, emailTable,
  sendEmail, notifyEmail, siteUrl, upsertClient,
} from './lib.js';
import { requireSession, motDePasseProvisoire, hacherMotDePasse, fermerSessions } from './auth.js';
import { SERVICES } from './formulaires.js';

const STATUTS_PROJET = ['nouveau', 'en_cours', 'en_pause', 'termine', 'annule'];
const STATUTS_RDV = ['confirme', 'annule', 'termine'];
const int = (v) => Number.parseInt(v, 10);

async function messagesDuProjet(env, projetId) {
  const { results } = await env.DB.prepare('SELECT id, auteur, contenu, cree_le FROM messages WHERE projet_id = ? ORDER BY id').bind(projetId).all();
  return results;
}

/* ================================================================ Client */

export async function clientMoi(request, env) {
  const s = await requireSession(request, env, 'client');
  const client = await env.DB.prepare('SELECT id, email, nom, telephone, entreprise, cree_le FROM clients WHERE email = ?').bind(s.email).first();
  if (!client) throw new HttpError(401, 'Veuillez vous connecter.');

  const [{ results: projets }, { results: rdv }, nonLus] = await Promise.all([
    env.DB.prepare('SELECT id, titre, service, statut, avancement, origine, cree_le, maj_le FROM projets WHERE client_id = ? ORDER BY maj_le DESC').bind(client.id).all(),
    env.DB.prepare('SELECT id, service, date, heure, statut FROM rendez_vous WHERE email = ? ORDER BY date DESC, heure DESC').bind(s.email).all(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM messages m JOIN projets p ON p.id = m.projet_id WHERE p.client_id = ? AND m.auteur = 'equipe' AND m.lu = 0").bind(client.id).first(),
  ]);
  for (const p of projets) p.messages = await messagesDuProjet(env, p.id);
  // Les messages de l'équipe sont marqués comme lus à l'ouverture de l'espace
  await env.DB.prepare("UPDATE messages SET lu = 1 WHERE auteur = 'equipe' AND projet_id IN (SELECT id FROM projets WHERE client_id = ?)").bind(client.id).run();

  return json({ client, projets, rendez_vous: rdv, non_lus: nonLus?.n || 0 });
}

export async function clientMessage(request, env, ctx) {
  const s = await requireSession(request, env, 'client');
  const data = await readJson(request);
  const contenu = clean(data.contenu, 3000);
  if (contenu.length < 2) throw new HttpError(400, 'Votre message est vide.');
  const projet = await env.DB.prepare('SELECT p.id, p.titre, c.nom FROM projets p JOIN clients c ON c.id = p.client_id WHERE p.id = ? AND c.email = ?').bind(int(data.projet_id), s.email).first();
  if (!projet) throw new HttpError(404, 'Projet introuvable.');

  await env.DB.batch([
    env.DB.prepare("INSERT INTO messages (projet_id, auteur, contenu) VALUES (?, 'client', ?)").bind(projet.id, contenu),
    env.DB.prepare("UPDATE projets SET maj_le = datetime('now') WHERE id = ?").bind(projet.id),
  ]);
  ctx.waitUntil(sendEmail(env, {
    to: notifyEmail(env), replyTo: s.email,
    subject: `Nouveau message client : ${projet.titre}`,
    html: emailLayout('Nouveau message d’un client', `${emailTable([['Client', projet.nom || s.email], ['Projet', projet.titre], ['Message', contenu]])}${emailButton(`${siteUrl(env, request)}/admin#projets`, 'Répondre depuis le tableau de bord')}`),
  }));
  return json({ ok: true });
}

export async function clientProfil(request, env) {
  const s = await requireSession(request, env, 'client');
  const data = await readJson(request);
  await env.DB.prepare('UPDATE clients SET nom = ?, telephone = ?, entreprise = ? WHERE email = ?')
    .bind(clean(data.nom, 100) || null, clean(data.telephone, 30) || null, clean(data.entreprise, 120) || null, s.email).run();
  return json({ ok: true, message: 'Vos informations sont enregistrées.' });
}

/* ================================================================ Administration */

export async function adminResume(request, env) {
  const session = await requireSession(request, env, 'admin');
  const one = (sql) => env.DB.prepare(sql).first();
  const all = (sql) => env.DB.prepare(sql).all().then((r) => r.results);
  const [rdvAVenir, demandes, projetsActifs, clients, questions] = await Promise.all([
    one("SELECT COUNT(*) AS n FROM rendez_vous WHERE statut = 'confirme' AND date >= date('now')"),
    one('SELECT COUNT(*) AS n FROM contacts WHERE traite = 0'),
    one("SELECT COUNT(*) AS n FROM projets WHERE statut IN ('nouveau', 'en_cours', 'en_pause')"),
    one('SELECT COUNT(*) AS n FROM clients WHERE acces_premium = 1'),
    one("SELECT COUNT(*) AS n FROM assistant_messages WHERE cree_le > datetime('now', '-7 days')"),
  ]);
  const [prochains, dernieresDemandes, derniersMessages] = await Promise.all([
    all("SELECT id, service, date, heure, nom, email FROM rendez_vous WHERE statut = 'confirme' AND date >= date('now') ORDER BY date, heure LIMIT 6"),
    all('SELECT id, nom, email, sujet, cree_le FROM contacts WHERE traite = 0 ORDER BY id DESC LIMIT 6'),
    all("SELECT m.id, m.contenu, m.cree_le, p.id AS projet_id, p.titre, c.nom, c.email FROM messages m JOIN projets p ON p.id = m.projet_id JOIN clients c ON c.id = p.client_id WHERE m.auteur = 'client' ORDER BY m.id DESC LIMIT 6"),
  ]);
  return json({
    moi: session.email,
    kpis: { rdv_a_venir: rdvAVenir.n, demandes_a_traiter: demandes.n, projets_actifs: projetsActifs.n, clients: clients.n, questions_assistant_7j: questions.n },
    prochains_rdv: prochains, demandes: dernieresDemandes, messages: derniersMessages,
  });
}

export async function adminRendezVous(request, env) {
  await requireSession(request, env, 'admin');
  const { results } = await env.DB.prepare('SELECT r.*, p.id AS projet_id FROM rendez_vous r LEFT JOIN projets p ON p.rdv_id = r.id ORDER BY r.date DESC, r.heure DESC LIMIT 200').all();
  return json({ rendez_vous: results });
}

export async function adminRendezVousStatut(request, env) {
  await requireSession(request, env, 'admin');
  const data = await readJson(request);
  if (!STATUTS_RDV.includes(data.statut)) throw new HttpError(400, 'Statut invalide.');
  await env.DB.prepare('UPDATE rendez_vous SET statut = ? WHERE id = ?').bind(data.statut, int(data.id)).run();
  return json({ ok: true });
}

export async function adminProjets(request, env) {
  await requireSession(request, env, 'admin');
  const { results } = await env.DB.prepare(`SELECT p.*, c.nom, c.email, c.entreprise,
      (SELECT COUNT(*) FROM messages m WHERE m.projet_id = p.id) AS nb_messages
    FROM projets p JOIN clients c ON c.id = p.client_id ORDER BY p.maj_le DESC LIMIT 200`).all();
  return json({ projets: results });
}

export async function adminProjet(request, env) {
  await requireSession(request, env, 'admin');
  const id = int(new URL(request.url).searchParams.get('id'));
  const projet = await env.DB.prepare('SELECT p.*, c.nom, c.email, c.telephone, c.entreprise FROM projets p JOIN clients c ON c.id = p.client_id WHERE p.id = ?').bind(id).first();
  if (!projet) throw new HttpError(404, 'Projet introuvable.');
  projet.messages = await messagesDuProjet(env, id);
  await env.DB.prepare("UPDATE messages SET lu = 1 WHERE projet_id = ? AND auteur = 'client'").bind(id).run();
  return json({ projet });
}

export async function adminProjetMaj(request, env) {
  await requireSession(request, env, 'admin');
  const data = await readJson(request);
  const statut = STATUTS_PROJET.includes(data.statut) ? data.statut : null;
  const avancement = Math.max(0, Math.min(100, int(data.avancement) || 0));
  const titre = clean(data.titre, 120);
  if (!statut) throw new HttpError(400, 'Statut invalide.');
  await env.DB.prepare("UPDATE projets SET statut = ?, avancement = ?, titre = COALESCE(NULLIF(?, ''), titre), maj_le = datetime('now') WHERE id = ?")
    .bind(statut, avancement, titre, int(data.id)).run();
  return json({ ok: true });
}

export async function adminProjetCreer(request, env) {
  await requireSession(request, env, 'admin');
  const data = await readJson(request);
  const email = clean(data.email, 254).toLowerCase();
  const titre = clean(data.titre, 120);
  const service = SERVICES.includes(data.service) ? data.service : null;
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Email du client invalide.');
  if (titre.length < 2) throw new HttpError(400, 'Donnez un titre au projet.');
  const client = await upsertClient(env, { email, nom: clean(data.nom, 100) });
  const contactId = int(data.contact_id) || null;
  const { meta } = await env.DB.prepare("INSERT INTO projets (client_id, titre, service, statut, origine, contact_id) VALUES (?, ?, ?, 'nouveau', ?, ?)")
    .bind(client.id, titre, service, contactId ? 'contact' : 'admin', contactId).run();
  if (contactId) await env.DB.prepare('UPDATE contacts SET traite = 1 WHERE id = ?').bind(contactId).run();
  return json({ ok: true, id: meta.last_row_id });
}

export async function adminMessage(request, env, ctx) {
  await requireSession(request, env, 'admin');
  const data = await readJson(request);
  const contenu = clean(data.contenu, 3000);
  if (contenu.length < 2) throw new HttpError(400, 'Votre message est vide.');
  const projet = await env.DB.prepare('SELECT p.id, p.titre, c.email, c.nom, c.acces_premium FROM projets p JOIN clients c ON c.id = p.client_id WHERE p.id = ?').bind(int(data.projet_id)).first();
  if (!projet) throw new HttpError(404, 'Projet introuvable.');
  await env.DB.batch([
    env.DB.prepare("INSERT INTO messages (projet_id, auteur, contenu) VALUES (?, 'equipe', ?)").bind(projet.id, contenu),
    env.DB.prepare("UPDATE projets SET maj_le = datetime('now') WHERE id = ?").bind(projet.id),
  ]);
  if (data.notifier !== false) {
    ctx.waitUntil(sendEmail(env, {
      to: projet.email,
      subject: `Nouveau message sur votre projet : ${projet.titre}`,
      html: emailLayout(`Bonjour ${esc(projet.nom || '')}`.trim(), `<p>Notre équipe vous a écrit au sujet de votre projet <strong>${esc(projet.titre)}</strong> :</p><blockquote style="margin:16px 0;padding:12px 16px;border-left:3px solid #FF6B1A;background:#FFF1E8">${esc(contenu).replace(/\n/g, '<br>')}</blockquote>${projet.acces_premium ? emailButton(`${siteUrl(env, request)}/espace-client`, 'Répondre depuis mon espace client') : '<p>Répondez simplement à cet email pour nous écrire.</p>'}`),
      replyTo: notifyEmail(env),
    }));
  }
  return json({ ok: true });
}

export async function adminDemandes(request, env) {
  await requireSession(request, env, 'admin');
  const { results } = await env.DB.prepare('SELECT id, nom, email, sujet, message, traite, cree_le FROM contacts ORDER BY id DESC LIMIT 200').all();
  return json({ demandes: results });
}

export async function adminDemandeTraiter(request, env) {
  await requireSession(request, env, 'admin');
  const data = await readJson(request);
  await env.DB.prepare('UPDATE contacts SET traite = ? WHERE id = ?').bind(data.traite ? 1 : 0, int(data.id)).run();
  return json({ ok: true });
}

export async function adminClients(request, env) {
  await requireSession(request, env, 'admin');
  const { results } = await env.DB.prepare(`SELECT c.id, c.email, c.nom, c.telephone, c.entreprise, c.cree_le, c.derniere_connexion,
      c.acces_premium, c.doit_changer_mdp, c.acces_cree_le, c.mdp_maj_le,
      (SELECT COUNT(*) FROM projets p WHERE p.client_id = c.id) AS nb_projets,
      (SELECT COUNT(*) FROM rendez_vous r WHERE r.email = c.email) AS nb_rdv
    FROM clients c ORDER BY c.acces_premium DESC, c.id DESC LIMIT 300`).all();
  return json({ clients: results });
}

export async function adminAssistant(request, env) {
  await requireSession(request, env, 'admin');
  const { results } = await env.DB.prepare('SELECT id, conversation, question, reponse, page, cree_le FROM assistant_messages ORDER BY id DESC LIMIT 200').all();
  return json({ messages: results });
}

/* ---------------------------------------------------------------- Accès premium à l'espace client */

// Donne l'accès : mot de passe provisoire à transmettre au client (affiché une seule fois)
async function donnerAcces(env, email) {
  const provisoire = motDePasseProvisoire();
  await env.DB.prepare(`UPDATE clients SET acces_premium = 1, mot_de_passe = ?, doit_changer_mdp = 1, mdp_maj_le = datetime('now'),
      acces_cree_le = COALESCE(acces_cree_le, datetime('now')) WHERE email = ?`).bind(await hacherMotDePasse(provisoire), email).run();
  await fermerSessions(env, email, 'client');
  return provisoire;
}

export async function adminClientCreer(request, env, ctx) {
  await requireSession(request, env, 'admin');
  const data = await readJson(request);
  const email = clean(data.email, 254).toLowerCase();
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Email du client invalide.');
  const existant = await env.DB.prepare('SELECT acces_premium FROM clients WHERE email = ?').bind(email).first();
  if (existant?.acces_premium) throw new HttpError(409, 'Ce client a déjà un accès. Utilisez « Nouveau mot de passe provisoire » dans la liste.');
  await upsertClient(env, { email, nom: clean(data.nom, 100), telephone: clean(data.telephone, 30) });
  if (clean(data.entreprise, 120)) await env.DB.prepare('UPDATE clients SET entreprise = COALESCE(entreprise, ?) WHERE email = ?').bind(clean(data.entreprise, 120), email).run();
  const provisoire = await donnerAcces(env, email);
  if (data.email_bienvenue !== false) {
    const nom = clean(data.nom, 100);
    ctx.waitUntil(sendEmail(env, {
      to: email, replyTo: notifyEmail(env),
      subject: 'Votre espace client Renaissance iTech est ouvert',
      html: emailLayout(`Bienvenue${nom ? ` ${esc(nom)}` : ''}`, `<p>Votre accès à l’espace client Renaissance iTech est prêt. Vous pourrez y suivre vos projets, vos rendez-vous et échanger avec notre équipe.</p><p><strong>Identifiant :</strong> ${esc(email)}<br><strong>Mot de passe :</strong> le mot de passe provisoire que notre équipe vous transmet séparément. Vous choisirez votre propre mot de passe à la première connexion.</p>${emailButton(`${siteUrl(env, request)}/espace-client`, 'Accéder à mon espace client')}`),
    }));
  }
  return json({ ok: true, email, mot_de_passe_provisoire: provisoire });
}

export async function adminClientAcces(request, env) {
  await requireSession(request, env, 'admin');
  const data = await readJson(request);
  const client = await env.DB.prepare('SELECT id, email, acces_premium FROM clients WHERE id = ?').bind(int(data.id)).first();
  if (!client) throw new HttpError(404, 'Client introuvable.');
  if (data.action === 'desactiver') {
    await env.DB.prepare('UPDATE clients SET acces_premium = 0 WHERE id = ?').bind(client.id).run();
    await fermerSessions(env, client.email, 'client');
    return json({ ok: true, message: 'Accès désactivé : le client est déconnecté et ne peut plus se connecter.' });
  }
  if (data.action === 'provisoire') {
    const provisoire = await donnerAcces(env, client.email);
    return json({ ok: true, email: client.email, mot_de_passe_provisoire: provisoire });
  }
  throw new HttpError(400, 'Action inconnue.');
}
