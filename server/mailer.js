const nodemailer = require('nodemailer');

function isConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

async function sendReport({ toEmail, propertyName, pdfPath }) {
  if (!isConfigured()) {
    return { sent: false, reason: 'SMTP not configured — report saved locally instead.' };
  }

  const transport = getTransport();
  await transport.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: toEmail,
    subject: `Changeover clean report — ${propertyName}`,
    text: `Attached is the timestamped clean report for ${propertyName}.`,
    attachments: [{ filename: 'clean-report.pdf', path: pdfPath }],
  });

  return { sent: true };
}

module.exports = { sendReport, isConfigured };
