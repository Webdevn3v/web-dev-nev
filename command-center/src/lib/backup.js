// Backup & Recovery — PHASE1-SPEC.md §7.
//
// Design: the single exported file IS the Stronghold vault snapshot (already password-protected
// via argon2, see src-tauri/src/lib.rs). "Export Backup" reads the live SQLite file's raw bytes
// and stores them as a record in the vault's Store before saving the snapshot, so the one file
// that leaves the machine genuinely contains both "SQLite file + Stronghold vault" and is
// encrypted end to end — no extra crypto dependency needed beyond what src-tauri already ships.
//
// This uses only officially documented Tauri v2 plugin APIs (@tauri-apps/plugin-fs,
// @tauri-apps/plugin-dialog, @tauri-apps/plugin-stronghold) verified against the plugins-workspace
// source for this build. It has not been runtime-tested — see docs/PHASE1-ACCEPTANCE.md for why.

import { readFile, writeFile } from '@tauri-apps/plugin-fs';
import { save, open } from '@tauri-apps/plugin-dialog';
import { Stronghold } from '@tauri-apps/plugin-stronghold';
import { appConfigDir, appLocalDataDir, join } from '@tauri-apps/api/path';
import { nowIso } from './ids.js';
import { getDb, initDb } from './db.js';
import { getLegacyState } from './queries.js';

const DB_FILENAME = 'tds-command-center.db';
const VAULT_FILENAME = 'tds-vault.stronghold';
const BACKUP_CLIENT = 'tds-backup-client';
const BACKUP_KEY = 'sqlite_backup_latest';
const META_KEY = 'sqlite_backup_meta';

async function getVaultPath() {
  return join(await appLocalDataDir(), VAULT_FILENAME);
}

async function getDbPath() {
  // tauri-plugin-sql resolves 'sqlite:<name>' relative to app_config_dir() — see wrapper.rs.
  return join(await appConfigDir(), DB_FILENAME);
}

export async function exportBackup(passphrase) {
  if (!passphrase || passphrase.length < 8) {
    throw new Error('Recovery passphrase must be at least 8 characters.');
  }
  // Enforced here, not just via the disabled Export button in the UI — §7 requires this step
  // "cannot be silently skipped," and a UI-only gate can be bypassed.
  if (await firstRunAcknowledgementNeeded()) {
    throw new Error('Acknowledge the recovery-passphrase warning before exporting a backup.');
  }

  const dbPath = await getDbPath();
  const sqliteBytes = await readFile(dbPath);

  const vaultPath = await getVaultPath();
  const stronghold = await Stronghold.load(vaultPath, passphrase);
  const client = await stronghold.createClient(BACKUP_CLIENT).catch(() => stronghold.loadClient(BACKUP_CLIENT));
  const store = client.getStore();

  const timestamp = nowIso();
  await store.insert(BACKUP_KEY, Array.from(sqliteBytes));
  await store.insert(
    META_KEY,
    Array.from(new TextEncoder().encode(JSON.stringify({ timestamp, dbBytes: sqliteBytes.length })))
  );
  await stronghold.save();

  const suggestedName = `tds-command-center-backup-${timestamp.replace(/[:.]/g, '-')}.stronghold`;
  const destPath = await save({
    title: 'Export Command Center Backup',
    defaultPath: suggestedName,
    filters: [{ name: 'Command Center backup', extensions: ['stronghold'] }],
  });
  if (!destPath) return { cancelled: true };

  const vaultBytes = await readFile(vaultPath);
  await writeFile(destPath, vaultBytes);

  return { cancelled: false, path: destPath, timestamp };
}

export async function restoreBackup(passphrase) {
  if (!passphrase) throw new Error('Recovery passphrase is required.');

  const srcPath = await open({
    title: 'Select Command Center Backup',
    multiple: false,
    filters: [{ name: 'Command Center backup', extensions: ['stronghold'] }],
  });
  if (!srcPath) return { cancelled: true };

  const importedBytes = await readFile(srcPath);
  const vaultPath = await getVaultPath();
  await writeFile(vaultPath, importedBytes);

  const stronghold = await Stronghold.load(vaultPath, passphrase);
  const client = await stronghold.loadClient(BACKUP_CLIENT);
  const store = client.getStore();
  const sqliteBytes = await store.get(BACKUP_KEY);
  if (!sqliteBytes) throw new Error('This backup file does not contain a Command Center database record.');

  // Close the live sqlite connection pool before overwriting its file — writing under an open
  // handle risks a locked-file failure on Windows or a corrupted read on other platforms.
  await getDb().close();

  const dbPath = await getDbPath();
  await writeFile(dbPath, sqliteBytes);

  return { cancelled: false, restoredFrom: srcPath, needsReload: true };
}

export async function reopenAfterRestore() {
  return initDb();
}

export async function firstRunAcknowledgementNeeded() {
  const ack = await getLegacyState('recovery_key_acknowledged', null);
  return !ack;
}
