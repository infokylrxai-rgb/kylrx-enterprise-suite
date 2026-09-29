const express = require("express");
const router = express.Router();
const adminController = require("../controllers/adminController");
const { validateDepartment, validateEmployee } = require("../middleware/validator");
const { verifyToken, authorize } = require("../middleware/authMiddleware");

// Secure all admin routes
router.use(verifyToken);
router.use(authorize('Admin', 'Super Admin'));

router.post("/bank/transfer", adminController.transferBank);
router.post("/create-department", validateDepartment, adminController.createDepartment);
router.get("/departments", adminController.getAllDepartments);

// Employee & Manager Routes
router.post("/create-employee", validateEmployee, adminController.createEmployee);
router.post("/create-manager", validateEmployee, adminController.createManager);
router.get("/employees", adminController.getAllEmployees);
router.get("/analytics", adminController.getAnalytics);
router.post("/sync-database", adminController.syncDatabase);

// RESTFUL Aliases
router.post("/departments", validateDepartment, adminController.createDepartment);
router.post("/employees", validateEmployee, adminController.createEmployee);
router.post("/employees/:id/trigger-invite", adminController.triggerEmailInvite);
router.put("/employees/:id", adminController.updateEmployee);
router.delete("/employees/:id", adminController.deleteEmployee);
router.post("/managers", validateEmployee, adminController.createManager);

// PRD Section 10: Business Unit by Employee Type Rules
router.get("/bu-rules", adminController.getBuRules);
router.post("/bu-rules", adminController.saveBuRule);

// PRD Section 13: Employee Job Details & Official Documents
router.get("/employees/:id/profile", adminController.getEmployeeProfile);
router.get("/employees/:id", adminController.getEmployeeProfile);
router.put("/employees/:id/profile", adminController.updateEmployeeProfile);
router.post("/employees/:id/documents", adminController.uploadEmployeeDocument);
router.delete("/employees/:id/documents/:docId", adminController.deleteEmployeeDocument);

module.exports = router;

