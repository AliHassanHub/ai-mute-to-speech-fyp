const nodemailer = require("nodemailer");

/**
 * Gmail SMTP credentials from environment only.
 * Never hardcode secrets here.
 *
 * Required:
 *   EMAIL_USER       — Gmail address
 *   EMAIL_PASSWORD   — Gmail App Password (not the account login password)
 *
 * Gmail App Passwords are often shown as "xxxx xxxx xxxx xxxx".
 * Spaces are stripped so either form works.
 */
function getMailAuth() {
  const user = String(process.env.EMAIL_USER || "").trim();
  const pass = String(process.env.EMAIL_PASSWORD || "").replace(/\s+/g, "");

  return { user, pass };
}

function getMailAuthMeta() {
  const { user, pass } = getMailAuth();
  return {
    userConfigured: Boolean(user),
    passwordConfigured: Boolean(pass),
    userDomain: user.includes("@") ? user.split("@")[1] : null,
  };
}

function createMailTransporter() {
  const { user, pass } = getMailAuth();

  if (!user || !pass) {
    console.warn(
      "[mail] EMAIL_USER or EMAIL_PASSWORD is missing. SMTP will fail until both are set in .env."
    );
  }

  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
      user,
      pass,
    },
  });
}

const transporter = createMailTransporter();

transporter.createMailTransporter = createMailTransporter;
transporter.getMailAuthMeta = getMailAuthMeta;

module.exports = transporter;
