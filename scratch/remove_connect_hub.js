const fs = require('fs');
const path = require('path');

const dirPath = 'c:/Users/Admin/OneDrive/Desktop/product_sprint';

try {
  const files = fs.readdirSync(dirPath);
  let updatedCount = 0;

  files.forEach(file => {
    if (path.extname(file).toLowerCase() === '.html') {
      const filePath = path.join(dirPath, file);
      let content = fs.readFileSync(filePath, 'utf8');

      // Match the Connect Hub link with arbitrary spacing or linebreaks
      const regex = /<div class="nav-item">\s*<a href="demo\.html" class="nav-link">\s*<i data-lucide="share-2"><\/i>\s*<span>Connect Hub<\/span>\s*<\/a>\s*<\/div>/gi;

      if (regex.test(content)) {
        content = content.replace(regex, '');
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`✅ Removed Connect Hub from ${file}`);
        updatedCount++;
      }
    }
  });

  console.log(`Successfully completed! Updated ${updatedCount} files.`);
} catch (err) {
  console.error("Error during execution:", err);
}
