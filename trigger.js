require('dotenv').config();
const { sendEmail } = require('./utils/email');

async function trigger() {
    try {
        console.log("Triggering email to info.kylrxai@gmail.com...");
        await sendEmail({
            to: 'info.kylrxai@gmail.com',
            subject: 'Welcome to HRFlow - Your Credentials',
            html: `
                <div style="font-family: sans-serif; padding: 20px;">
                    <h2>Welcome to HRFlow!</h2>
                    <p>Your account has been created successfully.</p>
                    <p><strong>Your Temporary Password:</strong> <code style="background: #f1f5f9; padding: 4px;">GEN-Test-Account@2026!</code></p>
                    <p>You will be required to change this password upon your first login.</p>
                </div>
            `
        });
        console.log("Email dispatched successfully! Check your inbox.");
    } catch (e) {
        console.error("Error dispatching email:", e);
    }
}

trigger();
