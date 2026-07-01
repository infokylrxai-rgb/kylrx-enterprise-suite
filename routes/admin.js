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
router.put("/employees/:id", adminController.updateEmployee);
router.delete("/employees/:id", adminController.deleteEmployee);
router.post("/managers", validateEmployee, adminController.createManager);

module.exports = router;
