/**
 * HRFlow Employee Onboarding Logic
 * Handles session management, dynamic steps, and interactive chat assistants.
 */

// Simulation of "Secure JWT" tokens mapping to employee data
const MOCK_INVITATIONS = {
    'HRFLOW-WELCOME-2026': {
        name: 'Alex Johnson',
        role: 'Senior Product Designer',
        department: 'Design & UX',
        progress: 25
    },
    'DEV-ENTRY-TOKEN': {
        name: 'Sam Chen',
        role: 'Fullstack Developer',
        department: 'Engineering',
        progress: 10
    }
};

document.addEventListener('DOMContentLoaded', () => {
    if (window.lucide) lucide.createIcons();

    const loginOverlay = document.getElementById('loginOverlay');
    const onboardingPortal = document.getElementById('onboardingPortal');
    const inviteInput = document.getElementById('inviteToken');
    const btnStart = document.getElementById('btnStartOnboarding');

    // Auto-login from URL parameter (Simulating Email Link)
    const urlParams = new URLSearchParams(window.location.search);
    const urlToken = urlParams.get('token');
    if (urlToken && MOCK_INVITATIONS[urlToken.toUpperCase()]) {
        inviteInput.value = urlToken;
        setTimeout(() => login(MOCK_INVITATIONS[urlToken.toUpperCase()]), 500);
    }

    // Handle Login Simulation
    btnStart.addEventListener('click', () => {
        const token = inviteInput.value.trim().toUpperCase();
        
        if (MOCK_INVITATIONS[token]) {
            login(MOCK_INVITATIONS[token]);
        } else {
            alert('Invalid or expired invitation token. Please check your email or contact HR support.');
            inviteInput.style.borderColor = 'var(--danger)';
            setTimeout(() => inviteInput.style.borderColor = '', 2000);
        }
    });

    function login(employeeData) {
        // Animate out login
        loginOverlay.style.opacity = '0';
        loginOverlay.style.transform = 'scale(0.95)';
        
        setTimeout(() => {
            loginOverlay.style.display = 'none';
            onboardingPortal.style.display = 'block';
            onboardingPortal.classList.add('fade-in');
            
            // Initialize UI with employee data
            document.getElementById('welcomeName').textContent = `Hello, ${employeeData.name.split(' ')[0]}!`;
            document.getElementById('welcomeRole').textContent = `${employeeData.role} - ${employeeData.department}`;
            updateProgress(employeeData.progress);
            
            // Celebration!
            confetti({
                particleCount: 150,
                spread: 70,
                origin: { y: 0.6 },
                colors: ['#3b82f6', '#10b981', '#ffffff']
            });

            // Initialize Lucide again for any new elements
            if (window.lucide) lucide.createIcons();
        }, 500);
    }

    // Step Navigation
    const steps = document.querySelectorAll('.step-item');
    const stepContents = document.querySelectorAll('.step-content');

    steps.forEach(step => {
        step.addEventListener('click', () => {
            const stepId = step.dataset.step;
            switchStep(stepId);
        });
    });

    window.switchStep = (stepId) => {
        // Update Sidebar
        steps.forEach(s => s.classList.remove('active'));
        document.querySelector(`.step-item[data-step="${stepId}"]`).classList.add('active');

        // Update Content
        stepContents.forEach(c => {
            c.classList.remove('active');
            c.style.display = 'none';
        });
        
        const target = document.getElementById(`step-${stepId}`);
        target.style.display = 'block';
        setTimeout(() => target.classList.add('active'), 10);

        // Update Progress based on step
        const progressMap = { 'welcome': 25, 'docs': 50, 'guidelines': 75, 'setup': 100 };
        updateProgress(progressMap[stepId]);
    };

    function updateProgress(val) {
        const fill = document.querySelector('.progress-fill');
        const text = document.getElementById('progressPercent');
        fill.style.width = `${val}%`;
        text.textContent = `${val}%`;
    }

    // AI Chat Assistant (Aria)
    const aiInput = document.getElementById('aiInput');
    const btnSendAi = document.getElementById('btnSendAi');
    const aiChatBox = document.getElementById('aiChatBox');

    btnSendAi.addEventListener('click', sendAiMessage);
    aiInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendAiMessage(); });

    function sendAiMessage() {
        const msg = aiInput.value.trim();
        if (!msg) return;

        // User message
        appendChat(aiChatBox, msg, 'user');
        aiInput.value = '';

        // Bot thinking...
        setTimeout(() => {
            const response = getAiResponse(msg);
            appendChat(aiChatBox, response, 'bot');
        }, 1000);
    }

    function getAiResponse(msg) {
        msg = msg.toLowerCase();
        if (msg.includes('leave') || msg.includes('holiday')) return "Our leave policy allows 24 days of PTO per year. You can request leaves through the 'Time Off' section in the main HRFlow portal once your onboarding is complete!";
        if (msg.includes('slack') || msg.includes('setup')) return "I've sent the Slack invitation to your official email. Check your inbox for 'Welcome to HRFlow Slack' and follow the setup guide!";
        if (msg.includes('payroll') || msg.includes('salary')) return "Salaries are processed on the 28th of every month. You can view your detailed benefits guide in the 'Official Documents' step of this onboarding!";
        return "That's a great question! Let me check the company handbook... Actually, if you need specific details on that, I can connect you with an HR representative. Should I do that?";
    }

    function appendChat(container, msg, type) {
        const div = document.createElement('div');
        div.className = `chat-msg ${type}`;
        div.innerHTML = `<p>${msg}</p>`;
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
    }

    // HR Support Overlay
    const supportOverlay = document.getElementById('supportOverlay');
    const btnSupport = document.getElementById('btnSupportTrigger');
    const btnCloseSupport = document.getElementById('btnCloseSupport');

    btnSupport.addEventListener('click', () => supportOverlay.classList.add('active'));
    btnCloseSupport.addEventListener('click', () => supportOverlay.classList.remove('active'));

    // Step triggers
    document.getElementById('btnNextStepWelcome').addEventListener('click', () => switchStep('docs'));
});
