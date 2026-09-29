-- Factures clients, relances automatiques, boutique et paiements en ligne (Stripe)
-- Les factures et les commandes sont des pièces comptables : conservées 10 ans, jamais purgées automatiquement.

CREATE TABLE IF NOT EXISTS factures (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  numero           TEXT NOT NULL UNIQUE,                 -- F-2026-0001 : numérotation continue par année
  client_id        INTEGER NOT NULL REFERENCES clients(id),
  projet_id        INTEGER REFERENCES projets(id),
  commande_id      INTEGER REFERENCES commandes(id),
  objet            TEXT NOT NULL,
  lignes           TEXT NOT NULL DEFAULT '[]',           -- [{ "libelle", "quantite", "prix_unitaire" (centimes HT) }]
  montant_ht       INTEGER NOT NULL,                     -- centimes
  taux_tva         INTEGER NOT NULL DEFAULT 0,           -- en centièmes de % : 2000 = 20 %
  montant_ttc      INTEGER NOT NULL,                     -- centimes
  devise           TEXT NOT NULL DEFAULT 'eur',
  emise_le         TEXT NOT NULL,                        -- AAAA-MM-JJ
  echeance         TEXT NOT NULL,                        -- AAAA-MM-JJ
  statut           TEXT NOT NULL DEFAULT 'a_payer',      -- a_payer | payee | annulee
  payee_le         TEXT,
  mode_paiement    TEXT,                                 -- carte | virement | especes | cheque | autre
  stripe_session   TEXT,
  jeton            TEXT NOT NULL UNIQUE,                 -- lien de consultation et de paiement (non devinable)
  relances_actives INTEGER NOT NULL DEFAULT 1,
  cree_le          TEXT NOT NULL DEFAULT (datetime('now')),
  maj_le           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS factures_client ON factures (client_id);
CREATE INDEX IF NOT EXISTS factures_statut ON factures (statut, echeance);

-- Une ligne par relance envoyée : empêche tout doublon, même si la tâche planifiée tourne deux fois
CREATE TABLE IF NOT EXISTS relances (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  facture_id  INTEGER NOT NULL REFERENCES factures(id),
  niveau      INTEGER NOT NULL,                          -- 1, 2, 3 (0 = relance manuelle)
  email       TEXT NOT NULL,
  envoye      INTEGER NOT NULL DEFAULT 1,                -- 0 si l'envoi a échoué
  cree_le     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS relances_unique ON relances (facture_id, niveau) WHERE niveau > 0;

-- Réglages modifiables depuis l'administration (calendrier des relances, compteurs de numérotation…)
CREATE TABLE IF NOT EXISTS parametres (
  cle     TEXT PRIMARY KEY,
  valeur  TEXT NOT NULL
);

-- Catalogue de la boutique : prix fixés par l'administrateur, jamais par le navigateur
CREATE TABLE IF NOT EXISTS produits (
  id              TEXT PRIMARY KEY,                      -- identifiant lisible : diagnostic-ia
  nom             TEXT NOT NULL,
  description     TEXT,
  prix_ht         INTEGER,                               -- centimes ; NULL = sur devis uniquement
  achat_en_ligne  INTEGER NOT NULL DEFAULT 0,            -- 1 = bouton « Acheter » visible
  ordre           INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO produits (id, nom, ordre) VALUES
  ('diagnostic-ia', 'Diagnostic IA privée', 1),
  ('assistant-ia', 'Assistant IA privé clé en main', 2),
  ('poc-ia', 'PoC IA sur vos données', 3),
  ('pack-automatisation', 'Pack Automatisation IA', 4),
  ('formation-ia', 'Formation IA des équipes', 5),
  ('audit-securite', 'Audit sécurité & IA', 6),
  ('site-vitrine', 'Site vitrine professionnel', 7);

CREATE TABLE IF NOT EXISTS commandes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  reference       TEXT NOT NULL UNIQUE,                  -- C-2026-0001
  client_id       INTEGER REFERENCES clients(id),
  email           TEXT,
  lignes          TEXT NOT NULL,                         -- [{ "id", "nom", "quantite", "prix_ht" }]
  montant_ht      INTEGER NOT NULL,
  montant_ttc     INTEGER NOT NULL,
  statut          TEXT NOT NULL DEFAULT 'en_attente',    -- en_attente | payee | expiree | remboursee
  stripe_session  TEXT UNIQUE,
  facture_id      INTEGER REFERENCES factures(id),
  cree_le         TEXT NOT NULL DEFAULT (datetime('now')),
  payee_le        TEXT
);
CREATE INDEX IF NOT EXISTS commandes_statut ON commandes (statut, cree_le);

-- Événements Stripe déjà traités : un webhook rejoué n'a aucun effet
CREATE TABLE IF NOT EXISTS stripe_evenements (
  id       TEXT PRIMARY KEY,
  type     TEXT NOT NULL,
  recu_le  TEXT NOT NULL DEFAULT (datetime('now'))
);
