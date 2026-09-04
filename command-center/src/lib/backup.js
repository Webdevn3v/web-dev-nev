// Backup & Recovery — PHASE1-SPEC.md §7.
//
// Two fixes from the ChatGPT audit landed here:
//
// 1. Non-destructive restore. The previous version wrote the imported file straight over the
//    live vault *before* checking whether it was even a valid, decryptable Command Center backup
//    — a wrong passphrase or a corrupt/foreign file would clobber the live vault before the
//    failure was ever detected. Restore now validates entirely against a *staging* copy first
//    (temp salt + temp vault path) and only touches the live vault/db files after that validation
//    succeeds. On any failure, the salt file (the one thing that must be touched to even attempt
//    decryption — see point 2) is reverted to what it was, and the live vault/db are never opened
//    for writing at all.
//
// 2. Backup completeness / the recovery key's salt. Verified against the plugin's Rust source
//    (kdf.rs): the passphrase alone does not derive the encryption key — Argon2 combines it with
//    a random salt that is generated once per machine and cached at a *fixed, globally-configured*
//    path (src-tauri/src/lib.rs's `with_argon2(&salt_path)`, at app_local_data_dir()/
//    stronghold-salt.txt). A backup that only contained the vault snapshot would be unrestorable
//    on a fresh machine even with the correct passphrase, because a fresh machine has no salt file
//    and would silently generate a *different* one. The exported archive is therefore a small JSON
//    envelope containing the vault snapshot AND the salt, both base64-encoded, plus a format
//    version and timestamp — not just the raw snapshot file.
//
// The encryption itself is unchanged from the original design: the live SQLite file's raw bytes
// are stored as a record in the Stronghold vault's Store before the vault is saved, so the vault
// snapshot inside the envelope already contains "SQLite file + Stronghold vault" per §7, protected
// by the same password-derived key as any other Stronghold secret.
//
// Built against the plugin APIs verified via WebFetch against plugins-workspace source for this
// build (@tauri-apps/plugin-fs, @tauri-apps/plugin-dialog, @tauri-apps/plugin-stronghold). Not
// runtime-tested — see docs/PHASE1-ACCEPTANCE.md for exactly why and what remains to verify.

import { readFile, writeFile, readTextFile, writeTextFile, exists, remove } from '@tauri-apps/plugin-fs';
import { save, open } from '@tauri-apps/plugin-dialog';
import { Stronghold } from '@tauri-apps/plugin-stronghold';
import { appConfigDir, appLocalDataDir, join } from '@tauri-apps/api/path';
import { nowIso } from './ids.js';
import { getDb, initDb } from './db.js';
import { getLegacyState } from './queries.js';

const DB_FILENAME = 'tds-command-center.db';
const VAULT_FILENAME = 'tds-vault.stronghold';
const SALT_FILENAME = 'stronghold-salt.txt'; // must match src-tauri/src/lib.rs's with_argon2 path
const STAGING_VAULT_FILENAME = '.restore-staging.stronghold';
const BACKUP_CLIENT = 'tds-backup-client';
const BACKUP_KEY = 'sqlite_backup_latest';
const META_KEY = 'sqlite_backup_meta';
const ENVELOPE_FORMAT = 'tds-command-center-backup';
const ENVELOPE_VERSION = 1;
const SQLITE_MAGIC = [0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, 0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00]; // "SQLite format 3\0"

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function looksLikeSqliteFile(bytes) {
  if (!bytes || bytes.length < 16) return false;
  for (let i = 0; i < 16; i++) if (bytes[i] !== SQLITE_MAGIC[i]) return false;
  return true;
}

