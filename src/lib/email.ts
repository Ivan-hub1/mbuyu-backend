import nodemailer from 'nodemailer';

const SMTP_HOST = process.env.SMTP_HOST || 'mail.mbuyucfl.com';
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_USER = process.env.SMTP_USER || 'noreply@mbuyucfl.com';
const SMTP_PASS = process.env.SMTP_PASS || '';

const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_PORT === 465,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
});

const FROM = `"Mbuyu CFL" <${SMTP_USER}>`;
const APP_URL = process.env.APP_URL || 'https://app.mbuyucfl.com';

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

export async function sendStaffInviteEmail(
  email: string,
  name: string,
  tempPassword: string,
  role: string
) {
  await sendMail(
    email,
    `Welcome to Mbuyu CFL — your ${role.toLowerCase()} account`,
    `
      <div style="font-family: Inter, Arial, sans-serif; max-width: 600px;">
        <h2 style="color:#E85D04;">Welcome to Mbuyu CFL</h2>
        <p>Hello ${name},</p>
        <p>An account has been created for you on the Mbuyu CFL ${role.toLowerCase()} portal.</p>
        <p style="background:#f4f4f4;padding:12px;border-radius:6px;">
          <strong>Email:</strong> ${email}<br>
          <strong>Temporary password:</strong> <code>${tempPassword}</code>
        </p>
        <p style="margin-top:20px;">
          <a href="${APP_URL}/login" style="background:#E85D04;color:#fff;padding:10px 20px;text-decoration:none;border-radius:6px;">
            Log in to your account
          </a>
        </p>
        <p style="font-size:12px;color:#888;">Please change your password after logging in.</p>
      </div>
    `
  );
}

export async function sendQuoteResponseEmail(opts: {
  to: string;
  fullName: string;
  reference: string;
  quotedAmount?: string | null;
  quotedCurrency?: string | null;
  taxName?: string | null;
  taxAmount?: string | null;
  adminResponse?: string | null;
  inviteToken: string;
}) {
  const total = (() => {
    const base = parseFloat(opts.quotedAmount || '0');
    const tax = parseFloat(opts.taxAmount || '0');
    const sum = base + tax;
    if (!sum) return null;
    return `${opts.quotedCurrency || 'USD'} ${sum.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  })();

  const signupUrl = `${APP_URL}/register/complete?token=${opts.inviteToken}`;

  await sendMail(
    opts.to,
    `Your Mbuyu CFL quote ${opts.reference} is ready`,
    `
      <div style="font-family: Inter, Arial, sans-serif; max-width: 600px;">
        <h2 style="color:#E85D04;">Your quote is ready</h2>
        <p>Hello ${opts.fullName},</p>
        <p>Thank you for requesting a quote from Mbuyu CFL. We've reviewed your request and prepared a quotation:</p>
        <p style="background:#fef5ec;padding:14px;border-radius:6px;border-left:4px solid #E85D04;">
          <strong>Reference:</strong> ${opts.reference}<br>
          ${total ? `<strong>Total amount:</strong> ${total}<br>` : ''}
          ${opts.taxName ? `<strong>${opts.taxName}:</strong> ${opts.quotedCurrency} ${opts.taxAmount}<br>` : ''}
        </p>
        ${
          opts.adminResponse
            ? `<p style="white-space:pre-wrap;">${opts.adminResponse}</p>`
            : ''
        }
        <p><strong>Next step:</strong> Create your customer account to accept this quote, track your shipment, and download future statements.</p>
        <p style="margin-top:20px;">
          <a href="${signupUrl}" style="background:#E85D04;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:bold;">
            Create Your Account
          </a>
        </p>
        <p style="font-size:12px;color:#888;">
          This link is unique to you and can only be used once. If you didn't request a quote from us, please ignore this email.
        </p>
      </div>
    `
  );
}

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
          <a href="${APP_URL}/driver/journey" style="background:#E85D04;color:#fff;padding:10px 20px;text-decoration:none;border-radius:6px;">
            Start Journey
          </a>
        </p>
      </div>
    `
  );
}

export async function sendMaintenanceAlert(opts: {
  driverName: string;
  vehiclePlate: string;
  checklistId: string;
  issues: string[];
  notes?: string | null;
}) {
  const recipients = (
    process.env.MAINTENANCE_ALERT_EMAILS || 'operations@mbuyucfl.com'
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const issuesList = opts.issues.map((i) => `<li>${i}</li>`).join('');

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
          <a href="${APP_URL}/dashboard/maintenance" style="background:#E85D04;color:#fff;padding:10px 20px;text-decoration:none;border-radius:6px;">
            Open Maintenance Queue
          </a>
        </p>
        <p style="font-size:12px;color:#888;margin-top:30px;">Checklist ID: ${opts.checklistId}</p>
      </div>
    `
  );
}

// ─── NEW: Transfer notification ───────────────────────────
export async function sendTransferEmail(opts: {
  to: string;
  driverName: string;
  trackingNumber: string;
  vehiclePlate: string;
  locationName: string;
}) {
  await sendMail(
    opts.to,
    `🚚 Shipment transferred to you — ${opts.trackingNumber}`,
    `
      <div style="font-family: Inter, Arial, sans-serif; max-width: 600px;">
        <h2 style="color:#E85D04;">Shipment Transferred to You</h2>
        <p>Hello ${opts.driverName},</p>
        <p>A shipment has been transferred to you and requires your action:</p>
        <p style="background:#fef5ec;padding:14px;border-radius:6px;border-left:4px solid #E85D04;">
          <strong>Tracking number:</strong> ${opts.trackingNumber}<br>
          <strong>Your assigned vehicle:</strong> ${opts.vehiclePlate}<br>
          <strong>Handoff location:</strong> ${opts.locationName}
        </p>
        <p><strong>Next steps:</strong></p>
        <ol>
          <li>Complete a fresh pre-trip checklist for your vehicle</li>
          <li>Open the journey from your driver portal</li>
          <li>Start the journey to continue the delivery</li>
        </ol>
        <p style="margin-top:20px;">
          <a href="${APP_URL}/driver/shipments" style="background:#E85D04;color:#fff;padding:10px 20px;text-decoration:none;border-radius:6px;font-weight:bold;">
            Open My Shipments
          </a>
        </p>
      </div>
    `
  );
}