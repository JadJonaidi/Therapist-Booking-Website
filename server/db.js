// server/db.js
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DB_FILE = path.resolve(process.cwd(), "data.sqlite");
console.log("[DB] Using SQLite file at:", DB_FILE);

const firstTime = !fs.existsSync(DB_FILE);
export const db = new Database(DB_FILE);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ---------- Schema ----------
db.exec(`
CREATE TABLE IF NOT EXISTS availability (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  starts_at TEXT NOT NULL,              -- ISO UTC, e.g. 2025-10-19T12:00:00Z
  ends_at   TEXT NOT NULL,              -- ISO UTC
  duration_minutes INTEGER NOT NULL,    -- derived or explicit
  service_type TEXT NOT NULL DEFAULT 'individual',
  is_active INTEGER NOT NULL DEFAULT 1  -- 1 active, 0 hidden
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slot_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT DEFAULT '',
  note TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY(slot_id) REFERENCES availability(id) ON DELETE CASCADE
);

-- one booking per slot
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_slot ON bookings(slot_id);

-- fast lookups
CREATE INDEX IF NOT EXISTS idx_avail_start ON availability(starts_at);
CREATE INDEX IF NOT EXISTS idx_avail_active ON availability(is_active);
`);

// ---------- Helpers ----------
export function iso(x) {
  // Normalize to canonical Z format without ms
  return new Date(x).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function getSlotById(id) {
  return db.prepare(`
    SELECT id, starts_at, ends_at, duration_minutes, service_type, is_active
    FROM availability
    WHERE id = ?
  `).get(id);
}

/**
 * Overlap check for adding new availability (admin path).
 * Uses optional "bufferMinutes" that expands existing windows by +/- buffer.
 */
export function hasOverlap(starts_at, ends_at, bufferMinutes = 0) {
  const s = new Date(starts_at).getTime();
  const e = new Date(ends_at).getTime();
  const buf = Math.max(0, parseInt(bufferMinutes || 0, 10)) * 60000;

  const rows = db.prepare(`
    SELECT id, starts_at, ends_at
    FROM availability
    WHERE is_active = 1
      AND (
        (strftime('%s', starts_at) <= strftime('%s', @e) + @buf/1000)
        AND (strftime('%s', ends_at)   >= strftime('%s', @s) - @buf/1000)
      )
  `).all({ s: iso(starts_at), e: iso(ends_at), buf });

  return rows.length > 0;
}

/**
 * Return only *bookable* open slots in [from,to], optionally filter by service and min duration.
 * Adds computed `reason_unavailable` if something is wrong (so UI can gray out).
 */
export function listOpenSlots(fromIso, toIso, serviceType = null, minDuration = null, opts = {}) {
  const now = new Date();
  const bufferMinutes = parseInt(process.env.BUFFER_MINUTES || "10", 10);
  const bufferMs = bufferMinutes * 60000;

  const rows = db.prepare(`
    SELECT a.id, a.starts_at, a.ends_at, a.duration_minutes, a.service_type, a.is_active,
           b.id AS booking_id
    FROM availability a
    LEFT JOIN bookings b ON b.slot_id = a.id
    WHERE a.starts_at >= @from AND a.starts_at < @to
      AND a.is_active = 1
    ORDER BY a.starts_at ASC
  `).all({ from: iso(fromIso), to: iso(toIso) });

  const filtered = rows
    .filter(r => (serviceType ? r.service_type === serviceType : true))
    .filter(r => (minDuration ? r.duration_minutes >= minDuration : true))
    .map(r => {
      const s = new Date(r.starts_at).getTime();
      const e = new Date(r.ends_at).getTime();

      let reason_unavailable = null;
      if (r.booking_id) reason_unavailable = "booked";
      else if (!r.is_active) reason_unavailable = "inactive";
      else if (s < now.getTime() + bufferMs) reason_unavailable = "too_soon";
      else if (e <= s) reason_unavailable = "bad_range";

      return {
        id: r.id,
        starts_at: iso(r.starts_at),
        ends_at: iso(r.ends_at),
        duration_minutes: r.duration_minutes,
        service_type: r.service_type,
        is_booked: !!r.booking_id,
        reason_unavailable,
        is_bookable: reason_unavailable === null
      };
    });

  // Only return bookable slots to the public API
  if (opts?.includeReasons) return filtered;
  return filtered.filter(x => x.is_bookable);
}

/**
 * Atomically create a booking for a slot if:
 *  - slot exists, active
 *  - not in the past
 *  - not within BUFFER_MINUTES from now
 *  - not already booked
 */
export function bookSlot({ slot_id, name, email, phone = "", note = "" }) {
  const BUFFER_MINUTES = parseInt(process.env.BUFFER_MINUTES || "10", 10);
  const bufferMs = BUFFER_MINUTES * 60000;
  const now = Date.now();

  return db.transaction(() => {
    const slot = db.prepare(`
      SELECT id, starts_at, ends_at, duration_minutes, service_type, is_active
      FROM availability
      WHERE id = ?
    `).get(slot_id);

    if (!slot) throw new Error("Slot not found");
    if (!slot.is_active) throw new Error("Slot not available");

    const s = new Date(slot.starts_at).getTime();
    const e = new Date(slot.ends_at).getTime();
    if (e <= s) throw new Error("Invalid slot range");
    if (s < now + bufferMs) throw new Error(`Slot not available (inside ${BUFFER_MINUTES}m buffer)`);
    if (s < now) throw new Error("Slot in the past");

    const existing = db.prepare(`SELECT 1 FROM bookings WHERE slot_id = ?`).get(slot.id);
    if (existing) throw new Error("Slot already booked");

    // Basic input sanity
    const cleanName = String(name || "").trim();
    const cleanEmail = String(email || "").trim();
    const cleanPhone = String(phone || "").trim();
    const cleanNote = String(note || "").trim();

    if (!cleanName) throw new Error("Name required");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) throw new Error("Invalid email");

    db.prepare(`
      INSERT INTO bookings (slot_id, name, email, phone, note)
      VALUES (@slot_id, @name, @email, @phone, @note)
    `).run({ slot_id: slot.id, name: cleanName, email: cleanEmail, phone: cleanPhone, note: cleanNote });

    // Return the enriched slot (used by emails)
    return {
      ...slot,
      starts_at: iso(slot.starts_at),
      ends_at: iso(slot.ends_at)
    };
  })();
}

