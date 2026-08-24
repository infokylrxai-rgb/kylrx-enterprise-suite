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
        console.log(`[Email] Dispatching via Gmail SMTP (Nodemailer) to ${recipients}: ${subject}`);
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS.replace(/\s+/g, '') // remove spaces from 16-char app pass
            }
        });

        const senderName = process.env.EMAIL_SENDER_NAME || 'Kylrx HRFlow';
        const mailOptions = {
            from: `"${senderName}" <${process.env.SMTP_USER}>`,
            replyTo: process.env.SMTP_USER,
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
        const { data, error } = await resend.emails.send({
            from: 'HRFlow <onboarding@resend.dev>',
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
