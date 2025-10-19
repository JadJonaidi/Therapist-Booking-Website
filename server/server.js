// server/server.js
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import {
  listOpenSlots, bookSlot,
  adminListSlots, adminAddSlot, adminDeleteSlot, adminListBookings,
  hasOverlap, getSlotById
} from "./db.js";
import { sendBookingEmails } from "./email.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || "changeme";
const BUFFER_MINUTES = parseInt(process.env.BUFFER_MINUTES || "10", 10);
const MAX_ADVANCE_DAYS = parseInt(process.env.MAX_ADVANCE_DAYS || "120", 10);

app.use(cors());
app.use(express.json());
app.use(express.static("."));
app.use(rateLimit({ windowMs: 60_000, max: 100 }));

// Show key envs at boot (sanity)
console.log("[ENV][DEBUG] MAIL_FROM =", process.env.MAIL_FROM);
console.log("[ENV][DEBUG] THERAPIST_EMAIL =", process.env.THERAPIST_EMAIL);

// ---------- Admin guard (define BEFORE admin routes) ----------
function requireAdmin(req, res, next) {
  const key = req.header("x-admin-key");
  if (!key || key !== ADMIN_KEY) return res.status(401).json({ error: "Unauthorized" });
  next();
}

// ---------- Public API ----------
app.get("/api/slots", (req, res) => {
  try {
    const from = req.query.from ? new Date(`${req.query.from}T00:00:00Z`) : new Date();
    const days = Math.min(Math.max(parseInt(req.query.days || "14", 10), 1), 60);
    const to = new Date(from); to.setUTCDate(from.getUTCDate() + days);

    const serviceType = req.query.type || null;        // optional filter
    const minDuration = req.query.min ? parseInt(req.query.min, 10) || null : null;

    const open = listOpenSlots(from.toISOString(), to.toISOString(), serviceType, minDuration);
    res.json(open);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/book", async (req, res) => {
  console.log("[BOOK][DEBUG] req.body =", req.body);
  try {
    const { slot_id, name, email, phone = "", note = "" } = req.body || {};
    if (!slot_id || !name || !email) return res.status(400).json({ error: "Missing fields" });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: "Invalid email" });

    // Book in DB
    const slot = bookSlot({ slot_id, name, email, phone, note });
    res.status(201).json({ ok: true, slot });

    // Send emails (don’t block response)
    try {
      const fullSlot = getSlotById(slot_id) || slot;
      await sendBookingEmails({
        booking: { slot_id, name, email, phone, note },
        slot: fullSlot
      });
    } catch (e) {
      console.error("[MAIL] Failed to send booking emails:", e);
    }
  } catch (e) {
    const msg = String(e.message || "");
    if (/unique|UNIQUE|idx_bookings_slot/.test(msg)) return res.status(409).json({ error: "Slot already booked" });
    if (/Slot not available|past/.test(msg)) return res.status(400).json({ error: msg });
    res.status(500).json({ error: "Server error" });
  }
});

// ---------- Admin API (protected) ----------
app.get("/api/admin/slots", requireAdmin, (req, res) => {
  try {
    const from = req.query.from ? new Date(`${req.query.from}T00:00:00Z`) : new Date();
    const days = Math.min(Math.max(parseInt(req.query.days || "30", 10), 1), 180);
    const to = new Date(from); to.setUTCDate(from.getUTCDate() + days);
    const rows = adminListSlots(from.toISOString(), to.toISOString());
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/admin/slots", requireAdmin, (req, res) => {
  try {
    const { date, startHHMM, duration_minutes = 50, service_type = "individual", is_active = 1 } = req.body || {};
    if (!date || !startHHMM) return res.status(400).json({ error: "date and startHHMM required" });

    // Convert local date+time to UTC ISO
    const local = new Date(`${date}T${startHHMM}:00`);
    const starts_at = new Date(local.getTime() - local.getTimezoneOffset()*60000).toISOString().replace(/\.\d{3}Z$/, "Z");
    const duration = parseInt(duration_minutes, 10) || 50;
    const ends_at = new Date(new Date(starts_at).getTime() + duration*60000).toISOString().replace(/\.\d{3}Z$/, "Z");

    // Sanity checks
    const now = new Date();
    if (new Date(starts_at) < now) return res.status(400).json({ error: "Cannot add slots in the past" });
    const max = new Date(now); max.setUTCDate(now.getUTCDate() + MAX_ADVANCE_DAYS);
    if (new Date(starts_at) > max) return res.status(400).json({ error: `Cannot add slots beyond ${MAX_ADVANCE_DAYS} days` });

    if (hasOverlap(starts_at, ends_at, BUFFER_MINUTES))
      return res.status(409).json({ error: `Overlaps existing availability (buffer ${BUFFER_MINUTES}m)` });

    const id = adminAddSlot({ starts_at, ends_at, duration_minutes: duration, service_type, is_active: is_active?1:0 });
    res.status(201).json({ ok: true, id, starts_at, ends_at });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/admin/slots/:id", requireAdmin, (req, res) => {
  try {
    adminDeleteSlot(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/admin/bookings", requireAdmin, (req, res) => {
  try {
    const from = req.query.from ? new Date(`${req.query.from}T00:00:00Z`) :
      new Date(new Date().getTime()-7*86400000);
    const days = Math.min(Math.max(parseInt(req.query.days || "60", 10), 1), 365);
    const to = new Date(from); to.setUTCDate(from.getUTCDate() + days);
    const rows = adminListBookings(from.toISOString(), to.toISOString());
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`✅ Booking API running on http://localhost:${PORT}`));
