import nodemailer from 'nodemailer';

const SMTP_HOST = process.env.SMTP_HOST || 'mail.mbuyucfl.com';
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_USER = process.env.SMTP_USER || 'noreply@mbuyucfl.com';
const SMTP_PASS = process.env.SMTP_PASS || '';

const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_PORT === 465, // true for 465, false for 587
  auth: {
    user: SMTP_USER,
    pass: SMTP_PASS,
  },
});

const FROM = `"Mbuyu CFL" <${SMTP_USER}>`;

// ─── Core send function ────────────────────────────────────
async function sendMail(to: string | string[], subject: string, html: string) {
  if (!SMTP_PASS) {
    console.warn('[mailer] SMTP_PASS not set — skipping send:', subject);
    return;
  }
  try {
    await transporter.sendMail({
      from: FROM,
      to: Array.isArray(to) ? to.join(',') : to,
      subject,
      html,
    });
  } catch (err) {
    console.error('[mailer] send failed:', err);
  }
}

// ─── Maintenance alert — sent when a checklist is flagged ──
export async function sendMaintenanceAlert(opts: {
  driverName: string;
  vehiclePlate: string;
  checklistId: string;
  issues: string[];
  notes?: string | null;
}) {
  const recipients = (
    process.env.MAINTENANCE_ALERT_EMAILS ||
    'operations@mbuyucfl.com'
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const issuesList = opts.issues
    .map((i) => `<li>${i}</li>`)
    .join('');

  await sendMail(
    recipients,
    `🚨 Vehicle issue flagged: ${opts.vehiclePlate}`,
    `
      <div style="font-family: Inter, Arial, sans-serif; max-width: 600px;">
        <h2 style="color:#E85D04;">Vehicle Inspection Alert</h2>
        <p><strong>Driver:</strong> ${opts.driverName}</p>
        <p><strong>Vehicle:</strong> ${opts.vehiclePlate}</p>
        <p><strong>Issues found:</strong></p>
        <ul>${issuesList}</ul>
        ${opts.notes ? `<p><strong>Notes:</strong> ${opts.notes}</p>` : ''}
        <p style="margin-top:20px;">
          <a href="https://app.mbuyucfl.com/operations/maintenance"
             style="background:#E85D04;color:#fff;padding:10px 20px;
                    text-decoration:none;border-radius:6px;">
            Open Maintenance Queue
          </a>
        </p>
        <p style="font-size:12px;color:#888;margin-top:30px;">
          Checklist ID: ${opts.checklistId}
        </p>
      </div>
    `
  );
}

// ─── Checklist cleared — sent when ops finishes repairs ───
export async function sendChecklistCleared(opts: {
  driverEmail: string;
  driverName: string;
  vehiclePlate: string;
  checklistId: string;
}) {
  await sendMail(
    opts.driverEmail,
    `✅ Vehicle ${opts.vehiclePlate} cleared — you can start the journey`,
    `
      <div style="font-family: Inter, Arial, sans-serif; max-width: 600px;">
        <h2 style="color:#E85D04;">Checklist Cleared</h2>
        <p>Hello ${opts.driverName},</p>
        <p>Your vehicle <strong>${opts.vehiclePlate}</strong> has been cleared by operations. You may now start the journey.</p>
        <p style="margin-top:20px;">
          <a href="https://app.mbuyucfl.com/driver/journey"
             style="background:#E85D04;color:#fff;padding:10px 20px;
                    text-decoration:none;border-radius:6px;">
            Start Journey
          </a>
        </p>
      </div>
    `
  );
}