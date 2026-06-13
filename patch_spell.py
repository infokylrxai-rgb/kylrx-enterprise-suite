import re

with open('admin-onboarding-ai.html', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add the button to the HTML
chat_input_html_old = """                        <div class="chat-input-area">
                            <input type="text" id="chatInput" class="input-box" placeholder="Ask Kylrx AI about onboarding..." style="flex:1">
                            <button class="btn btn-primary" id="sendChat" style="padding: 10px;"><i data-lucide="send"></i></button>
                        </div>"""

chat_input_html_new = """                        <div class="chat-input-area">
                            <input type="text" id="chatInput" class="input-box" placeholder="Ask Kylrx AI about onboarding..." style="flex:1">
                            <button class="btn" id="spellCheckBtn" title="AI Spell Check" style="padding: 10px; background: var(--bg-soft); color: var(--primary); border: 1px solid var(--border); border-radius: 8px; cursor: pointer; transition: 0.2s;"><i data-lucide="wand-2"></i></button>
                            <button class="btn btn-primary" id="sendChat" style="padding: 10px;"><i data-lucide="send"></i></button>
                        </div>"""

content = content.replace(chat_input_html_old, chat_input_html_new)

# 2. Add the JS event listener
spellcheck_js = """
            const spellCheckBtn = document.getElementById('spellCheckBtn');
            spellCheckBtn?.addEventListener('click', () => {
                const text = input.value;
                if (!text.trim()) return;
                
                const originalHtml = spellCheckBtn.innerHTML;
                spellCheckBtn.innerHTML = '<span style="display:inline-block; animation: spin 1s linear infinite;">⏳</span>';
                
                setTimeout(() => {
                    // Simulated AI Grammar & Spelling Correction
                    let corrected = text
                        .replace(/\\badhar\\b/gi, 'Aadhaar')
                        .replace(/\\bteh\\b/g, 'the')
                        .replace(/\\breprot\\b/gi, 'report')
                        .replace(/\\bpanding\\b/gi, 'pending')
                        .replace(/\\bpls\\b/gi, 'please')
                        .replace(/\\bemp\\b/gi, 'employee')
                        .replace(/\\bplz\\b/gi, 'please');
                    
                    // Capitalize first letter if needed
                    corrected = corrected.charAt(0).toUpperCase() + corrected.slice(1);
                    
                    input.value = corrected;
                    spellCheckBtn.innerHTML = originalHtml;
                    if (window.lucide) lucide.createIcons();
                }, 800); // simulate network delay
            });
"""

# Insert the JS into setupChat()
content = re.sub(
    r'(const clearBtn = document\.getElementById\(\'clearChatBtn\'\);)',
    r'\1\n' + spellcheck_js,
    content
)

with open('admin-onboarding-ai.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("Spellcheck button added")
