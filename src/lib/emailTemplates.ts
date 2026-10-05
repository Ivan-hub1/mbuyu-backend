const APP_URL = process.env.FRONTEND_URL || 'https://app.mbuyucfl.com';

// ─── Base layout ──────────────────────────────────────────
function baseLayout(content: string) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Mbuyu CFL</title>
</head>
<body style="margin:0;padding:0;background:#0A0A0A;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#fff;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0A0A0A;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#1A1A1A;border-radius:12px;overflow:hidden;border:1px solid #2A2A2A;">
          <tr>
            <td style="padding:32px 40px;border-bottom:1px solid #2A2A2A;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="vertical-align:middle;">
                    <div style="display:inline-block;background:#E85D04;width:40px;height:40px;border-radius:8px;text-align:center;line-height:40px;font-size:22px;font-weight:900;color:#fff;">M</div>
                  </td>
                  <td style="padding-left:12px;vertical-align:middle;">
                    <div style="font-size:20px;font-weight:800;color:#fff;line-height:1;">
                      <span style="color:#fff;">Mbuyu</span> <span style="color:#E85D04;">CFL</span>
                    </div>
                    <div style="font-size:10px;color:#666;font-style:italic;margin-top:4px;">...Built to Carry Africa</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:40px;">
              ${content}
            </td>
          </tr>
          <tr>
            <td style="padding:24px 40px;border-top:1px solid #2A2A2A;text-align:center;">
              <p style="margin:0;font-size:12px;color:#666;">
                Mbuyu CFL — Clearing, Forwarding & Logistics
              </p>
              <p style="margin:8px 0 0;font-size:11px;color:#444;">
                © ${new Date().getFullYear()} Mbuyu CFL. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

function button(text: string, url: string) {
  return `
    <table cellpadding="0" cellspacing="0" style="margin:24px 0;">
      <tr>
        <td style="background:#E85D04;border-radius:8px;">
          <a href="${url}" style="display:inline-block;padding:14px 28px;color:#fff;text-decoration:none;font-weight:600;font-size:14px;">
            ${text}
          </a>
        </td>
      </tr>
    </table>
  `;
}

function heading(text: string) {
  return `<h1 style="margin:0 0 20px;font-size:24px;font-weight:700;color:#fff;">${text}</h1>`;
}

function paragraph(text: string) {
  return `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#B0B0B0;">${text}</p>`;
}

// ─── Templates ────────────────────────────────────────────

export function welcomeEmail(name: string) {
  const content = `
    ${heading(`Welcome to Mbuyu CFL, ${name}! 🎉`)}
    ${paragraph('Thank you for creating an account with us. We are excited to help you move cargo across Africa and beyond.')}
    ${paragraph('Here is what you can do with your account:')}
    <ul style="margin:0 0 24px;padding-left:20px;font-size:15px;line-height:1.8;color:#B0B0B0;">
      <li>Request shipping quotes</li>
      <li>Track your cargo in real time</li>
      <li>Manage your shipments</li>
      <li>Get instant updates on your deliveries</li>
    </ul>
    ${button('Go to Dashboard', `${APP_URL}/dashboard`)}
    ${paragraph('If you have any questions, just reply to this email. We are here to help.')}
    ${paragraph('Best regards,<br>The Mbuyu CFL Team')}
  `;
  return baseLayout(content);
}

export function staffInviteEmail(name: string, email: string, tempPassword: string, role: string) {
  const content = `
    ${heading(`Welcome to the Mbuyu CFL Team, ${name}! 👋`)}
    ${paragraph(`You have been invited to join the Mbuyu CFL platform as a <strong style="color:#E85D04;">${role}</strong>.`)}
    ${paragraph('Your login credentials are below. Please change your password after your first login.')}

    <table cellpadding="0" cellspacing="0" style="width:100%;background:#0A0A0A;border-radius:8px;padding:20px;margin:20px 0;">
      <tr>
        <td style="padding:4px 0;">
          <div style="font-size:12px;color:#666;text-transform:uppercase;letter-spacing:0.5px;">Email</div>
          <div style="font-size:15px;color:#fff;font-family:monospace;margin-top:4px;">${email}</div>
        </td>
      </tr>
      <tr>
        <td style="padding:12px 0 4px;">
          <div style="font-size:12px;color:#666;text-transform:uppercase;letter-spacing:0.5px;">Temporary Password</div>
          <div style="font-size:15px;color:#E85D04;font-family:monospace;font-weight:600;margin-top:4px;">${tempPassword}</div>
        </td>
      </tr>
    </table>

    ${button('Log In', `${APP_URL}/login`)}
    ${paragraph('For security, please change your password immediately after logging in.')}
    ${paragraph('Welcome aboard,<br>The Mbuyu CFL Team')}
  `;
  return baseLayout(content);
}

