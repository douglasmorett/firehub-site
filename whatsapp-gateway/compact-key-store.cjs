// Storage prototype only. Not connected to live Baileys sessions.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function openCompactKeyStore(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(directory).isSymbolicLink()) throw new Error('Symlink store refused');
  const filename = path.join(directory, 'keys.sqlite');
  try { fs.closeSync(fs.openSync(filename, 'wx', 0o600)); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  if (!fs.lstatSync(filename).isFile() || fs.lstatSync(filename).isSymbolicLink()) {
    throw new Error('Invalid store file');
  }
  fs.chmodSync(filename, 0o600);
  const db = new DatabaseSync(filename);
  try {
    db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000;');
    db.exec('CREATE TABLE IF NOT EXISTS entries (name TEXT PRIMARY KEY, json TEXT NOT NULL) WITHOUT ROWID');
  } catch (error) { db.close(); throw error; }
  const read = db.prepare('SELECT json FROM entries WHERE name = ?');
  const write = db.prepare('INSERT INTO entries(name,json) VALUES (?,?) ON CONFLICT(name) DO UPDATE SET json=excluded.json');
  const remove = db.prepare('DELETE FROM entries WHERE name = ?');
  return {
    get(name) { return read.get(name)?.json ?? null; },
    // Values are already serialized by the caller's Baileys BufferJSON codec.
    // null removes an entry. Validate the entire batch before committing any.
    set(entries) {
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const [name, json] of entries) {
          if (typeof name !== 'string' || !name) throw new Error('Invalid key name');
          if (json === null) remove.run(name);
          else {
            if (typeof json !== 'string') throw new Error('Expected serialized JSON');
            JSON.parse(json);
            write.run(name, json);
          }
        }
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    count() { return db.prepare('SELECT COUNT(*) AS count FROM entries').get().count; },
    entries() { return db.prepare('SELECT name,json FROM entries ORDER BY name').iterate(); },
    close() { db.close(); },
  };
}
module.exports = { openCompactKeyStore };
