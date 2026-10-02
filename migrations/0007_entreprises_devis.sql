-- Entreprises (plusieurs contacts par société) et devis acceptables en ligne

CREATE TABLE IF NOT EXISTS entreprises (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nom           TEXT NOT NULL,
  siret         TEXT,
  tva_intracom  TEXT,
  adresse       TEXT,
  code_postal   TEXT,
  ville         TEXT,
  pays          TEXT,
  site_web      TEXT,
  secteur       TEXT,
  taille        TEXT,                                -- 1-9 | 10-49 | 50-249 | 250+
  etiquettes    TEXT,
  cree_le       TEXT NOT NULL DEFAULT (datetime('now')),
  maj_le        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS entreprises_nom ON entreprises (nom COLLATE NOCASE);

ALTER TABLE clients ADD COLUMN entreprise_id INTEGER REFERENCES entreprises(id);
CREATE INDEX IF NOT EXISTS clients_entreprise ON clients (entreprise_id);

-- Reprise : chaque nom d'entreprise déjà saisi devient une fiche entreprise
INSERT OR IGNORE INTO entreprises (nom, siret, adresse, ville, pays, site_web)
  SELECT TRIM(entreprise), MAX(siret), MAX(adresse), MAX(ville), MAX(pays), MAX(site_web)
  FROM clients WHERE entreprise IS NOT NULL AND TRIM(entreprise) <> '' GROUP BY LOWER(TRIM(entreprise));
UPDATE clients SET entreprise_id = (SELECT e.id FROM entreprises e WHERE e.nom = TRIM(clients.entreprise) COLLATE NOCASE)
  WHERE entreprise IS NOT NULL AND TRIM(entreprise) <> '';

-- Devis : envoyés au client, acceptés ou refusés en ligne, puis transformés en factures
CREATE TABLE IF NOT EXISTS devis (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  numero           TEXT NOT NULL UNIQUE,              -- D-2026-0001
  client_id        INTEGER NOT NULL REFERENCES clients(id),
  opportunite_id   INTEGER REFERENCES opportunites(id),
  objet            TEXT NOT NULL,
  lignes           TEXT NOT NULL DEFAULT '[]',        -- [{ "libelle", "quantite", "prix_unitaire" (centimes HT) }]
  montant_ht       INTEGER NOT NULL,
  taux_tva         INTEGER NOT NULL DEFAULT 0,        -- centièmes de % : 2000 = 20 %
  montant_ttc      INTEGER NOT NULL,
  acompte_pct      INTEGER NOT NULL DEFAULT 0,        -- 0 à 100
  emis_le          TEXT NOT NULL,
  valide_jusqu     TEXT NOT NULL,
  statut           TEXT NOT NULL DEFAULT 'envoye',    -- envoye | accepte | refuse | expire | annule | facture
  conditions       TEXT,
  jeton            TEXT NOT NULL UNIQUE,
  accepte_le       TEXT,
  accepte_par      TEXT,                              -- nom saisi par le signataire (« bon pour accord »)
  accepte_ip       TEXT,                              -- empreinte de l'adresse IP (preuve, sans donnée en clair)
  refuse_le        TEXT,
  raison_refus     TEXT,
  cree_le          TEXT NOT NULL DEFAULT (datetime('now')),
  maj_le           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS devis_client ON devis (client_id);
CREATE INDEX IF NOT EXISTS devis_statut ON devis (statut, valide_jusqu);

ALTER TABLE factures ADD COLUMN devis_id INTEGER REFERENCES devis(id);
ALTER TABLE factures ADD COLUMN type TEXT NOT NULL DEFAULT 'facture';  -- facture | acompte | solde
