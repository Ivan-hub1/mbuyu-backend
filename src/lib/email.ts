import nodemailer from 'nodemailer';
import { currentBrand } from './brand';

// Settings are read when an email is sent (not when this file loads), so they
// always reflect the loaded .env regardless of module load order.
function smtpSettings() {
  const env = (key: string) => (process.env[key] || '').trim();
  const port = Number(env('SMTP_PORT') || 465);
  return {
    host: env('SMTP_HOST') || 'mail.mbuyucfl.com',
    port,
    user: env('SMTP_USER') || 'noreply@mbuyucfl.com',
    pass: process.env.SMTP_PASS || '',
    // Local development only: antivirus "HTTPS/email scanning", a company proxy
    // or a mail server with its own certificate can fail Node's certificate
    // check ("self-signed certificate in certificate chain").
    allowSelfSigned:
      ['true', '1', 'yes'].includes(env('SMTP_ALLOW_SELF_SIGNED').toLowerCase()) &&
      env('NODE_ENV') !== 'production',
  };
}

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;
let transporterKey = '';

function getTransporter() {
  const smtp = smtpSettings();
  const key = JSON.stringify(smtp);
  if (!transporter || key !== transporterKey) {
    transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.port === 465,
      auth: { user: smtp.user, pass: smtp.pass },
      ...(smtp.allowSelfSigned && { tls: { rejectUnauthorized: false } }),
    });
    transporterKey = key;
  }
  return { transporter, smtp };
}

export const APP_URL = process.env.APP_URL || 'https://app.mbuyucfl.com';

/** One-line summary for the startup log, so email setup problems are visible. */
export function emailStatus(): string {
  const smtp = smtpSettings();
  if (!smtp.pass) return 'DISABLED — SMTP_PASS not set';
  return `${smtp.user} via ${smtp.host}:${smtp.port}${
    smtp.allowSelfSigned ? ' (self-signed certificates allowed — dev only)' : ''
  }`;
}

// Resolves true when sent, false when SMTP isn't configured; throws if the
// SMTP server rejects it. Fire-and-forget callers must attach .catch().
// The sender name is the current tenant's company name.
export async function sendMail(
  to: string | string[],
  subject: string,
  html: string
): Promise<boolean> {
  const { transporter, smtp } = getTransporter();
  if (!smtp.pass) {
    console.warn('[mailer] SMTP_PASS not set — skipping send:', subject);
    return false;
  }
  const brand = await currentBrand();
  await transporter.sendMail({
    from: `"${brand.name}" <${smtp.user}>`,
    to: Array.isArray(to) ? to.join(',') : to,
    subject,
    html,
  });
  return true;
}

/** Run an email send and report the outcome to the admin UI instead of throwing. */
export async function trySendEmail(
  send: () => Promise<boolean>
): Promise<{ emailSent: boolean; emailError: string | null }> {
  try {
    const sent = await send();
    return sent
      ? { emailSent: true, emailError: null }
      : { emailSent: false, emailError: 'Email is not configured on the server (SMTP).' };
  } catch (e) {
    console.error('[email] send failed', e);
    return { emailSent: false, emailError: 'Email failed to send — changes were saved.' };
  }
}

