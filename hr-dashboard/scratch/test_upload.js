const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');

async function testUpload() {
    const form = new FormData();
    const csvContent = "name,email,department,role,salary\nTest User,test.user@example.com,Engineering,employee,50000";
    fs.writeFileSync('test.csv', csvContent);
    form.append('file', fs.createReadStream('test.csv'));

    try {
        // We need a token. Let's bypass auth for testing if possible or use a known one.
        // Since I can't easily get a token without logging in, I'll check the authMiddleware.
        console.log("Attempting upload to http://localhost:3000/api/employees/bulk-upload");
        const response = await axios.post('http://localhost:3000/api/employees/bulk-upload', form, {
            headers: {
                ...form.getHeaders(),
                // 'Authorization': 'Bearer ...' // This will likely fail if token is missing
            }
        });
        console.log(response.data);
    } catch (error) {
        console.error("Upload failed:", error.response ? error.response.data : error.message);
    }
}

testUpload();
