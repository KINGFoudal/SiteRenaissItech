// Formulaire de contact et prise de rendez-vous

import { verifierTurnstile } from './securite.js';
import {
  HttpError, json, esc, clean, readJson, ipHash, rateLimit, requireDb, EMAIL_RE,
  parisNow, parisToUtc, validDate, frDate, emailLayout, emailButton, emailTable,
  sendEmail, toBase64, notifyEmail, siteUrl, upsertClient,
} from './lib.js';

export const SLOTS = ['09:00', '10:00', '11:00', '14:00', '15:00'];
const RDV_MINUTES = 30;
export const SERVICES = ['IA privée & souveraine', 'Automatisation IA', 'Formation IA des équipes', 'Cybersécurité', 'Conseil & stratégie', 'Création web & développement', 'SEO & référencement'];
const SUJETS = [...SERVICES, 'Demande sur un produit', 'Autre demande'];

function ics({ id, start, service, site }) {
  const fmt = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const end = new Date(start.getTime() + RDV_MINUTES * 60000);
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Renaissance iTech//Rendez-vous//FR', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:rdv-${id}@renaissance-itech.com`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:Rendez-vous Renaissance iTech : ${service}`,
    'DESCRIPTION:Visioconférence Google Meet. Le lien de la réunion vous est envoyé par email avant le rendez-vous.',
    `URL:${site}`,
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
}

