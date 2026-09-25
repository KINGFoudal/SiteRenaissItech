-- Connexion par email et mot de passe (remplace le lien envoyé par email)
--
-- Clients : seul un client « premium » (accès créé par l'administrateur) peut se connecter.
-- L'administrateur crée l'accès avec un mot de passe provisoire, que le client doit changer
-- à sa première connexion. Le client peut ensuite le réinitialiser seul (mot de passe oublié).

ALTER TABLE clients ADD COLUMN mot_de_passe TEXT;                          -- empreinte PBKDF2, jamais le mot de passe en clair
ALTER TABLE clients ADD COLUMN acces_premium INTEGER NOT NULL DEFAULT 0;   -- 1 = peut se connecter à l'espace client
ALTER TABLE clients ADD COLUMN doit_changer_mdp INTEGER NOT NULL DEFAULT 0; -- 1 = mot de passe provisoire à remplacer
ALTER TABLE clients ADD COLUMN mdp_maj_le TEXT;
ALTER TABLE clients ADD COLUMN acces_cree_le TEXT;

-- Administrateurs (les adresses autorisées sont listées dans ADMIN_EMAILS)
CREATE TABLE IF NOT EXISTS administrateurs (
  email              TEXT PRIMARY KEY,
  mot_de_passe       TEXT,
  doit_changer_mdp   INTEGER NOT NULL DEFAULT 0,
  mdp_maj_le         TEXT,
  derniere_connexion TEXT,
  cree_le            TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Liens « mot de passe oublié » (jetons stockés hachés, usage unique)
CREATE TABLE IF NOT EXISTS jetons_mdp (
  hash       TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  role       TEXT NOT NULL,                     -- client | admin
  expire_le  TEXT NOT NULL,
  utilise    INTEGER NOT NULL DEFAULT 0,
  ip_hash    TEXT,
  cree_le    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS jetons_mdp_ip ON jetons_mdp (ip_hash, cree_le);

-- Tentatives de connexion : blocage temporaire après trop d'échecs
CREATE TABLE IF NOT EXISTS tentatives_connexion (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  email    TEXT NOT NULL,
  ip_hash  TEXT,
  reussi   INTEGER NOT NULL DEFAULT 0,
  cree_le  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS tentatives_email ON tentatives_connexion (email, cree_le);
CREATE INDEX IF NOT EXISTS tentatives_ip ON tentatives_connexion (ip_hash, cree_le);

-- L'ancienne connexion par lien est supprimée : ses jetons et ses sessions ne servent plus
DROP TABLE IF EXISTS jetons_connexion;
DELETE FROM sessions;