async function getVaultPath() { return join(await appLocalDataDir(), VAULT_FILENAME); }
async function getSaltPath() { return join(await appLocalDataDir(), SALT_FILENAME); }
async function getStagingVaultPath() { return join(await appLocalDataDir(), STAGING_VAULT_FILENAME); }
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

  // Read the salt only *after* Stronghold.load() above, which generates one at this fixed path
  // if it didn't already exist (verified against kdf.rs) — so by this point it's guaranteed
  // present, whether this is the very first export or the hundredth.
  const saltPath = await getSaltPath();
  const saltBytes = await readFile(saltPath);
  const vaultBytes = await readFile(vaultPath);

  const envelope = {
    format: ENVELOPE_FORMAT,
    version: ENVELOPE_VERSION,
    timestamp,
    saltBase64: bytesToBase64(saltBytes),
    vaultBase64: bytesToBase64(vaultBytes),
  };

  const suggestedName = `tds-command-center-backup-${timestamp.replace(/[:.]/g, '-')}.tdsbackup`;
  const destPath = await save({
    title: 'Export Command Center Backup',
    defaultPath: suggestedName,
    filters: [{ name: 'Command Center backup', extensions: ['tdsbackup'] }],
  });
  if (!destPath) return { cancelled: true };

  await writeTextFile(destPath, JSON.stringify(envelope));

  return { cancelled: false, path: destPath, timestamp };
}

export async function restoreBackup(passphrase) {
  if (!passphrase) throw new Error('Recovery passphrase is required.');

  const srcPath = await open({
    title: 'Select Command Center Backup',
    multiple: false,
    filters: [{ name: 'Command Center backup', extensions: ['tdsbackup'] }],
  });
  if (!srcPath) return { cancelled: true };

  // ---- Parse and shape-check the envelope. Nothing on disk is touched yet.
  let envelope;
  try {
    envelope = JSON.parse(await readTextFile(srcPath));
  } catch {
    throw new Error('That file is not a readable Command Center backup (not valid JSON).');
  }
  if (envelope?.format !== ENVELOPE_FORMAT || typeof envelope.saltBase64 !== 'string' || typeof envelope.vaultBase64 !== 'string') {
    throw new Error('That file is not a Command Center backup (unrecognized format).');
  }

  const importedSaltBytes = base64ToBytes(envelope.saltBase64);
  const importedVaultBytes = base64ToBytes(envelope.vaultBase64);

  const saltPath = await getSaltPath();
  const stagingVaultPath = await getStagingVaultPath();

  // ---- Save what's currently at the salt path so a failed validation can put it back exactly.
  // This is the one live file this step must touch: tauri-plugin-stronghold's Argon2 key
  // derivation reads from a single fixed path configured once at app startup (src-tauri/src/
  // lib.rs), not something the JS Stronghold.load() call can point elsewhere per-call — so there
  // is no way to attempt decryption against the imported salt without placing it there first.
  const saltExistedBefore = await exists(saltPath);
  const originalSaltBytes = saltExistedBefore ? await readFile(saltPath) : null;

  async function revertSalt() {
    if (saltExistedBefore) await writeFile(saltPath, originalSaltBytes);
    else await remove(saltPath).catch(() => {});
  }

  try {
    await writeFile(saltPath, importedSaltBytes);
    await writeFile(stagingVaultPath, importedVaultBytes);

    // ---- Validate against the staging copy — the live vault is not opened here.
    const stronghold = await Stronghold.load(stagingVaultPath, passphrase);
    const client = await stronghold.loadClient(BACKUP_CLIENT);
    const store = client.getStore();
    const sqliteBytes = await store.get(BACKUP_KEY);
    if (!looksLikeSqliteFile(sqliteBytes)) {
      throw new Error('This backup does not contain a valid Command Center database.');
    }

    // ---- Validation passed: now, and only now, touch the live vault and db.
    await getDb().close(); // release the sqlite file handle before overwriting it
    const vaultPath = await getVaultPath();
    const dbPath = await getDbPath();
    await writeFile(vaultPath, importedVaultBytes);
    await writeFile(dbPath, sqliteBytes);

    return { cancelled: false, restoredFrom: srcPath, needsReload: true };
  } catch (err) {
    await revertSalt();
    throw new Error(
      `Restore validation failed — nothing was changed. Check the passphrase and file. (${err.message || err})`
    );
  } finally {
    await remove(stagingVaultPath).catch(() => {});
  }
}

export async function reopenAfterRestore() {
  return initDb();
}

export async function firstRunAcknowledgementNeeded() {
  const ack = await getLegacyState('recovery_key_acknowledged', null);
  return !ack;
}
