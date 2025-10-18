import express from 'express';
import cors from 'cors';
import { sendBookingEmails } from "./email.js";
import { adminListSlots } from "./db.js"; // if not already imported
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import {
  listOpenSlots, bookSlot,
  adminListSlots, adminAddSlot, adminDeleteSlot, adminListBookings
} from './db.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'changeme';

app.use(cors());
app.use(express.json());
app.use(express.static('.')); // serves your site

app.use(rateLimit({ windowMs: 60_000, max: 100 }));

// ---------- Public API ----------
app.get('/api/slots', (req, res) => {
  try {
    const from = req.query.from ? new Date(`${req.query.from}T00:00:00Z`) : new Date();
    const days = Math.min(Math.max(parseInt(req.query.days || '14', 10), 1), 60);
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
  try {
    const { slot_id, name, email, phone = "", note = "" } = req.body || {};
    if (!slot_id || !name || !email)
      return res.status(400).json({ error: "Missing fields" });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      return res.status(400).json({ error: "Invalid email" });

    const slot = bookSlot({ slot_id, name, email, phone, note }); // throws on past/double
    res.status(201).json({ ok: true, slot });

    // Fire-and-forget email (do not block response)
    try {
      // we have slot fields, but ensure service_type/duration (bookSlot returns full row in your db.js; if not, fetch)
      const enrichedSlot = slot.service_type ? slot : adminListSlots(slot.starts_at, slot.ends_at)[0] || slot;
      const START_BUFFER_MIN = 30;
    const cutoff = new Date(new Date(slot.starts_at).getTime() - START_BUFFER_MIN * 60000);
    if (new Date() > cutoff) {
      return res.status(400).json({ error: `Too close to start time (${START_BUFFER_MIN}m cutoff)` });
    }

      await sendBookingEmails({ booking: { slot_id, name, email, phone, note }, slot: enrichedSlot });
    } catch (e) {
      console.error("[MAIL] Failed sending emails:", e.message);
    }
  } catch (e) {
    const msg = String(e.message || "");
    if (/unique|UNIQUE|idx_bookings_slot/.test(msg))
      return res.status(409).json({ error: "Slot already booked" });
    if (/Slot not available|past/.test(msg))
      return res.status(400).json({ error: msg });
    res.status(500).json({ error: "Server error" });
  }
});


// list slots (windowed)
app.get('/api/admin/slots', requireAdmin, (req, res) => {
  const from = req.query.from ? new Date(`${req.query.from}T00:00:00Z`) : new Date();
  const days = Math.min(Math.max(parseInt(req.query.days || '30', 10), 1), 180);
  const to = new Date(from); to.setUTCDate(from.getUTCDate() + days);
  const rows = adminListSlots(from.toISOString(), to.toISOString());
  res.json(rows);
});

// add slot
app.post('/api/admin/slots', requireAdmin, (req, res) => {
  try {
    const { date, startHHMM, duration_minutes = 50, service_type = 'individual', is_active = 1 } = req.body || {};
    if (!date || !startHHMM) return res.status(400).json({ error: 'date and startHHMM required' });

    // Convert local date+time to UTC ISO
    const local = new Date(`${date}T${startHHMM}:00`);
    const starts_at = new Date(local.getTime() - local.getTimezoneOffset()*60000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const ends_at = new Date(new Date(starts_at).getTime() + (parseInt(duration_minutes,10)||50)*60000)
      .toISOString().replace(/\.\d{3}Z$/, 'Z');

    const id = adminAddSlot({ starts_at, ends_at, duration_minutes: parseInt(duration_minutes,10)||50, service_type, is_active: is_active?1:0 });
    res.status(201).json({ ok: true, id, starts_at, ends_at });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// delete slot (only if not booked)
app.delete('/api/admin/slots/:id', requireAdmin, (req, res) => {
  try {
    adminDeleteSlot(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// list bookings
app.get('/api/admin/bookings', requireAdmin, (req, res) => {
  const from = req.query.from ? new Date(`${req.query.from}T00:00:00Z`) : new Date(new Date().getTime()-7*86400000);
  const days = Math.min(Math.max(parseInt(req.query.days || '60', 10), 1), 365);
  const to = new Date(from); to.setUTCDate(from.getUTCDate() + days);
  const rows = adminListBookings(from.toISOString(), to.toISOString());
  res.json(rows);
});

app.listen(PORT, () => console.log(`Booking API on http://localhost:${PORT}`));
