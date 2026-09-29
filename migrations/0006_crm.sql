-- CRM : fiche contact enrichie, opportunités commerciales (pipeline), notes d'échanges et tâches de suivi

ALTER TABLE clients ADD COLUMN statut TEXT NOT NULL DEFAULT 'prospect';   -- prospect | client | ancien
ALTER TABLE clients ADD COLUMN source TEXT;                                -- formulaire | rendez_vous | boutique | recommandation | reseaux | salon | appel | autre
ALTER TABLE clients ADD COLUMN etiquettes TEXT;                            -- « pme,ia,guinee » : mots-clés séparés par des virgules
ALTER TABLE clients ADD COLUMN poste TEXT;
ALTER TABLE clients ADD COLUMN adresse TEXT;
ALTER TABLE clients ADD COLUMN ville TEXT;
ALTER TABLE clients ADD COLUMN pays TEXT;
ALTER TABLE clients ADD COLUMN site_web TEXT;
ALTER TABLE clients ADD COLUMN siret TEXT;
ALTER TABLE clients ADD COLUMN dernier_contact TEXT;                       -- dernier échange (note, rendez-vous, demande, paiement…)

-- Clients existants : ceux qui ont payé, un accès ou un projet deviennent « client »
UPDATE clients SET statut = 'client' WHERE acces_premium = 1
  OR EXISTS (SELECT 1 FROM factures f WHERE f.client_id = clients.id AND f.statut = 'payee')
  OR EXISTS (SELECT 1 FROM projets p WHERE p.client_id = clients.id AND p.statut IN ('en_cours', 'termine'));
UPDATE clients SET source = 'rendez_vous' WHERE source IS NULL AND EXISTS (SELECT 1 FROM rendez_vous r WHERE r.email = clients.email);
UPDATE clients SET source = 'formulaire' WHERE source IS NULL AND EXISTS (SELECT 1 FROM contacts c WHERE c.email = clients.email);
UPDATE clients SET source = 'boutique' WHERE source IS NULL AND EXISTS (SELECT 1 FROM commandes o WHERE o.client_id = clients.id);
UPDATE clients SET dernier_contact = cree_le WHERE dernier_contact IS NULL;

-- Opportunités : une affaire potentielle, de la première demande à la signature
CREATE TABLE IF NOT EXISTS opportunites (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id    INTEGER NOT NULL REFERENCES clients(id),
  titre        TEXT NOT NULL,
  montant_ht   INTEGER NOT NULL DEFAULT 0,          -- centimes
  etape        TEXT NOT NULL DEFAULT 'nouveau',     -- nouveau | qualifie | proposition | negociation | gagne | perdu
  probabilite  INTEGER NOT NULL DEFAULT 10,         -- % de chances de signer
  echeance     TEXT,                                -- date de signature espérée (AAAA-MM-JJ)
  origine      TEXT,                                -- formulaire | rendez_vous | manuel
  raison_perte TEXT,
  cree_le      TEXT NOT NULL DEFAULT (datetime('now')),
  maj_le       TEXT NOT NULL DEFAULT (datetime('now')),
  cloture_le   TEXT
);
CREATE INDEX IF NOT EXISTS opportunites_client ON opportunites (client_id);
CREATE INDEX IF NOT EXISTS opportunites_etape ON opportunites (etape);

-- Historique des échanges : notes, appels, emails, réunions
CREATE TABLE IF NOT EXISTS crm_notes (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id      INTEGER NOT NULL REFERENCES clients(id),
  opportunite_id INTEGER REFERENCES opportunites(id),
  type           TEXT NOT NULL DEFAULT 'note',      -- note | appel | email | reunion
  contenu        TEXT NOT NULL,
  auteur         TEXT,
  cree_le        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS crm_notes_client ON crm_notes (client_id);

-- Tâches de suivi : rappeler, envoyer un devis, relancer…
CREATE TABLE IF NOT EXISTS taches (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id      INTEGER REFERENCES clients(id),
  opportunite_id INTEGER REFERENCES opportunites(id),
  titre          TEXT NOT NULL,
  echeance       TEXT,                              -- AAAA-MM-JJ
  priorite       TEXT NOT NULL DEFAULT 'normale',   -- normale | haute
  faite          INTEGER NOT NULL DEFAULT 0,
  faite_le       TEXT,
  cree_le        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS taches_ouvertes ON taches (faite, echeance);
CREATE INDEX IF NOT EXISTS taches_client ON taches (client_id);
