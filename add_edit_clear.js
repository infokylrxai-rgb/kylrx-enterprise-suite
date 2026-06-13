const fs = require('fs');

const files = [
    { name: 'admin-message.html', isSentVar: 'isSent', idVar: 'msg.id', textVar: 'msg.text', appendTo: 'chatMessages.appendChild(msgDiv);', htmlVar: 'htmlContent', elVar: 'msgDiv' },
    { name: 'manager-message.html', isSentVar: 'isSent', idVar: 'msg.id', textVar: 'msg.text', appendTo: 'chatMessages.appendChild(msgDiv);', htmlVar: 'htmlContent', elVar: 'msgDiv' },
    { name: 'hrms-message.html', isSentVar: 'isSent', idVar: 'msg.id', textVar: 'msg.text', appendTo: 'chatMessages.appendChild(msgDiv);', htmlVar: 'htmlContent', elVar: 'msgDiv' },
    { name: 'employee-message.html', isSentVar: 'isMe', idVar: 'm.id', textVar: 'm.text', appendTo: 'chatArea.appendChild(bubble);', htmlVar: 'bodyHtml', elVar: 'bubble' }
];

const functionsToAdd = `
        window.clearMessage = async (msgId) => {
            if(confirm("Are you sure you want to delete this message?")) {
                const { doc, deleteDoc } = await import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js");
                await deleteDoc(doc(db, 'messages', msgId));
            }
        };

        window.editMessage = async (msgId, oldText) => {
            const newText = prompt("Edit your message:", oldText);
            if (newText !== null && newText.trim() !== "") {
                const { doc, updateDoc } = await import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js");
                await updateDoc(doc(db, 'messages', msgId), { text: newText.trim() });
            }
        };
`;

files.forEach(f => {
    if (!fs.existsSync(f.name)) return;
    let text = fs.readFileSync(f.name, 'utf8');

    if (text.includes('window.editMessage')) {
        console.log(`Skipping ${f.name}, already added`);
        return;
    }

    const searchTarget = `${f.elVar}.innerHTML = ${f.htmlVar};\\s*${f.appendTo.replace('(', '\\\\(').replace(')', '\\\\)')}`;
    const regex = new RegExp(searchTarget);
    
    const replaceStr = `if (${f.isSentVar}) {
                        ${f.htmlVar} += \`<div style="display:flex; gap:12px; margin-top:8px; font-size:0.7rem; opacity:0.8; justify-content:flex-end;">
                            <span style="cursor:pointer; color: var(--primary); text-decoration: underline;" onclick="window.editMessage('\${${f.idVar}}', \\\`\${(${f.textVar} || '').replace(/\\\`/g, '\\\\\\`')}\\\`)">Edit</span>
                            <span style="cursor:pointer; color: #ef4444; text-decoration: underline;" onclick="window.clearMessage('\${${f.idVar}}')">Clear</span>
                        </div>\`;
                    }
                    ${f.elVar}.innerHTML = ${f.htmlVar};
                    ${f.appendTo}`;
                    
    text = text.replace(regex, replaceStr);

    // Add functions before closing script tag
    text = text.replace(/\\s*lucide\\.createIcons\\(\\);\\s*<\\/script>\\s*<\\/body>/, functionsToAdd + '\n        lucide.createIcons();\n    </script>\n</body>');
    
    fs.writeFileSync(f.name, text);
    console.log(`Updated ${f.name}`);
});
