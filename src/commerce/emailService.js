const nodemailer = require('nodemailer');
const db = require('../database/database');

function smtpConfigured() {
  return !!(process.env.BREVO_SMTP_LOGIN && process.env.BREVO_SMTP_KEY && process.env.EMAIL_FROM);
}

function transport() {
  return nodemailer.createTransport({
    host: process.env.BREVO_SMTP_HOST || 'smtp-relay.brevo.com',
    port: Number(process.env.BREVO_SMTP_PORT || 587), secure: false,
    auth: { user: process.env.BREVO_SMTP_LOGIN, pass: process.env.BREVO_SMTP_KEY },
  });
}

async function runEmailWorker() {
  if (!smtpConfigured()) return { skipped: true, reason: 'smtp_not_configured' };
  const jobs = await db.getQuery("SELECT * FROM email_jobs WHERE status IN ('pending','retry') AND attempts < 5 AND next_attempt_at <= ? ORDER BY created_at LIMIT 10", [new Date().toISOString()]);
  for (const job of jobs) {
    const claimed = await db.runQuery("UPDATE email_jobs SET status='sending', attempts=attempts+1 WHERE id=? AND status IN ('pending','retry')", [job.id]);
    if (!claimed.changes) continue;
    try {
      await transport().sendMail({ from: process.env.EMAIL_FROM, to: job.recipient, subject: job.subject, text: job.body });
      await db.runQuery("UPDATE email_jobs SET status='sent', sent_at=?, last_error=NULL WHERE id=?", [new Date().toISOString(), job.id]);
    } catch (error) {
      const attempts = job.attempts + 1;
      const status = attempts >= 5 ? 'failed' : 'retry';
      const next = new Date(Date.now() + Math.min(60, 2 ** attempts) * 60_000).toISOString();
      await db.runQuery('UPDATE email_jobs SET status=?, next_attempt_at=?, last_error=? WHERE id=?', [status, next, String(error.message).slice(0, 300), job.id]);
    }
  }
  return { processed: jobs.length };
}

module.exports = { runEmailWorker, smtpConfigured };
