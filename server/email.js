// server/email.js
import dotenv from "dotenv";
import nodemailer from "nodemailer";
dotenv.config();

const {
  SMTP_HOST, SMTP_PORT, SMTP_SECURE,
  SMTP_USER, SMTP_PASS, MAIL_FROM,
  THERAPIST_EMAIL, BASE_URL
} = process.env;

export const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: Number(SMTP_PORT || 465),
  secure: String(SMTP_SECURE || "true") === "true",
  auth: { user: SMTP_USER, pass: SMTP_PASS },
});

function isoToICS(iso) {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function buildICS({ starts_at, ends_at, summary, description, location }) {
  const now = isoToICS(new Date().toISOString());
  const dtStart = isoToICS(starts_at);
  const dtEnd   = isoToICS(ends_at);
  const uid = `bk-${Date.now()}-${Math.random().toString(16).slice(2)}@booking`;
  const esc = (s) => (s || "").replace(/\n/g, "\\n");

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Therapist Booking//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${esc(summary)}`,
    `DESCRIPTION:${esc(description)}`,
    location ? `LOCATION:${esc(location)}` : "",
    "END:VEVENT",
    "END:VCALENDAR"
  ].filter(Boolean).join("\r\n");
}

// server/email.js (replace sendBookingEmails function)
export async function sendBookingEmails({ booking, slot }) {
  const svc = slot?.service_type || "session";
  const duration =
    slot?.duration_minutes ??
    Math.max(5, Math.round((new Date(slot.ends_at) - new Date(slot.starts_at)) / 60000));

  const when = new Date(slot.starts_at).toLocaleString(undefined, {
    weekday: "long", month: "long", day: "numeric",
    hour: "numeric", minute: "2-digit"
  });

  const ics = buildICS({
    starts_at: slot.starts_at,
    ends_at: slot.ends_at,
    summary: "Therapy Session",
    description:
`Client: ${booking?.name || "—"}
Email: ${booking?.email || "—"}
Phone: ${booking?.phone || "—"}
Notes: ${booking?.note || "—"}`,
    location: "Office / Online",
  });

  const toClient = (booking?.email || "").trim();
  const toTherapist = (process.env.THERAPIST_EMAIL || "").trim();
  const fromAddr = (process.env.MAIL_FROM || process.env.SMTP_USER || "").trim();

  console.log("[MAIL][DEBUG] from:", fromAddr);
  console.log("[MAIL][DEBUG] toClient:", toClient);
  console.log("[MAIL][DEBUG] toTherapist:", toTherapist);

  // Send to client
  if (toClient) {
    await transporter.sendMail({
      from: fromAddr,
      to: toClient,
      replyTo: toTherapist || undefined,
      subject: `Your session is booked — ${when}`,
      text:
`Hi ${booking.name},

Your session is booked for ${when}.

Details:
- Service: ${svc} (${duration} minutes)
- Notes: ${booking.note || "—"}

If you need to make changes, just reply to this email.

— Your Practice
${process.env.BASE_URL || ""}`,
      icalEvent: { method: "PUBLISH", content: ics },
    });
    console.log("[MAIL] Sent client confirmation");
  } else {
    console.warn("[MAIL] Skipped client email: booking.email missing/empty.");
  }

  // Send to therapist
  if (toTherapist) {
    await transporter.sendMail({
      from: fromAddr,
      to: toTherapist,
      subject: `New booking: ${booking?.name || "—"} — ${when}`,
      text:
`New booking:

Client: ${booking?.name || "—"}
Email: ${booking?.email || "—"}
Phone: ${booking?.phone || "—"}
Service: ${svc} (${duration}m)
When: ${when}
Notes: ${booking?.note || "—"}

Slot ID: ${booking?.slot_id || "—"}`,
      icalEvent: { method: "PUBLISH", content: ics },
    });
    console.log("[MAIL] Sent therapist notification");
  } else {
    console.warn("[MAIL] Skipped therapist email: THERAPIST_EMAIL missing/empty.");
  }

  console.log("[MAIL] Email send attempt finished.");
}