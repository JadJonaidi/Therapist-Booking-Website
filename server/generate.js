// server/generate.js
// Loud version: prints every step so we know what's happening

import dotenv from "dotenv";
dotenv.config();

console.log("[GEN] Booting generator…");

import { adminAddSlot, hasOverlap } from "./db.js";

const BUFFER_MINUTES = parseInt(process.env.BUFFER_MINUTES || "10", 10);
const DAYS_AHEAD = 30;
const SLOT_LENGTHS = { individual: 50, couple: 75, extended: 90 };

// EDIT THIS to your weekly schedule:
const WEEKLY_SCHEDULE = {
  Monday:    [{ start: "10:00", end: "16:00", type: "individual" }],
  Tuesday:   [{ start: "10:00", end: "16:00", type: "individual" }],
  Wednesday: [{ start: "10:00", end: "16:00", type: "couple" }],
  Thursday:  [{ start: "10:00", end: "16:00", type: "individual" }],
  Friday:    [{ start: "10:00", end: "12:00", type: "extended" }],
};

const toISO = (d) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

function parseTimeToUtc(baseLocalDate, hhmm) {
  const [hh, mm] = hhmm.split(":").map(Number);
  const local = new Date(baseLocalDate);
  local.setHours(hh, mm, 0, 0);
  // convert local -> UTC ISO without milliseconds
  return new Date(local.getTime() - local.getTimezoneOffset() * 60000);
}

function* splitByDuration(dayLocalDate, startHHMM, endHHMM, minutes) {
  const start = parseTimeToUtc(dayLocalDate, startHHMM);
  const end = parseTimeToUtc(dayLocalDate, endHHMM);
  let cur = new Date(start);
  while (cur < end) {
    const nxt = new Date(cur.getTime() + minutes * 60000);
    if (nxt > end) break;
    yield { start: new Date(cur), end: new Date(nxt) };
    cur = nxt;
  }
}

async function generate() {
  try {
    console.log(`[GEN] BUFFER_MINUTES=${BUFFER_MINUTES}, DAYS_AHEAD=${DAYS_AHEAD}`);
    let added = 0, skipped = 0;

    const today = new Date();
    for (let i = 0; i < DAYS_AHEAD; i++) {
      const localDay = new Date(today);
      localDay.setDate(today.getDate() + i);

      const weekday = localDay.toLocaleDateString("en-US", { weekday: "long" });
      const blocks = WEEKLY_SCHEDULE[weekday];
      if (!blocks) continue;

      console.log(`[GEN] ${weekday}: generating (${blocks.length} block(s))`);
      for (const block of blocks) {
        const duration = SLOT_LENGTHS[block.type] || 50;
        for (const seg of splitByDuration(localDay, block.start, block.end, duration)) {
          const starts_at = toISO(seg.start);
          const ends_at   = toISO(seg.end);

          if (seg.start < new Date()) { skipped++; continue; }
          if (hasOverlap(starts_at, ends_at, BUFFER_MINUTES)) { skipped++; continue; }

          try {
            const id = adminAddSlot({
              starts_at,
              ends_at,
              duration_minutes: duration,
              service_type: block.type,
              is_active: 1
            });
            console.log(`[GEN]   + added ${weekday} ${starts_at} → id ${id}`);
            added++;
          } catch (err) {
            console.warn("[GEN]   ! duplicate/failed:", err.message);
            skipped++;
          }
        }
      }
    }

    console.log(`[GEN] ✅ Done. Added=${added}, Skipped=${skipped}`);
  } catch (e) {
    console.error("[GEN] ❌ Error:", e);
    process.exitCode = 1;
  }
}

generate();
