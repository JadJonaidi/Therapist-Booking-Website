// scripts/booking.js
// Connects to your API and supports service filtering + day navigation

// Elements
const slotGrid = document.querySelector('#slotGrid');
const slotIdInput = document.querySelector('#slotIdInput');
const selectedSlotLabel = document.querySelector('#selectedSlotLabel');
const bookingForm = document.querySelector('#bookingForm');
const bookMsg = document.querySelector('#bookMsg');

// Filters
const serviceTypeSel = document.querySelector('#serviceType');
const slotDateInput = document.querySelector('#slotDate');
const prevDayBtn = document.querySelector('#prevDay');
const nextDayBtn = document.querySelector('#nextDay');
const todayBtn   = document.querySelector('#todayBtn');
const dateNote   = document.querySelector('#dateNote');

// Utils
const pad = n => String(n).padStart(2, '0');
const toDateInputValue = (d) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

const fmtSlot = (sIso, eIso) => {
  const s = new Date(sIso), e = new Date(eIso);
  const date = s.toLocaleDateString(undefined, { weekday:'short', month:'short', day:'numeric' });
  const st = s.toLocaleTimeString(undefined, { hour:'numeric', minute:'2-digit' });
  const et = e.toLocaleTimeString(undefined, { hour:'numeric', minute:'2-digit' });
  return `${date} • ${st}–${et}`;
};

// Default duration by service (frontend hint; backend enforces too)
const minsByType = { individual: 50, couple: 75, extended: 90 };

async function loadSlotsForDate(dateStr) {
  if (!slotGrid) return;
  slotGrid.innerHTML = '<p class="muted">Loading available times…</p>';

  try {
    const type = serviceTypeSel?.value || 'individual';
    const min = minsByType[type] || 50;

    const r = await fetch(`/api/slots?from=${encodeURIComponent(dateStr)}&days=1&type=${encodeURIComponent(type)}&min=${min}`);
    const slots = await r.json();

    const d = new Date(`${dateStr}T00:00:00`);
    dateNote.textContent = d.toLocaleDateString(undefined, {
      weekday:'long', month:'long', day:'numeric', year:'numeric'
    });

    if (!Array.isArray(slots) || slots.length === 0) {
      slotGrid.innerHTML = '<p class="muted">No open times on this day. Try another date or service.</p>';
      return;
    }

    slotGrid.innerHTML = '';
    slots.forEach(slot => {
      const card = document.createElement('article');
      card.className = 'card glass';
      card.style.cursor = 'pointer';
      const label = `${slot.duration_minutes || min}m • ${slot.service_type || type}`;
      card.innerHTML = `
        <div class="card-body">
          <h3 style="margin:0 0 4px;">${label}</h3>
          <p class="muted" style="margin:0 0 8px;">${fmtSlot(slot.starts_at, slot.ends_at)}</p>
          <div class="actions"><span class="btn-outline">Select</span></div>
        </div>
      `;
      card.addEventListener('click', () => {
        slotIdInput.value = slot.id;
        selectedSlotLabel.value = fmtSlot(slot.starts_at, slot.ends_at);
        [...slotGrid.children].forEach(el => el.classList.remove('selected'));
        card.classList.add('selected');
        bookMsg.textContent = ''; // clear any message
        bookMsg.className = 'notice';
      });
      slotGrid.appendChild(card);
    });
  } catch (e) {
    slotGrid.innerHTML = `<p class="notice error">Error loading slots.</p>`;
  }
}

// Init date picker
(function initDatePicker(){
  if (!slotDateInput) return;
  const today = new Date();
  slotDateInput.value = toDateInputValue(today);

  slotDateInput.addEventListener('change', () => {
    if (!slotDateInput.value) return;
    loadSlotsForDate(slotDateInput.value);
  });

  prevDayBtn?.addEventListener('click', () => {
    const d = new Date(`${slotDateInput.value}T00:00:00`);
    d.setDate(d.getDate() - 1);
    slotDateInput.value = toDateInputValue(d);
    loadSlotsForDate(slotDateInput.value);
  });

  nextDayBtn?.addEventListener('click', () => {
    const d = new Date(`${slotDateInput.value}T00:00:00`);
    d.setDate(d.getDate() + 1);
    slotDateInput.value = toDateInputValue(d);
    loadSlotsForDate(slotDateInput.value);
  });

  todayBtn?.addEventListener('click', () => {
    const t = new Date();
    slotDateInput.value = toDateInputValue(t);
    loadSlotsForDate(slotDateInput.value);
  });

  // re-filter when service changes
  serviceTypeSel?.addEventListener('change', () => {
    if (slotDateInput?.value) loadSlotsForDate(slotDateInput.value);
  });

  // first load
  loadSlotsForDate(slotDateInput.value);
})();

// Submit booking
bookingForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  bookMsg.className = 'notice';
  if (!slotIdInput.value) { bookMsg.textContent = 'Please select a time.'; return; }

  const payload = Object.fromEntries(new FormData(bookingForm).entries());

  bookMsg.textContent = 'Booking…';
  try {
    const r = await fetch('/api/book', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(payload)
    });
    const out = await r.json();
    if (!r.ok) {
      bookMsg.textContent = out.error || 'Could not book. Try another slot.';
      bookMsg.classList.add('error'); return;
    }
    bookMsg.textContent = 'Booked! We’ll email you shortly.';
    bookMsg.classList.add('ok');

    // reset + reload selected day to remove the booked slot
    bookingForm.reset();
    selectedSlotLabel.value = '';
    slotIdInput.value = '';
    loadSlotsForDate(slotDateInput.value);
  } catch {
    bookMsg.textContent = 'Network error. Please try again.';
    bookMsg.classList.add('error');
  }
});
