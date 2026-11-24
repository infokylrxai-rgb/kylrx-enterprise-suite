const nodemailer = require('nodemailer');
const { Resend } = require('resend');

/**
 * Helper to generate clean plain text from HTML
 */
function htmlToPlainText(html = '') {
    return html
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Enhanced Email Dispatcher
 * Optimized for Gmail inbox delivery (anti-spam scoring headers, dual-payload HTML/Text, Reply-To)
 */
const sendEmail = async ({ to, subject, text, html }) => {
    const recipients = Array.isArray(to) ? to.join(', ') : to;
    const plainText = text || htmlToPlainText(html);

    // 1. Gmail SMTP (Nodemailer)
    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
        console.log(`[Email] Dispatching via SMTP (${process.env.SMTP_HOST || 'gmail'}) to ${recipients}: ${subject}`);
        // SMTP_HOST selects any provider (Brevo, Mailgun, Postmark, a company relay). Without it
        // this stays on Gmail, which is all it could ever do before: the transport was hardcoded
        // to service:'gmail', so another provider's credentials were sent to Google's servers and
        // simply failed to authenticate.
        const smtpAuth = {
            user: process.env.SMTP_USER,
            // Google shows app passwords in four-character groups; pasting them verbatim is normal.
            pass: process.env.SMTP_PASS.replace(/\s+/g, '')
        };
        const transporter = nodemailer.createTransport(
            process.env.SMTP_HOST
                ? {
                    host: process.env.SMTP_HOST,
                    port: Number(process.env.SMTP_PORT || 587),
                    // 465 is implicit TLS; 587 upgrades via STARTTLS.
                    secure: String(process.env.SMTP_SECURE || (Number(process.env.SMTP_PORT) === 465)) === 'true',
                    auth: smtpAuth
                }
                : { service: 'gmail', auth: smtpAuth }
        );

        const senderName = process.env.EMAIL_SENDER_NAME || 'Kylrx HRFlow';
        // Gmail can only send as the authenticated user; a real SMTP relay can send as
        // your own domain, so EMAIL_FROM is honoured whenever SMTP_HOST is set.
        const smtpFrom = (process.env.SMTP_HOST && process.env.EMAIL_FROM) || process.env.SMTP_USER;
        const mailOptions = {
            from: `"${senderName}" <${smtpFrom}>`,
            replyTo: smtpFrom,
            to: recipients,
            subject,
            text: plainText,
            html: html || `<p>${plainText}</p>`,
            headers: {
                'X-Priority': '1',
                'X-MSMail-Priority': 'High',
                'Importance': 'high',
                'X-Mailer': 'Kylrx HRFlow Enterprise Mailer'
            }
        };

        const info = await transporter.sendMail(mailOptions);
        console.log(`[Email] ✅ Sent successfully via SMTP! Message ID: ${info.messageId}`);
        return { id: info.messageId, provider: 'smtp', accepted: info.accepted };
    }

    // 2. Resend API Fallback
    if (process.env.RESEND_API_KEY) {
        console.log(`[Email] Dispatching via Resend API to ${recipients}: ${subject}`);
        const resend = new Resend(process.env.RESEND_API_KEY);
        // EMAIL_FROM is documented in .env.example and listed by check-env, but this path
        // hardcoded Resend's shared test domain, so every message went out as
        // onboarding@resend.dev whatever was configured. That domain is for testing: it
        // cannot carry your branding and Resend limits who it may deliver to, so onboarding
        // invites would look wrong or never arrive. Fall back to it only when nothing is set.
        const resendSenderName = process.env.EMAIL_SENDER_NAME || 'Kylrx HRFlow';
        const fromAddress = process.env.EMAIL_FROM
            ? resendSenderName + ' <' + process.env.EMAIL_FROM + '>'
            : 'HRFlow <onboarding@resend.dev>';
        const { data, error } = await resend.emails.send({
            from: fromAddress,
            to: Array.isArray(to) ? to : [to],
            subject,
            text: plainText,
            html: html || `<p>${plainText}</p>`
        });

        if (error) {
            console.error(`[Email] ❌ Resend error:`, error);
            throw new Error(error.message);
        }

        console.log(`[Email] ✅ Sent successfully via Resend! Message ID: ${data.id}`);
        return { ...data, provider: 'resend' };
    }

    throw new Error('No email transport configured. Please set SMTP_USER & SMTP_PASS or RESEND_API_KEY in .env');
};

module.exports = { sendEmail };
