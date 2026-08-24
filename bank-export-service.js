export function enrichEmployeeBankDetails(employee, profile = {}) {
    const bankDetails = profile.bankDetails || employee.bankDetails || {};
    const bankAccount = bankDetails.accountNum || profile.accountNumber || employee.bankAccount || "";
    const ifscCode = bankDetails.ifsc || profile.routingCode || employee.ifscCode || "";
    const bankName = bankDetails.bankName || profile.bankName || employee.bankName || "";
    const accountHolder = bankDetails.accountHolder || profile.accountHolder || employee.name || employee.email || "";

    return {
        ...employee,
        bankAccount,
        ifscCode,
        bankName,
        accountHolder,
        bankComplete: Boolean(bankAccount && ifscCode)
    };
}

export function buildBankTransferRows(employees, periodLabel) {
    return employees.map((e) => ({
        employeeName: e.name || e.email || "",
        employeeCode: e.employeeCode || (e.id ? e.id.substring(0, 8).toUpperCase() : ""),
        department: e.department || "General",
        bankName: e.bankName || "",
        accountHolder: e.accountHolder || e.name || "",
        bankAccount: e.bankAccount || "",
        ifscCode: e.ifscCode || "",
        netPay: e.net ?? 0,
        paymentMode: "NEFT",
        period: periodLabel
    }));
}

export function exportBankTransferCSV(employees, periodLabel, options = {}) {
    const { skipIncomplete = false, bypassConfirm = false } = options;
    const rows = buildBankTransferRows(employees, periodLabel);
    const incomplete = rows.filter((r) => !r.bankAccount || !r.ifscCode);

    if (incomplete.length && !skipIncomplete && !bypassConfirm) {
        const proceed = confirm(
            `${incomplete.length} employee(s) missing bank info. Export anyway?`
        );
        if (!proceed) return { exported: false, incomplete: incomplete.length };
    }

    const exportRows = skipIncomplete ? rows.filter((r) => r.bankAccount && r.ifscCode) : rows;
    const header = [
        "Employee Name", "Employee Code", "Department", "Bank Name",
        "Account Holder Name", "Bank Account", "IFSC Code", "Net Pay (INR)", "Payment Mode", "Period"
    ];
    const csvLines = [
        header.join(","),
        ...exportRows.map((r) => [
            r.employeeName, r.employeeCode, r.department, r.bankName,
            r.accountHolder, r.bankAccount, r.ifscCode, r.netPay, r.paymentMode, r.period
        ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
    ];

    const timestamp = new Date().toISOString().slice(0, 10);
    const safePeriod = periodLabel.replace(/\s+/g, "_");
    const blob = new Blob([csvLines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `bank_transfer_${safePeriod}_${timestamp}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);

    return { exported: true, count: exportRows.length, incomplete: incomplete.length };
}