export function quoteReceivedEmail(name: string, reference: string, originCountry: string, destinationCountry: string) {
  const content = `
    ${heading('We received your quote request ✅')}
    ${paragraph(`Hi ${name}, thank you for submitting a quote request with Mbuyu CFL.`)}
    ${paragraph(`We are now reviewing your shipment from <strong style="color:#fff;">${originCountry}</strong> to <strong style="color:#fff;">${destinationCountry}</strong>.`)}

    <table cellpadding="0" cellspacing="0" style="width:100%;background:#0A0A0A;border-radius:8px;padding:20px;margin:20px 0;">
      <tr>
        <td>
          <div style="font-size:12px;color:#666;text-transform:uppercase;letter-spacing:0.5px;">Your Reference Number</div>
          <div style="font-size:18px;color:#E85D04;font-family:monospace;font-weight:600;margin-top:6px;">${reference}</div>
        </td>
      </tr>
    </table>

    ${paragraph('Save this reference number — you will need it to track the status of your quote.')}
    ${paragraph('Our team will respond within 24 hours with a tailored quote.')}
    ${button('Track Your Quote', `${APP_URL}/dashboard`)}
    ${paragraph('Thank you for choosing Mbuyu CFL,<br>The Mbuyu CFL Team')}
  `;
  return baseLayout(content);
}

export function newQuoteAdminEmail(clientName: string, clientEmail: string, reference: string, cargoType: string, originCountry: string, destinationCountry: string) {
  const content = `
    ${heading('🔔 New Quote Request Received')}
    ${paragraph(`A new quote request has been submitted on Mbuyu CFL.`)}
    ${paragraph(`Reference: <strong style="color:#E85D04;font-family:monospace;">${reference}</strong>`)}

    <table cellpadding="0" cellspacing="0" style="width:100%;background:#0A0A0A;border-radius:8px;padding:20px;margin:20px 0;font-size:14px;color:#B0B0B0;">
      <tr><td style="padding:4px 0;"><strong style="color:#fff;">Client:</strong> ${clientName}</td></tr>
      <tr><td style="padding:4px 0;"><strong style="color:#fff;">Email:</strong> ${clientEmail}</td></tr>
      <tr><td style="padding:4px 0;"><strong style="color:#fff;">Cargo Type:</strong> ${cargoType}</td></tr>
      <tr><td style="padding:4px 0;"><strong style="color:#fff;">Route:</strong> ${originCountry} → ${destinationCountry}</td></tr>
    </table>

    ${button('View in Dashboard', `${APP_URL}/dashboard`)}
    ${paragraph('Log in to review and respond to this request.')}
  `;
  return baseLayout(content);
}

export function quoteResponseEmail(name: string, reference: string, quotedAmount: string, quotedCurrency: string, adminResponse: string) {
  const content = `
    ${heading('💬 You have a new quote response')}
    ${paragraph(`Hi ${name}, Mbuyu CFL has responded to your quote request.`)}
    ${paragraph(`Reference: <strong style="color:#E85D04;font-family:monospace;">${reference}</strong>`)}

    <table cellpadding="0" cellspacing="0" style="width:100%;background:#0A0A0A;border-radius:8px;padding:20px;margin:20px 0;">
      <tr>
        <td>
          <div style="font-size:12px;color:#666;text-transform:uppercase;letter-spacing:0.5px;">Quoted Amount</div>
          <div style="font-size:24px;color:#E85D04;font-weight:700;margin-top:6px;">${quotedCurrency} ${quotedAmount}</div>
        </td>
      </tr>
    </table>

    <div style="background:#0A0A0A;border-radius:8px;padding:20px;margin:20px 0;">
      <div style="font-size:12px;color:#666;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px;">Message from Our Team</div>
      <div style="font-size:14px;line-height:1.7;color:#B0B0B0;white-space:pre-wrap;">${adminResponse}</div>
    </div>

    ${button('View Full Details', `${APP_URL}/dashboard`)}
    ${paragraph('If you would like to proceed, simply reply to this email or contact us directly.')}
    ${paragraph('Best regards,<br>The Mbuyu CFL Team')}
  `;
  return baseLayout(content);
}