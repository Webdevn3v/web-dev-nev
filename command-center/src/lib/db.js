import Database from '@tauri-apps/plugin-sql';
import { runMigrations } from './migrations.js';

let dbInstance = null;
let migrationResult = null;

export async function initDb() {
  dbInstance = await Database.load('sqlite:tds-command-center.db');
  // Belt-and-suspenders FK enforcement: JS-side actions.js also checks referenced rows exist
  // before writing (assertExists) since sqlite pools can open connections where this pragma
  // wasn't (re)applied.
  await dbInstance.execute('PRAGMA foreign_keys = ON');
  migrationResult = await runMigrations(dbInstance);
  return { db: dbInstance, migrationResult };
}

export function getDb() {
  if (!dbInstance) throw new Error('Database not initialized yet — call initDb() first');
  return dbInstance;
}

export function getMigrationResult() {
  return migrationResult;
}
