-- Demandes reçues par le site (formulaire de contact, prise de rendez-vous)

CREATE TABLE IF NOT EXISTS contacts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nom        TEXT NOT NULL,
  email      TEXT NOT NULL,
  sujet      TEXT NOT NULL,
  message    TEXT NOT NULL,
  ip_hash    TEXT,
  cree_le    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rendez_vous (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  service    TEXT NOT NULL,
  date       TEXT NOT NULL,          -- AAAA-MM-JJ
  heure      TEXT NOT NULL,          -- HH:MM (heure de Paris)
  nom        TEXT NOT NULL,
  email      TEXT NOT NULL,
  telephone  TEXT,
  message    TEXT,
  statut     TEXT NOT NULL DEFAULT 'confirme',   -- confirme | annule
  ip_hash    TEXT,
  cree_le    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Un seul rendez-vous confirmé par créneau
CREATE UNIQUE INDEX IF NOT EXISTS rdv_creneau_unique ON rendez_vous (date, heure) WHERE statut = 'confirme';
CREATE INDEX IF NOT EXISTS contacts_ip ON contacts (ip_hash, cree_le);
CREATE INDEX IF NOT EXISTS rdv_ip ON rendez_vous (ip_hash, cree_le);
