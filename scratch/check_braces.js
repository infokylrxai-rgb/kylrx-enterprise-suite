
const fs = require('fs');
const content = fs.readFileSync('c:\\Users\\Admin\\OneDrive\\Desktop\\product_sprint\\tvc-app.js', 'utf8');
let open = 0;
for (let i = 0; i < content.length; i++) {
    if (content[i] === '{') open++;
    if (content[i] === '}') open--;
}
console.log('Balance:', open);
