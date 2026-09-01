/**
 * Temporary development-only SMTP verification.
 *
 * Usage (from server/):
 *   npm run smtp:verify
 *
 * Calls transporter.verify() and reports success or failure.
 * Does not print EMAIL_PASSWORD or any secret.
 * Do not expose this as a public HTTP route.
 *
 * Remove this script after SMTP auth is confirmed (see SMTP_SETUP.md).
 */

require("dotenv").config();

const transporter = require("../src/config/mail");
const { getMailAuthMeta } = require("../src/config/mail");

async function verifySmtp() {
  const meta = getMailAuthMeta();

  console.log("=== SMTP verification (development only) ===");
  console.log(`NODE_ENV: ${process.env.NODE_ENV || "undefined"}`);
  console.log(`EMAIL_USER configured: ${meta.userConfigured ? "yes" : "no"}`);
  console.log(`EMAIL_PASSWORD configured: ${meta.passwordConfigured ? "yes" : "no"}`);
  if (meta.userDomain) {
    console.log(`EMAIL_USER domain: ${meta.userDomain}`);
  }
  console.log("Host: smtp.gmail.com:465 (secure)");
  console.log("");

  if (!meta.userConfigured || !meta.passwordConfigured) {
    console.error("SMTP authentication failed");
    console.error("Reason: EMAIL_USER and EMAIL_PASSWORD must both be set in server/.env");
    process.exitCode = 1;
    return;
  }

  try {
    await transporter.verify();
    console.log("SMTP connection/authentication successful");
  } catch (error) {
    console.error("SMTP authentication failed");
    console.error(`Code: ${error.code || "unknown"}`);
    console.error(`Command: ${error.command || "n/a"}`);
    console.error(`Message: ${error.message || "unknown error"}`);
    console.error("");
    console.error("Hints:");
    console.error("- Use a Gmail App Password, not your normal Gmail login password.");
    console.error("- Enable 2-Step Verification, then create an App Password in Google Account.");
    console.error("- Set EMAIL_USER and EMAIL_PASSWORD in server/.env (no hardcoded secrets).");
    console.error("- See SMTP_SETUP.md for steps.");
    process.exitCode = 1;
  }
}

verifySmtp();
