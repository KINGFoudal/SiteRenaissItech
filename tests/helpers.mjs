// Outils communs aux tests : un vrai Worker local (wrangler dev), une base D1 locale neuve et un faux Stripe.
// Aucun service externe n'est appelé : pas d'email (Brevo absent), pas de vrai paiement.

import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';

const RACINE = new URL('..', import.meta.url).pathname;
const WRANGLER = join(RACINE, 'node_modules', '.bin', 'wrangler');
export const JETON_ADMIN = 'jeton-admin-de-test';
const WEBHOOK_SECRET = 'whsec_test';

// Faux Stripe : crée des sessions de paiement et les renvoie à la lecture
function fauxStripe(port) {
  const sessions = new Map();
  const requetes = [];
  const serveur = http.createServer((req, res) => {
    let corps = '';
    req.on('data', (c) => { corps += c; });
    req.on('end', () => {
      requetes.push({ methode: req.method, url: req.url, corps: new URLSearchParams(corps) });
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'POST' && req.url === '/v1/checkout/sessions') {
        const id = `cs_test_${sessions.size + 1}`;
        const s = { id, url: `https://checkout.stripe.test/${id}`, status: 'open', payment_status: 'unpaid' };
        sessions.set(id, s);
        return res.end(JSON.stringify(s));
      }
      const m = req.url.match(/^\/v1\/checkout\/sessions\/(.+)$/);
      if (m && sessions.has(m[1])) return res.end(JSON.stringify(sessions.get(m[1])));
      res.statusCode = 404;
      res.end('{"error":{"message":"introuvable"}}');
    });
  });
  return new Promise((ok) => serveur.listen(port, '127.0.0.1', () => ok({ serveur, requetes })));
}

export async function demarrer(port) {
  const dossier = mkdtempSync(join(tmpdir(), 'rit-test-'));
  // Configuration de test : identique à la production, sans l'IA (service distant)
  const config = join(RACINE, `.wrangler-test-${port}.jsonc`);
  writeFileSync(config, readFileSync(join(RACINE, 'wrangler.jsonc'), 'utf8').split('\n').filter((l) => !/"ai":/.test(l)).join('\n'));
  const env = { ...process.env, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost', WRANGLER_SEND_METRICS: 'false', CI: '1' };
  const wr = (args) => execFileSync(WRANGLER, [...args, '-c', config, '--persist-to', dossier], { cwd: RACINE, env, stdio: 'pipe' });

  wr(['d1', 'migrations', 'apply', 'renaissance-itech-db', '--local']);
  const hash = crypto.createHash('sha256').update(JETON_ADMIN).digest('hex');
  wr(['d1', 'execute', 'renaissance-itech-db', '--local', '--command',
    `INSERT INTO administrateurs (email, mot_de_passe, totp_actif) VALUES ('contact@renaissance-itech.com', 'x', 1);
     INSERT INTO sessions (hash, email, role, expire_le) VALUES ('${hash}', 'contact@renaissance-itech.com', 'admin', datetime('now', '+1 day'));`]);

  const stripe = await fauxStripe(port + 1);
  const proc = spawn(WRANGLER, ['dev', '-c', config, '--local', '--port', String(port), '--ip', '127.0.0.1', '--persist-to', dossier, '--test-scheduled',
    '--var', 'STRIPE_SECRET_KEY:rk_test_faux', '--var', `STRIPE_WEBHOOK_SECRET:${WEBHOOK_SECRET}`, '--var', `STRIPE_API:http://127.0.0.1:${port + 1}`],
  { cwd: RACINE, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let journal = '';
  proc.stdout.on('data', (d) => { journal += d; });
  proc.stderr.on('data', (d) => { journal += d; });

  const B = `http://127.0.0.1:${port}`;
  const debut = Date.now();
  for (;;) {
    try { if ((await fetch(`${B}/api/config`)).ok) break; } catch { /* serveur pas encore prêt */ }
    if (Date.now() - debut > 60000) throw new Error(`Le Worker de test ne démarre pas :\n${journal.slice(-3000)}`);
    await new Promise((r) => setTimeout(r, 400));
  }

  // Le serveur local redémarre brièvement quand la base est modifiée par la ligne de commande : on patiente
  const auRedemarrage = async (appel) => {
    for (let i = 0; ; i++) {
      try { return await appel(); } catch (e) { if (i >= 30) throw e; await new Promise((r) => setTimeout(r, 500)); }
    }
  };
  const entetes = (admin) => ({ Origin: B, 'Content-Type': 'application/json', ...(admin ? { Cookie: `rit_session=${JETON_ADMIN}` } : {}) });
  // Appel d'API : renvoie { status, data, headers }
  const api = async (chemin, corps, { admin = true, brut = false } = {}) => {
    const res = await auRedemarrage(() => fetch(B + chemin, corps === undefined
      ? { headers: entetes(admin), redirect: 'manual' }
      : { method: 'POST', headers: entetes(admin), body: JSON.stringify(corps), redirect: 'manual' }));
    const texte = await res.text();
    let data = texte;
    if (!brut) { try { data = JSON.parse(texte); } catch { /* réponse non JSON */ } }
    return { status: res.status, data, headers: res.headers };
  };
  // Webhook Stripe signé comme le ferait Stripe
  const webhook = async (evenement, secret = WEBHOOK_SECRET) => {
    const corps = JSON.stringify(evenement);
    const t = Math.floor(Date.now() / 1000);
    const sig = crypto.createHmac('sha256', secret).update(`${t}.${corps}`).digest('hex');
    const res = await auRedemarrage(() => fetch(`${B}/api/stripe/webhook`, { method: 'POST', headers: { 'Stripe-Signature': `t=${t},v1=${sig}`, 'Content-Type': 'application/json' }, body: corps }));
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  const sql = (commande) => JSON.parse(wr(['d1', 'execute', 'renaissance-itech-db', '--local', '--json', '--command', commande]).toString())[0].results;
  const planifie = (cron) => auRedemarrage(() => fetch(`${B}/__scheduled?cron=${encodeURIComponent(cron)}`)).then((r) => r.text());

  const arreter = async () => {
    try { process.kill(-proc.pid, 'SIGTERM'); } catch { /* déjà arrêté */ }
    stripe.serveur.close();
    rmSync(config, { force: true });
    rmSync(dossier, { recursive: true, force: true });
  };
  return { B, api, webhook, sql, planifie, stripe, arreter, journal: () => journal };
}
