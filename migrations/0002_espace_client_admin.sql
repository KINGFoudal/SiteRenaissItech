-- Espace client, administration, projets et assistant IA

CREATE TABLE IF NOT EXISTS clients (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  email              TEXT NOT NULL UNIQUE,
  nom                TEXT,
  telephone          TEXT,
  entreprise         TEXT,
  cree_le            TEXT NOT NULL DEFAULT (datetime('now')),
  derniere_connexion TEXT
);

-- Un projet est créé automatiquement à chaque rendez-vous (ou par l'administrateur)
CREATE TABLE IF NOT EXISTS projets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id   INTEGER NOT NULL REFERENCES clients(id),
  titre       TEXT NOT NULL,
  service     TEXT,
  statut      TEXT NOT NULL DEFAULT 'nouveau',  -- nouveau | en_cours | en_pause | termine | annule
  avancement  INTEGER NOT NULL DEFAULT 0,       -- 0 à 100
  origine     TEXT NOT NULL DEFAULT 'admin',    -- rendez_vous | contact | admin
  rdv_id      INTEGER REFERENCES rendez_vous(id),
  contact_id  INTEGER REFERENCES contacts(id),
  cree_le     TEXT NOT NULL DEFAULT (datetime('now')),
  maj_le      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS projets_client ON projets (client_id);

-- Échanges entre l'équipe et le client, par projet
CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  projet_id  INTEGER NOT NULL REFERENCES projets(id),
  auteur     TEXT NOT NULL,                     -- client | equipe
  contenu    TEXT NOT NULL,
  lu         INTEGER NOT NULL DEFAULT 0,
  cree_le    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS messages_projet ON messages (projet_id);

-- Connexion par lien envoyé par email (jetons stockés hachés)
CREATE TABLE IF NOT EXISTS jetons_connexion (
  hash       TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  role       TEXT NOT NULL,                     -- client | admin
  expire_le  TEXT NOT NULL,
  utilise    INTEGER NOT NULL DEFAULT 0,
  ip_hash    TEXT,
  cree_le    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS jetons_ip ON jetons_connexion (ip_hash, cree_le);

CREATE TABLE IF NOT EXISTS sessions (
  hash       TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  role       TEXT NOT NULL,
  expire_le  TEXT NOT NULL,
  cree_le    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Questions posées à l'assistant IA du site
CREATE TABLE IF NOT EXISTS assistant_messages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation TEXT NOT NULL,
  question     TEXT NOT NULL,
  reponse      TEXT,
  page         TEXT,
  ip_hash      TEXT,
  cree_le      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS assistant_conv ON assistant_messages (conversation, cree_le);
CREATE INDEX IF NOT EXISTS assistant_ip ON assistant_messages (ip_hash, cree_le);

-- Suivi des demandes de contact dans l'administration
ALTER TABLE contacts ADD COLUMN traite INTEGER NOT NULL DEFAULT 0;
