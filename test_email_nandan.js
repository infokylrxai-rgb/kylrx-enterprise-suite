require('dotenv').config();
const { Resend } = require('resend');

async function testEmail() {
    const resend = new Resend(process.env.RESEND_API_KEY);
    console.log("Testing email delivery to: nandanb449@gmail.com...");
    
    try {
        const { data, error } = await resend.emails.send({
            from: 'HRFlow <onboarding@resend.dev>',
            to: ['info.kylrxai@gmail.com'],
            subject: '✅ Kylrx HRFlow - Test Verification Email for Nandan (nandanb449@gmail.com)',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 580px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff;">
                    <h2 style="color: #2563eb;">Kylrx HRFlow Enterprise</h2>
                    <p>Hello <strong>Nandan</strong>,</p>
                    <p>This is a live test verification email from your Kylrx HRMS system.</p>
                    <div style="background: #f8fafc; border-left: 4px solid #2563eb; padding: 12px; margin: 16px 0;">
                        <p style="margin: 0; font-size: 14px;"><strong>Target Recipient:</strong> nandanb449@gmail.com</p>
                        <p style="margin: 0; font-size: 14px;"><strong>Status:</strong> Email Gateway Test</p>
                        <p style="margin: 0; font-size: 14px;"><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
                    </div>
                    <p style="color: #64748b; font-size: 13px;">If you received this message, the email integration is working as expected.</p>
                </div>
            `
        });

        if (error) {
            console.log("RESEND_RESPONSE_ERROR:", JSON.stringify(error, null, 2));
        } else {
            console.log("RESEND_RESPONSE_SUCCESS:", JSON.stringify(data, null, 2));
        }
    } catch (e) {
        console.error("EXCEPTION:", e.message);
    }
}

testEmail();
