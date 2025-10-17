console.log('>>> seed.js starting NOW');

import { insertSlot } from './db.js';

function toUtcIso(localDateStr, localTimeHHMM) {
  const local = new Date(`${localDateStr}T${localTimeHHMM}:00`);
  return new Date(local.getTime() - local.getTimezoneOffset() * 60000)
    .toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function addSlot(date, startHHMM, minutes = 50) {
  const starts_at = toUtcIso(date, startHHMM);
  const ends_at = new Date(new Date(starts_at).getTime() + minutes * 60000)
    .toISOString().replace(/\.\d{3}Z$/, 'Z');
  const id = insertSlot({ starts_at, ends_at, is_active: 1 });
  console.log('  added slot:', id, starts_at, '→', ends_at);
}

try {
  console.log('Seeding sample slots…');
  // Edit these to your real times if you want
  addSlot('2025-10-20', '10:00');
  addSlot('2025-10-20', '11:00');
  addSlot('2025-10-21', '14:00');
  addSlot('2025-10-21', '15:00');
  console.log('Done. If you do not see data.sqlite, check the [DB] log line above for path.');
} catch (e) {
  console.error('Seed failed:', e);
  process.exit(1);
}
