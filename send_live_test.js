require('dotenv').config();
const { sendEmail } = require('./utils/email');

async function sendLiveTest() {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[Test] Sending live test email to: nandanb449@gmail.com at ${timestamp}...`);

    try {
        const result = await sendEmail({
            to: 'nandanb449@gmail.com',
            subject: `Kylrx HRFlow - Immediate Test for Nandan (${timestamp})`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
                    <h2 style="color: #2563eb; margin-top: 0;">Kylrx HRFlow Enterprise</h2>
                    <p>Hello <strong>Nandan</strong>,</p>
                    <p>This is a live test email sent directly from your system to <strong>nandanb449@gmail.com</strong>.</p>
                    
                    <div style="background-color: #f1f5f9; padding: 16px; border-radius: 8px; margin: 18px 0;">
                        <p style="margin: 4px 0;"><strong>Sender Account:</strong> ${process.env.SMTP_USER}</p>
                        <p style="margin: 4px 0;"><strong>Recipient:</strong> nandanb449@gmail.com</p>
                        <p style="margin: 4px 0;"><strong>Status:</strong> Successfully Sent via Gmail SMTP</p>
                        <p style="margin: 4px 0;"><strong>Timestamp:</strong> ${new Date().toString()}</p>
                    </div>

                    <p style="color: #475569; font-size: 14px;">If you see this email, the trigger is active and functioning properly.</p>
                </div>
            `
        });

        console.log("✅ EMAIL DISPATCH RESULT:", JSON.stringify(result, null, 2));
    } catch (error) {
        console.error("❌ EMAIL DISPATCH ERROR:", error);
    }
}

sendLiveTest();