// ---------- Admin reads ----------
export function adminListSlots(fromIso, toIso) {
  return db.prepare(`
    SELECT a.id, a.starts_at, a.ends_at, a.duration_minutes, a.service_type, a.is_active,
           (SELECT COUNT(1) FROM bookings b WHERE b.slot_id = a.id) AS booked_count
    FROM availability a
    WHERE a.starts_at >= @from AND a.starts_at < @to
    ORDER BY a.starts_at ASC
  `).all({ from: iso(fromIso), to: iso(toIso) });
}

export function adminAddSlot({ starts_at, ends_at, duration_minutes, service_type, is_active = 1 }) {
  // trust caller to have done UTC conversion; still normalize
  const s = iso(starts_at);
  const e = iso(ends_at);
  const dur = parseInt(duration_minutes, 10) || Math.max(5, Math.round((new Date(e) - new Date(s))/60000));
  const type = service_type || "individual";
  const act = is_active ? 1 : 0;

  const info = db.prepare(`
    INSERT INTO availability (starts_at, ends_at, duration_minutes, service_type, is_active)
    VALUES (@s, @e, @dur, @type, @act)
  `).run({ s, e, dur, type, act });
  return info.lastInsertRowid;
}

export function adminDeleteSlot(id) {
  const booked = db.prepare(`SELECT 1 FROM bookings WHERE slot_id = ?`).get(id);
  if (booked) throw new Error("Cannot delete: slot already booked");
  db.prepare(`DELETE FROM availability WHERE id = ?`).run(id);
}

// List bookings (window)
export function adminListBookings(fromIso, toIso) {
  return db.prepare(`
    SELECT b.id, b.slot_id, b.name, b.email, b.phone, b.note, b.created_at,
           a.starts_at, a.ends_at, a.duration_minutes, a.service_type
    FROM bookings b
    JOIN availability a ON a.id = b.slot_id
    WHERE a.starts_at >= @from AND a.starts_at < @to
    ORDER BY a.starts_at ASC
  `).all({ from: iso(fromIso), to: iso(toIso) });
}
