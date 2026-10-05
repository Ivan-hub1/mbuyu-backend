import { Resend } from 'resend';
import {
  welcomeEmail,
  staffInviteEmail,
  quoteReceivedEmail,
  newQuoteAdminEmail,
  quoteResponseEmail,
} from './emailTemplates';

const RESEND_API_KEY = process.env.RESEND_API_KEY;

if (!RESEND_API_KEY) {
  console.warn('⚠️  RESEND_API_KEY not set — emails will be skipped');
}

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

const FROM_EMAIL = 'Mbuyu CFL <notifications@mbuyucfl.com>';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'info@mbuyucfl.com';

async function sendEmail(to: string, subject: string, html: string) {
  if (!resend) {
    console.log(`[EMAIL SKIPPED] To: ${to} | Subject: ${subject}`);
    return;
  }

  try {
    const result = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject,
      html,
    });
    console.log(`[EMAIL SENT] To: ${to} | Subject: ${subject} | ID: ${result.data?.id}`);
    return result;
  } catch (err) {
    console.error(`[EMAIL FAILED] To: ${to} | Subject: ${subject}`, err);
  }
}

export async function sendWelcomeEmail(to: string, name: string) {
  await sendEmail(to, 'Welcome to Mbuyu CFL 🎉', welcomeEmail(name));
}

export async function sendStaffInviteEmail(to: string, name: string, tempPassword: string, role: string) {
  await sendEmail(to, `You've been invited to Mbuyu CFL (${role})`, staffInviteEmail(name, to, tempPassword, role));
}

export async function sendQuoteReceivedEmail(to: string, name: string, reference: string, originCountry: string, destinationCountry: string) {
  await sendEmail(to, `Quote request received — ${reference}`, quoteReceivedEmail(name, reference, originCountry, destinationCountry));
}

export async function sendNewQuoteAdminEmail(reference: string, clientName: string, clientEmail: string, cargoType: string, originCountry: string, destinationCountry: string) {
  await sendEmail(ADMIN_EMAIL, `🔔 New quote request — ${reference}`, newQuoteAdminEmail(clientName, clientEmail, reference, cargoType, originCountry, destinationCountry));
}

export async function sendQuoteResponseEmail(to: string, name: string, reference: string, quotedAmount: string, quotedCurrency: string, adminResponse: string) {
  await sendEmail(to, `Your quote from Mbuyu CFL — ${reference}`, quoteResponseEmail(name, reference, quotedAmount, quotedCurrency, adminResponse));
}