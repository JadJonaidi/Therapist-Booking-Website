import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nanoid } from 'nanoid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const dbPath = path.join(projectRoot, 'data.sqlite');
console.log('[DB] Using SQLite file at:', dbPath);

const db = new Database(dbPath);

// ----- Schema -----
db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS availability (
    id TEXT PRIMARY KEY,
    starts_at TEXT NOT NULL,      -- ISO UTC
    ends_at   TEXT NOT NULL,      -- ISO UTC
    is_active INTEGER NOT NULL DEFAULT 1,
    duration_minutes INTEGER NOT NULL DEFAULT 50,
    service_type TEXT NOT NULL DEFAULT 'individual'
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY,
    slot_id TEXT NOT NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    note TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(slot_id) REFERENCES availability(id) ON DELETE RESTRICT
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_slot ON bookings(slot_id);
  CREATE INDEX IF NOT EXISTS idx_availability_future
    ON availability(starts_at) WHERE is_active = 1;
`);

// Add columns for older DBs (ignore errors if they already exist)
try { db.exec(`ALTER TABLE availability ADD COLUMN duration_minutes INTEGER NOT NULL DEFAULT 50;`); } catch {}
try { db.exec(`ALTER TABLE availability ADD COLUMN service_type TEXT NOT NULL DEFAULT 'individual';`); } catch {}

// ----- Helpers -----
export function insertSlot({ id = nanoid(), starts_at, ends_at, is_active = 1, duration_minutes = 50, service_type = 'individual' }) {
  db.prepare(`
    INSERT INTO availability (id, starts_at, ends_at, is_active, duration_minutes, service_type)
    VALUES (@id, @starts_at, @ends_at, @is_active, @duration_minutes, @service_type)
  `).run({ id, starts_at, ends_at, is_active, duration_minutes, service_type });
  return id;
}

export function listOpenSlots(fromIso, toIso, serviceType = null, minDuration = null) {
  let sql = `
    SELECT id, starts_at, ends_at, duration_minutes, service_type
    FROM availability
    WHERE is_active = 1 AND starts_at >= @fromIso AND starts_at < @toIso
  `;
  const params = { fromIso, toIso };

  if (serviceType) { sql += ` AND service_type = @serviceType`; params.serviceType = serviceType; }
  if (minDuration) { sql += ` AND duration_minutes >= @minDuration`; params.minDuration = minDuration; }
  sql += ` ORDER BY starts_at ASC`;

  const slots = db.prepare(sql).all(params);
  if (slots.length === 0) return [];

  const ids = slots.map(s => s.id);
  const placeholders = ids.map(() => '?').join(',');
  const booked = db.prepare(`SELECT slot_id FROM bookings WHERE slot_id IN (${placeholders})`).all(ids);
  const bookedSet = new Set(booked.map(b => b.slot_id));
  return slots.filter(s => !bookedSet.has(s.id));
}

export function bookSlot({ slot_id, name, email, phone = '', note = '' }) {
  const nowIso = new Date().toISOString();
  const tx = db.transaction(() => {
    const slot = db.prepare(`SELECT id, starts_at, ends_at, is_active FROM availability WHERE id = ?`).get(slot_id);
    if (!slot || slot.is_active !== 1) throw new Error('Slot not available');
    if (new Date(slot.starts_at) < new Date()) throw new Error('Slot is in the past');

    db.prepare(`
      INSERT INTO bookings (id, slot_id, name, email, phone, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(nanoid(), slot_id, name, email, phone, note, nowIso);

    return slot;
  });
  return tx();
}

// ----- Admin helpers -----
export function adminListSlots(fromIso, toIso) {
  return db.prepare(`
    SELECT id, starts_at, ends_at, is_active, duration_minutes, service_type
    FROM availability
    WHERE starts_at >= @fromIso AND starts_at < @toIso
    ORDER BY starts_at ASC
  `).all({ fromIso, toIso });
}

export function adminAddSlot({ starts_at, ends_at, duration_minutes = 50, service_type = 'individual', is_active = 1 }) {
  return insertSlot({ starts_at, ends_at, duration_minutes, service_type, is_active });
}

export function adminDeleteSlot(id) {
  // Only delete if not booked
  const booked = db.prepare(`SELECT 1 FROM bookings WHERE slot_id = ? LIMIT 1`).get(id);
  if (booked) throw new Error('Cannot delete: slot already booked');
  db.prepare(`DELETE FROM availability WHERE id = ?`).run(id);
  return true;
}
// ─── Overlap helper ───────────────────────
export function hasOverlap(starts_at, ends_at, bufferMinutes = 0) {
  // Expand window by buffer on both sides to enforce padding
  const startBuf = new Date(new Date(starts_at).getTime() - bufferMinutes * 60000)
    .toISOString().replace(/\.\d{3}Z$/, "Z");
  const endBuf = new Date(new Date(ends_at).getTime() + bufferMinutes * 60000)
    .toISOString().replace(/\.\d{3}Z$/, "Z");

  // Any active availability that intersects the buffered window?
  const row = db.prepare(`
    SELECT id FROM availability
    WHERE is_active = 1
      AND starts_at < @endBuf
      AND ends_at   > @startBuf
    LIMIT 1
  `).get({ startBuf, endBuf });

  return !!row;
}

export function adminListBookings(fromIso, toIso) {
  return db.prepare(`
    SELECT b.id, b.name, b.email, b.phone, b.note, b.created_at,
           a.starts_at, a.ends_at, a.service_type, a.duration_minutes, a.id as slot_id
    FROM bookings b
    JOIN availability a ON a.id = b.slot_id
    WHERE a.starts_at >= @fromIso AND a.starts_at < @toIso
    ORDER BY a.starts_at ASC
  `).all({ fromIso, toIso });
}
