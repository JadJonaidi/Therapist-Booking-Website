import nodemailer from "nodemailer";
// server/email.js
import nodemailer from "nodemailer";
import dotenv from "dotenv";
dotenv.config();

const {
  SMTP_HOST, SMTP_PORT, SMTP_SECURE,
  SMTP_USER, SMTP_PASS, MAIL_FROM,
} = process.env;

if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
  console.warn("[MAIL] Missing SMTP env; emails will fail to send.");
}

export const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: Number(SMTP_PORT || 465),
  secure: String(SMTP_SECURE || "true") === "true",
  auth: { user: SMTP_USER, pass: SMTP_PASS },
});

export async function sendMail(opts) {
  const info = await transporter.sendMail({
    from: MAIL_FROM,
    ...opts,
  });
  return info;
}


function createTransport() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || "465", 10);
  const secure = String(process.env.SMTP_SECURE || "true") === "true";
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    console.warn("[MAIL] Missing SMTP env; emails will be skipped.");
    return null;
  }

  return nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
}

function toICS({ starts_at, ends_at, summary, description, location }) {
  const dt = (iso) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const uid = `bk-${Date.now()}-${Math.random().toString(16).slice(2)}@your-site`;
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Your Practice//Booking//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${dt(new Date().toISOString())}`,
    `DTSTART:${dt(starts_at)}`,
    `DTEND:${dt(ends_at)}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${(description || "").replace(/\n/g, "\\n")}`,
    location ? `LOCATION:${location}` : "",
    "END:VEVENT",
    "END:VCALENDAR"
  ].filter(Boolean).join("\r\n");
}

export async function sendBookingEmails({ booking, slot }) {
  const transporter = createTransport();
  if (!transporter) {
    console.log("[MAIL] Skipped sending (no transport). Details:", { booking, slot });
    return;
  }

  const from = process.env.MAIL_FROM || process.env.SMTP_USER;
  const therapist = process.env.THERAPIST_EMAIL || process.env.SMTP_USER;
  const base = process.env.BASE_URL || "http://localhost:3000";

  const when = new Date(slot.starts_at).toLocaleString(undefined, {
    weekday: "long", month: "long", day: "numeric",
    hour: "numeric", minute: "2-digit"
  });

  const subjectClient = `Your session is booked — ${when}`;
  const subjectTherapist = `New booking: ${booking.name} — ${when}`;

  const ics = toICS({
    starts_at: slot.starts_at,
    ends_at: slot.ends_at,
    summary: "Therapy Session",
    description: `Client: ${booking.name}\nEmail: ${booking.email}\nPhone: ${booking.phone || ""}\nNotes: ${booking.note || ""}`,
    location: "Office / Online (set in email)"
  });

  // email to client
  await transporter.sendMail({
    from,
    to: booking.email,
    subject: subjectClient,
    text:
`Hi ${booking.name},

Your session is booked for ${when}.

Details:
- Service: ${slot.service_type} (${slot.duration_minutes}m)
- Notes: ${booking.note || "—"}

If you need to make changes, reply to this email.

— Your Practice
${base}`,
    icalEvent: { method: "PUBLISH", content: ics }
  });

  // email to therapist
  await transporter.sendMail({
    from,
    to: therapist,
    subject: subjectTherapist,
    text:
`New booking:

Client: ${booking.name}
Email: ${booking.email}
Phone: ${booking.phone || "—"}
Service: ${slot.service_type} (${slot.duration_minutes}m)
When: ${when}
Notes: ${booking.note || "—"}

Slot ID: ${booking.slot_id}
`,
    icalEvent: { method: "PUBLISH", content: ics }
  });

  console.log("[MAIL] Sent booking emails → client & therapist");
}
