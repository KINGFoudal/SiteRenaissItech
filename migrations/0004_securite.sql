-- Sécurité : double authentification des administrateurs, journal d'administration

-- Double authentification (TOTP, application Google/Microsoft Authenticator)
ALTER TABLE administrateurs ADD COLUMN totp_secret TEXT;              -- clé secrète (base32)
ALTER TABLE administrateurs ADD COLUMN totp_actif INTEGER NOT NULL DEFAULT 0;
ALTER TABLE administrateurs ADD COLUMN totp_dernier_pas INTEGER;      -- dernier code utilisé : empêche sa réutilisation
ALTER TABLE administrateurs ADD COLUMN codes_secours TEXT;            -- empreintes des codes de secours (JSON)

-- Étape intermédiaire : mot de passe vérifié, code à 6 chiffres attendu (5 minutes, 5 essais)
CREATE TABLE IF NOT EXISTS defis_2fa (
  hash       TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  essais     INTEGER NOT NULL DEFAULT 0,
  expire_le  TEXT NOT NULL,
  cree_le    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Journal : qui a fait quoi dans l'administration
CREATE TABLE IF NOT EXISTS journal_admin (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  email    TEXT NOT NULL,
  action   TEXT NOT NULL,
  cible    TEXT,
  details  TEXT,
  ip_hash  TEXT,
  cree_le  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS journal_date ON journal_admin (cree_le);

-- Les sessions administrateur ouvertes avant la double authentification sont fermées
DELETE FROM sessions WHERE role = 'admin';
