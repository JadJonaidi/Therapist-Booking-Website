// server/test_email.js
import dotenv from "dotenv";
dotenv.config();
import { transporter } from "./email.js";

const { MAIL_FROM, THERAPIST_EMAIL } = process.env;

(async () => {
  try {
    await transporter.verify();
    console.log("SMTP OK: connection verified");

    const info = await transporter.sendMail({
      from: MAIL_FROM,
      to: THERAPIST_EMAIL,
      subject: "Test email from booking system",
      text: "If you see this, SMTP creds are working. 🎉",
    });

    console.log("Sent test email. MessageId:", info.messageId);
    process.exit(0);
  } catch (e) {
    console.error("SMTP ERROR:", e);
    process.exit(1);
  }
})();
