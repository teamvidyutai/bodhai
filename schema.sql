-- BodhAI MySQL Schema v2.1
-- Run: node setup.js

CREATE DATABASE IF NOT EXISTS bodhai CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE bodhai;

CREATE TABLE IF NOT EXISTS sessions (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  student       VARCHAR(150) NOT NULL,
  roll          INT          DEFAULT 0,
  subject       VARCHAR(100) NOT NULL,
  score         INT          NOT NULL DEFAULT 0,
  total         INT          NOT NULL DEFAULT 6,
  answers       JSON,
  timings       JSON,
  flags         JSON,
  concept_map   JSON,
  session_code  VARCHAR(25)  DEFAULT 'DIRECT',
  lang          VARCHAR(10)  DEFAULT 'hi',
  source        VARCHAR(20)  DEFAULT 'student',
  device_id     VARCHAR(64)  DEFAULT NULL,
  created_at    DATETIME     DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_student     (student),
  INDEX idx_subject     (subject),
  INDEX idx_sess_code   (session_code),
  INDEX idx_created     (created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS custom_banks (
  subject      VARCHAR(100) PRIMARY KEY,
  questions    JSON         NOT NULL,
  created_by   VARCHAR(150) DEFAULT NULL,
  updated_at   DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_at   DATETIME     DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS session_codes (
  code         VARCHAR(25)  PRIMARY KEY,
  label        VARCHAR(200) DEFAULT NULL,
  active       TINYINT(1)   DEFAULT 1,
  created_at   DATETIME     DEFAULT CURRENT_TIMESTAMP,
  expires_at   DATETIME     DEFAULT NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sync_queue (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  device_id    VARCHAR(64),
  payload      JSON         NOT NULL,
  synced       TINYINT(1)   DEFAULT 0,
  created_at   DATETIME     DEFAULT CURRENT_TIMESTAMP,
  synced_at    DATETIME     DEFAULT NULL
) ENGINE=InnoDB;

SELECT 'BodhAI schema ready' AS status;
