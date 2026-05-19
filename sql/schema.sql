-- Offshore Protocol Dashboard — PostgreSQL schema (Supabase)
-- Run once to initialize the database.

CREATE TABLE IF NOT EXISTS transfers (
  hash        TEXT    NOT NULL,
  log_index   INTEGER NOT NULL DEFAULT 0,
  block_num   BIGINT  NOT NULL,
  timestamp   BIGINT  NOT NULL,
  from_addr   TEXT    NOT NULL,
  to_addr     TEXT    NOT NULL,
  raw_value   TEXT    NOT NULL,
  amount      DOUBLE PRECISION NOT NULL,
  kind        TEXT    NOT NULL,
  op_type     TEXT    NOT NULL,
  PRIMARY KEY (hash, log_index)
);
CREATE INDEX IF NOT EXISTS idx_ts      ON transfers(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_block   ON transfers(block_num DESC);
CREATE INDEX IF NOT EXISTS idx_from    ON transfers(from_addr);
CREATE INDEX IF NOT EXISTS idx_to      ON transfers(to_addr);
CREATE INDEX IF NOT EXISTS idx_kind    ON transfers(kind);
CREATE INDEX IF NOT EXISTS idx_kind_to ON transfers(kind, to_addr);
CREATE INDEX IF NOT EXISTS idx_hash_only ON transfers(hash);

CREATE TABLE IF NOT EXISTS supply_snapshots (
  id        BIGSERIAL PRIMARY KEY,
  timestamp BIGINT  NOT NULL,
  supply    DOUBLE PRECISION NOT NULL,
  holders   INTEGER
);

CREATE TABLE IF NOT EXISTS eth_price_snapshots (
  id        BIGSERIAL PRIMARY KEY,
  timestamp BIGINT  NOT NULL,
  price_usd DOUBLE PRECISION NOT NULL
);

CREATE TABLE IF NOT EXISTS influence_supply_snapshots (
  id        BIGSERIAL PRIMARY KEY,
  timestamp BIGINT  NOT NULL,
  supply    DOUBLE PRECISION NOT NULL
);

CREATE TABLE IF NOT EXISTS vault_payouts (
  hash      TEXT    NOT NULL,
  log_index INTEGER NOT NULL DEFAULT 0,
  block_num BIGINT  NOT NULL,
  timestamp BIGINT  NOT NULL,
  recipient TEXT    NOT NULL,
  amount    DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (hash, log_index)
);
CREATE INDEX IF NOT EXISTS idx_vault_ts   ON vault_payouts(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_vault_recp ON vault_payouts(recipient);

CREATE TABLE IF NOT EXISTS influence_transfers (
  hash      TEXT    NOT NULL,
  log_index INTEGER NOT NULL DEFAULT 0,
  block_num BIGINT  NOT NULL,
  timestamp BIGINT  NOT NULL,
  from_addr TEXT    NOT NULL,
  to_addr   TEXT    NOT NULL,
  amount    DOUBLE PRECISION NOT NULL,
  kind      TEXT    NOT NULL,
  PRIMARY KEY (hash, log_index)
);
CREATE INDEX IF NOT EXISTS idx_inf_ts    ON influence_transfers(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_inf_block ON influence_transfers(block_num DESC);
CREATE INDEX IF NOT EXISTS idx_inf_kind  ON influence_transfers(kind);
CREATE INDEX IF NOT EXISTS idx_inf_hash  ON influence_transfers(hash);

CREATE TABLE IF NOT EXISTS token_holders (
  address       TEXT    PRIMARY KEY,
  balance       DOUBLE PRECISION NOT NULL,
  balance_raw   TEXT    NOT NULL,
  rank          INTEGER NOT NULL,
  is_contract   BOOLEAN NOT NULL DEFAULT FALSE,
  last_snapshot BIGINT  NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS companies (
  address      TEXT PRIMARY KEY,
  owner        TEXT NOT NULL,
  active       BOOLEAN NOT NULL DEFAULT FALSE,
  completable  BOOLEAN NOT NULL DEFAULT FALSE,
  liquidatable BOOLEAN NOT NULL DEFAULT FALSE,
  end_time     BIGINT  NOT NULL DEFAULT 0,
  liq_price    TEXT    NOT NULL DEFAULT '0',
  auto_trade   BOOLEAN NOT NULL DEFAULT FALSE,
  cooldown_end BIGINT  NOT NULL DEFAULT 0,
  last_updated BIGINT  NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_companies_owner ON companies(owner);
CREATE INDEX IF NOT EXISTS idx_companies_auto  ON companies(auto_trade);

CREATE TABLE IF NOT EXISTS hits (
  tx_hash       TEXT     NOT NULL,
  log_index     INTEGER  NOT NULL,
  block_num     BIGINT   NOT NULL,
  timestamp     BIGINT   NOT NULL,
  attacker      TEXT     NOT NULL,
  victim        TEXT     NOT NULL,
  company       TEXT     NOT NULL,
  mode          SMALLINT NOT NULL DEFAULT 0,
  completion    INTEGER  NOT NULL DEFAULT 0,
  full_payout   DOUBLE PRECISION NOT NULL DEFAULT 0,
  stolen        DOUBLE PRECISION NOT NULL DEFAULT 0,
  kept          DOUBLE PRECISION NOT NULL DEFAULT 0,
  cost          DOUBLE PRECISION NOT NULL DEFAULT 0,
  PRIMARY KEY (tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS idx_hits_attacker  ON hits(attacker, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_hits_victim    ON hits(victim, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_hits_timestamp ON hits(timestamp DESC);