export async function contact(request, env, ctx) {
  const data = await readJson(request);
  if (!data.website) await verifierTurnstile(env, request, data.turnstile);
  if (data.website) return json({ ok: true });

  const nom = clean(data.nom, 100);
  const email = clean(data.email, 254).toLowerCase();
  const sujet = clean(data.sujet, 60);
  const message = clean(data.message, 5000);
  if (nom.length < 2) throw new HttpError(400, 'Merci d’indiquer votre nom.');
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Merci d’indiquer un email valide.');
  if (!SUJETS.includes(sujet)) throw new HttpError(400, 'Merci de choisir un sujet.');
  if (message.length < 10) throw new HttpError(400, 'Votre message est un peu court (10 caractères minimum).');
  requireDb(env);

  const hash = await ipHash(request);
  await rateLimit(env, 'contacts', hash, 5);
  const { meta } = await env.DB.prepare('INSERT INTO contacts (nom, email, sujet, message, ip_hash) VALUES (?, ?, ?, ?, ?)')
    .bind(nom, email, sujet, message, hash).run();
  await upsertClient(env, { email, nom });

  const site = siteUrl(env, request);
  ctx.waitUntil(Promise.all([
    sendEmail(env, {
      to: notifyEmail(env), replyTo: email,
      subject: `Nouvelle demande : ${sujet} (${nom})`,
      html: emailLayout('Nouvelle demande de contact', `${emailTable([['Nom', nom], ['Email', email], ['Sujet', sujet], ['Message', message], ['Référence', `#${meta.last_row_id}`]])}${emailButton(`${site}/admin`, 'Ouvrir le tableau de bord')}`),
    }),
    sendEmail(env, {
      to: email,
      subject: 'Nous avons bien reçu votre message',
      html: emailLayout(`Merci ${esc(nom)} !`, `<p>Nous avons bien reçu votre message et vous répondons sous 24h ouvrées.</p>${emailTable([['Sujet', sujet], ['Message', message]])}<p>Besoin d’en parler de vive voix ? <a href="${esc(site)}/rendez-vous" style="color:#E55A0C">Réservez un appel</a>.</p>`),
    }),
  ]));

  return json({ ok: true, message: 'Merci ! Votre message a bien été envoyé. Nous vous répondons sous 24h ouvrées.', redirect: '/merci-contact' });
}

export async function creneaux(request, env) {
  const date = new URL(request.url).searchParams.get('date') || '';
  if (!validDate(date)) throw new HttpError(400, 'Date invalide.');
  if (!env.DB) return json({ date, pris: [] });
  const { results } = await env.DB.prepare("SELECT heure FROM rendez_vous WHERE date = ? AND statut = 'confirme'").bind(date).all();
  // Créneaux passés selon l'heure de Paris : toute la journée si la date est déjà passée à Paris
  // (visiteur dans un fuseau en retard, par exemple en Guinée, le soir)
  const now = parisNow();
  const passes = date < now.date ? SLOTS : date === now.date ? SLOTS.filter((s) => s <= now.time) : [];
  return json({ date, pris: [...new Set([...results.map((r) => r.heure), ...passes])] });
}

export async function rendezVous(request, env, ctx) {
  const data = await readJson(request);
  if (!data.website) await verifierTurnstile(env, request, data.turnstile);
  if (data.website) return json({ ok: true });

  const service = clean(data.service, 60);
  const date = clean(data.date, 10);
  const heure = clean(data.heure, 5);
  const nom = clean(data.nom, 100);
  const email = clean(data.email, 254).toLowerCase();
  const telephone = clean(data.telephone, 30);
  const message = clean(data.message, 2000);

  if (!SERVICES.includes(service)) throw new HttpError(400, 'Merci de choisir un service.');
  if (!validDate(date) || !SLOTS.includes(heure)) throw new HttpError(400, 'Merci de choisir une date et une heure.');
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  const now = parisNow();
  if (day === 0 || day === 6 || date < now.date || (date === now.date && heure <= now.time)) {
    throw new HttpError(400, 'Ce créneau n’est plus disponible. Merci d’en choisir un autre.');
  }
  if (nom.length < 2) throw new HttpError(400, 'Merci d’indiquer votre nom.');
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Merci d’indiquer un email valide.');
  requireDb(env);

  const hash = await ipHash(request);
  await rateLimit(env, 'rendez_vous', hash, 5);

  let id;
  try {
    const { meta } = await env.DB.prepare('INSERT INTO rendez_vous (service, date, heure, nom, email, telephone, message, ip_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(service, date, heure, nom, email, telephone || null, message || null, hash).run();
    id = meta.last_row_id;
  } catch (e) {
    if (/UNIQUE/i.test(String(e.message || e))) throw new HttpError(409, 'Ce créneau vient d’être réservé. Merci d’en choisir un autre.');
    throw e;
  }

  // Chaque rendez-vous ouvre un projet, visible aussitôt dans l'administration (et dans l'espace client si le client est premium)
  const client = await upsertClient(env, { email, nom, telephone });
  const { meta: pMeta } = await env.DB.prepare("INSERT INTO projets (client_id, titre, service, statut, origine, rdv_id) VALUES (?, ?, ?, 'nouveau', 'rendez_vous', ?)")
    .bind(client.id, service, service, id).run();
  if (message) {
    await env.DB.prepare("INSERT INTO messages (projet_id, auteur, contenu) VALUES (?, 'client', ?)").bind(pMeta.last_row_id, message).run();
  }

  const site = siteUrl(env, request);
  const quand = `${frDate(date)} à ${heure} (heure de Paris)`;
  const invitation = { name: 'rendez-vous-renaissance-itech.ics', content: toBase64(ics({ id, start: parisToUtc(date, heure), service, site })) };

  ctx.waitUntil(Promise.all([
    sendEmail(env, {
      to: notifyEmail(env), replyTo: email,
      subject: `Nouveau rendez-vous : ${frDate(date)} ${heure} (${nom})`,
      html: emailLayout('Nouveau rendez-vous', `${emailTable([['Service', service], ['Date', quand], ['Nom', nom], ['Email', email], ['Téléphone', telephone], ['Besoin', message], ['Référence', `#${id}`]])}<p><strong>À faire :</strong> créer la réunion Google Meet et envoyer le lien au client.</p>${emailButton(`${site}/admin`, 'Ouvrir le tableau de bord')}`),
      attachment: invitation,
    }),
    sendEmail(env, {
      to: email,
      subject: `Votre rendez-vous du ${frDate(date)} à ${heure} est confirmé`,
      html: emailLayout('Rendez-vous confirmé', `<p>Bonjour ${esc(nom)},</p><p>Votre rendez-vous avec Renaissance iTech est bien enregistré.</p>${emailTable([['Service', service], ['Date', quand], ['Durée', `${RDV_MINUTES} minutes`], ['Lieu', 'Visioconférence Google Meet']])}<p>Vous recevrez le lien de la réunion par email avant le rendez-vous. L’invitation jointe l’ajoute à votre agenda.</p>${client.acces_premium ? `<p>Ce rendez-vous est ajouté à votre espace client, où vous pouvez suivre vos projets et échanger avec notre équipe.</p>${emailButton(`${site}/espace-client`, 'Accéder à mon espace client')}` : ''}<p>Un empêchement ? Répondez simplement à cet email.</p>`),
      attachment: invitation,
    }),
  ]));

  const q = new URLSearchParams({ service, date, heure });
  return json({
    ok: true, id,
    message: env.BREVO_API_KEY ? 'Rendez-vous confirmé. Un email de confirmation vient de vous être envoyé.' : 'Rendez-vous confirmé. Nous vous recontactons très vite par email.',
    redirect: `/rendez-vous-confirme?${q}`,
  });
}