function formatMoney(amount: number, currency?: string | null) {
  return `${currency || 'USD'} ${amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function quoteTotal(opts: {
  quotedAmount?: string | null;
  quotedCurrency?: string | null;
  taxAmount?: string | null;
}) {
  const sum =
    parseFloat(opts.quotedAmount || '0') + parseFloat(opts.taxAmount || '0');
  return sum ? formatMoney(sum, opts.quotedCurrency) : null;
}

export async function sendStaffInviteEmail(
  email: string,
  name: string,
  tempPassword: string,
  role: string
) {
  const b = await currentBrand();
  return sendMail(
    email,
    `Welcome to ${b.name} — your ${role.toLowerCase()} account`,
    `
      <div style="font-family: Inter, Arial, sans-serif; max-width: 600px;">
        <h2 style="color:#E85D04;">Welcome to ${b.name}</h2>
        <p>Hello ${name},</p>
        <p>An account has been created for you on the ${b.name} ${role.toLowerCase()} portal.</p>
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
  const b = await currentBrand();
  const total = quoteTotal(opts);

  const signupUrl = `${APP_URL}/register/complete?token=${opts.inviteToken}`;

  return sendMail(
    opts.to,
    `Your ${b.name} quote ${opts.reference} is ready`,
    `
      <div style="font-family: Inter, Arial, sans-serif; max-width: 600px;">
        <h2 style="color:#E85D04;">Your quote is ready</h2>
        <p>Hello ${opts.fullName},</p>
        <p>Thank you for requesting a quote from ${b.name}. We've reviewed your request and prepared a quotation:</p>
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

export async function sendQuoteRejectedEmail(opts: {
  to: string;
  fullName: string;
  reference: string;
  adminResponse?: string | null;
}) {
  const b = await currentBrand();
  return sendMail(
    opts.to,
    `Update on your ${b.name} quote ${opts.reference}`,
    `
      <div style="font-family: Inter, Arial, sans-serif; max-width: 600px;">
        <h2 style="color:#E85D04;">Update on your quote request</h2>
        <p>Hello ${opts.fullName},</p>
        <p>Thank you for considering ${b.name}. Unfortunately we are unable to proceed with quote <strong>${opts.reference}</strong> at this time.</p>
        ${
          opts.adminResponse
            ? `<p style="background:#f4f4f4;padding:14px;border-radius:6px;white-space:pre-wrap;">${opts.adminResponse}</p>`
            : ''
        }
        <p>If your requirements change, we would be glad to prepare a new quote for you.</p>
        <p style="margin-top:20px;">
          <a href="${APP_URL}/quote" style="background:#E85D04;color:#fff;padding:10px 20px;text-decoration:none;border-radius:6px;">
            Request a new quote
          </a>
        </p>
      </div>
    `
  );
}

export async function sendQuoteAcceptedEmail(opts: {
  to: string;
  fullName: string;
  reference: string;
  trackingNumber: string;
  quotedAmount?: string | null;
  quotedCurrency?: string | null;
  taxName?: string | null;
  taxAmount?: string | null;
  // Present when the customer hasn't created their account yet
  inviteToken?: string | null;
}) {
  const b = await currentBrand();
  const total = quoteTotal(opts);
  const trackUrl = `${APP_URL}/track/${encodeURIComponent(opts.trackingNumber)}`;

  return sendMail(
    opts.to,
    `Your shipment is booked — tracking number ${opts.trackingNumber}`,
    `
      <div style="font-family: Inter, Arial, sans-serif; max-width: 600px;">
        <h2 style="color:#E85D04;">Your shipment is booked</h2>
        <p>Hello ${opts.fullName},</p>
        <p>Your quote <strong>${opts.reference}</strong> has been accepted and your shipment with ${b.name} has been created.</p>
        <p style="background:#fef5ec;padding:14px;border-radius:6px;border-left:4px solid #E85D04;">
          <strong>Tracking number:</strong> ${opts.trackingNumber}<br>
          ${total ? `<strong>Total amount:</strong> ${total}<br>` : ''}
          ${opts.taxName && opts.taxAmount ? `<strong>${opts.taxName}:</strong> ${opts.quotedCurrency} ${opts.taxAmount}<br>` : ''}
        </p>
        <p style="margin-top:20px;">
          <a href="${trackUrl}" style="background:#E85D04;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:bold;">
            Track your shipment
          </a>
        </p>
        ${
          opts.inviteToken
            ? `<p>Create your customer account to follow every update and download statements:
                 <a href="${APP_URL}/register/complete?token=${opts.inviteToken}">create your account</a>.</p>`
            : ''
        }
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
  return sendMail(
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
  // The company's own ops team; the env list is only a legacy default
  recipients?: string[];
  driverName: string;
  vehiclePlate: string;
  checklistId: string;
  issues: string[];
  notes?: string | null;
}) {
  const recipients =
    opts.recipients ??
    (process.env.MAINTENANCE_ALERT_EMAILS || 'operations@mbuyucfl.com')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  if (recipients.length === 0) return false;

  const issuesList = opts.issues.map((i) => `<li>${i}</li>`).join('');

  return sendMail(
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
  return sendMail(
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