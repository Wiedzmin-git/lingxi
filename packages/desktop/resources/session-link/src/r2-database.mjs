import { DatabaseSync } from "node:sqlite"
import { mkdir, open } from "node:fs/promises"
import path from "node:path"

const databases = new Map()

/** Private mailbox database, owned by the Desktop host, not by service plugins. */
export function openR2Database(root) {
  const key = path.resolve(root)
  if (!databases.has(key)) databases.set(key, initialize(key).catch((error) => { databases.delete(key); throw error }))
  return databases.get(key)
}

async function initialize(root) {
  const directory = path.join(root, ".private", "r2")
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const file = path.join(directory, "mail.sqlite")
  // POSIX modes are not a Windows ACL attestation. This is local profile storage,
  // not a separate cross-account security service.
  const handle = await open(file, "wx", 0o600).catch((error) => { if (error.code !== "EEXIST") throw error })
  await handle?.close()
  const database = new DatabaseSync(file)
  database.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;")
  const version = database.prepare("PRAGMA user_version").get().user_version
  if (![0, 2, 3].includes(version)) { database.close(); throw new Error("Unsupported R2 mailbox database version; refusing to recreate identity") }
  database.exec(`
    BEGIN IMMEDIATE;
    CREATE TABLE IF NOT EXISTS mailbox_setting (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS capability (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, invitation TEXT NOT NULL, secret_hash TEXT NOT NULL, wake INTEGER NOT NULL, revoked INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS contact (address_ref TEXT PRIMARY KEY, sender_session_id TEXT NOT NULL, invitation TEXT NOT NULL, label TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS contact_sender ON contact(sender_session_id);
    CREATE TABLE IF NOT EXISTS mail (kind TEXT NOT NULL, key TEXT NOT NULL, envelope BLOB NOT NULL, hash TEXT NOT NULL, address TEXT, state TEXT NOT NULL, summary TEXT NOT NULL, PRIMARY KEY(kind, key));
    CREATE TABLE IF NOT EXISTS attachment (kind TEXT NOT NULL, mail_key TEXT NOT NULL, ordinal INTEGER NOT NULL, bytes BLOB NOT NULL, PRIMARY KEY(kind, mail_key, ordinal), FOREIGN KEY(kind, mail_key) REFERENCES mail(kind, key));
  `)
  try {
    if (version === 2) {
      database.exec("ALTER TABLE mail ADD COLUMN summary TEXT")
      for (const row of database.prepare("SELECT kind,key,envelope FROM mail").all()) {
        const { replyTo, attachments, ...summary } = JSON.parse(Buffer.from(row.envelope).toString("utf8"))
        database.prepare("UPDATE mail SET summary=? WHERE kind=? AND key=?").run(JSON.stringify({ ...summary,
          attachments: attachments.map(({ base64, ...file }) => file) }), row.kind, row.key)
      }
    }
    database.exec("PRAGMA user_version=3; COMMIT;")
  } catch (error) { database.exec("ROLLBACK"); database.close(); throw error }
  return {
    database, directory,
    transaction(apply) {
      database.exec("BEGIN IMMEDIATE")
      try { const result = apply(); database.exec("COMMIT"); return result }
      catch (error) { database.exec("ROLLBACK"); throw error }
    },
    close() { database.close(); databases.delete(root) },
  }
}
