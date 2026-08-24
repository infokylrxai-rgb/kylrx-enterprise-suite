/**
 * Validation Middleware for Admin API
 */

const validateDepartment = (req, res, next) => {
    const { departmentName, departmentCode } = req.body;
    if (!departmentName || !departmentCode) {
        return res.status(400).json({ error: "Missing required fields: departmentName and departmentCode are mandatory." });
    }
    if (departmentCode.length < 2 || departmentCode.length > 5) {
        return res.status(400).json({ error: "Department code must be between 2 and 5 characters." });
    }
    next();
};

const validateEmployee = (req, res, next) => {
    const { name, email, departmentId, salary } = req.body;
    if (!name || !email || !departmentId) {
        return res.status(400).json({ error: "Missing required fields: name, email, and departmentId are mandatory." });
    }
    
    // Basic Email Regex
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({ error: "Invalid email format." });
    }

    if (salary && isNaN(Number(salary))) {
        return res.status(400).json({ error: "Salary must be a valid number." });
    }
    
    next();
};

module.exports = { validateDepartment, validateEmployee };
