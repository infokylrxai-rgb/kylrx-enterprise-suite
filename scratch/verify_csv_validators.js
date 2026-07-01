// Test CSV parser and validation rules programmatically

function parseCSV(text) {
    const lines = text.split(/\r?\n/);
    const result = [];
    for (let line of lines) {
        line = line.trim();
        if (!line) continue;
        const cells = [];
        let currentCell = '';
        let insideQuote = false;
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
                insideQuote = !insideQuote;
            } else if (char === ',' && !insideQuote) {
                cells.push(currentCell.trim());
                currentCell = '';
            } else {
                currentCell += char;
            }
        }
        cells.push(currentCell.trim());
        result.push(cells);
    }
    return result;
}

function validateHolidaysCSV(text) {
    const rows = parseCSV(text);
    if (rows.length < 2) {
        return { valid: false, errors: ["CSV file is empty or missing headers."] };
    }

    const headers = rows[0].map(h => h.toLowerCase().trim());
    const requiredHeaders = ['name', 'date', 'type'];
    const headerIndices = {};
    requiredHeaders.forEach(req => {
        headerIndices[req] = headers.indexOf(req);
    });

    if (headerIndices['name'] === -1 || headerIndices['date'] === -1 || headerIndices['type'] === -1) {
        return { valid: false, errors: [`Missing required headers.`] };
    }

    const errors = [];
    const validHolidays = [];

    for (let i = 1; i < rows.length; i++) {
        const cells = rows[i];
        if (cells.length === 1 && cells[0] === '') continue;

        const rowNum = i + 1;
        const name = cells[headerIndices['name']];
        const dateStr = cells[headerIndices['date']];
        const type = cells[headerIndices['type']];

        if (!name) {
            errors.push(`Row ${rowNum}: Name is required.`);
        }

        if (!dateStr) {
            errors.push(`Row ${rowNum}: Date is required.`);
        } else {
            const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
            if (!dateRegex.test(dateStr)) {
                errors.push(`Row ${rowNum}: Date "${dateStr}" must be in YYYY-MM-DD format.`);
            } else {
                const timestamp = Date.parse(dateStr);
                if (isNaN(timestamp)) {
                    errors.push(`Row ${rowNum}: Date "${dateStr}" is not a valid calendar date.`);
                }
            }
        }

        if (!type) {
            errors.push(`Row ${rowNum}: Type is required.`);
        } else {
            const validTypes = ['National', 'Regional', 'Optional'];
            if (!validTypes.some(t => t.toLowerCase() === type.toLowerCase())) {
                errors.push(`Row ${rowNum}: Type "${type}" is invalid. Must be one of: National, Regional, Optional.`);
            }
        }

        if (errors.length === 0) {
            let finalType = 'National';
            if (type.toLowerCase() === 'regional') finalType = 'Regional';
            if (type.toLowerCase() === 'optional') finalType = 'Optional';
            validHolidays.push({ name, date: dateStr, type: finalType });
        }
    }

    return { valid: errors.length === 0, errors, validHolidays };
}

function validateLeavesCSV(text) {
    const rows = parseCSV(text);
    if (rows.length < 2) {
        return { valid: false, errors: ["CSV file is empty or missing headers."] };
    }

    const headers = rows[0].map(h => h.toLowerCase().replace(/\s+/g, ''));
    const requiredHeaders = ['name', 'description', 'accrualrate'];
    const headerIndices = {};
    requiredHeaders.forEach(req => {
        headerIndices[req] = headers.indexOf(req);
    });

    if (headerIndices['name'] === -1 || headerIndices['description'] === -1 || headerIndices['accrualrate'] === -1) {
        return { valid: false, errors: [`Missing required headers.`] };
    }

    const errors = [];
    const validLeaveTypes = [];

    for (let i = 1; i < rows.length; i++) {
        const cells = rows[i];
        if (cells.length === 1 && cells[0] === '') continue;

        const rowNum = i + 1;
        const name = cells[headerIndices['name']];
        const description = cells[headerIndices['description']];
        const accrualStr = cells[headerIndices['accrualrate']];

        if (!name) {
            errors.push(`Row ${rowNum}: Name is required.`);
        }

        if (!description) {
            errors.push(`Row ${rowNum}: Description is required.`);
        }

        if (!accrualStr) {
            errors.push(`Row ${rowNum}: Accrual Rate is required.`);
        } else {
            const accrualNum = parseFloat(accrualStr);
            if (isNaN(accrualNum) || accrualNum < 0) {
                errors.push(`Row ${rowNum}: Accrual Rate "${accrualStr}" must be a valid positive number.`);
            }
        }

        if (errors.length === 0) {
            validLeaveTypes.push({ name, description, accrualRate: accrualStr });
        }
    }

    return { valid: errors.length === 0, errors, validLeaveTypes };
}

// Run tests
const malformedHolidaysText = `Name,Date,Type
New Year,2026-01-01,National
Invalid Date,2026-15-40,National
Missing Type,2026-05-01,
Bad Type,2026-06-01,SuperNational`;

const validHolidaysText = `Name,Date,Type
New Year,2026-01-01,National
Labour Day,2026-05-01,National
Regional Festival,2026-08-15,Regional`;

const malformedLeavesText = `Name,Description,Accrual Rate
Sabbatical,Extended career break,-2.5
Study Leave,,1.0
,Missing name,1.5`;

const validLeavesText = `Name,Description,Accrual Rate
Sabbatical,Extended career break,1.5
Study Leave,For educational courses,2.0`;

console.log("=== Testing Holiday CSV Validator ===");
const resH1 = validateHolidaysCSV(malformedHolidaysText);
console.log("Malformed Holidays errors (expected 3 errors):", resH1.errors);
if (resH1.errors.length === 3) console.log("✓ Malformed Holidays test passed");
else console.log("✗ Malformed Holidays test failed");

const resH2 = validateHolidaysCSV(validHolidaysText);
console.log("Valid Holidays valid:", resH2.valid, "Count:", resH2.validHolidays.length);
if (resH2.valid && resH2.validHolidays.length === 3) console.log("✓ Valid Holidays test passed");
else console.log("✗ Valid Holidays test failed");

console.log("\n=== Testing Leave Types CSV Validator ===");
const resL1 = validateLeavesCSV(malformedLeavesText);
console.log("Malformed Leaves errors (expected 3 errors):", resL1.errors);
if (resL1.errors.length === 3) console.log("✓ Malformed Leaves test passed");
else console.log("✗ Malformed Leaves test failed");

const resL2 = validateLeavesCSV(validLeavesText);
console.log("Valid Leaves valid:", resL2.valid, "Count:", resL2.validLeaveTypes.length);
if (resL2.valid && resL2.validLeaveTypes.length === 2) console.log("✓ Valid Leaves test passed");
else console.log("✗ Valid Leaves test failed");
