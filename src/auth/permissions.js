// src/auth/permissions.js
// Permissions et rôles utilisés par le backend (RBAC)

const AdminRole = {
  SUPER_ADMIN: "SUPER_ADMIN",
  TECH_ADMIN: "TECH_ADMIN",
  OPERATIONS_DIRECTOR: "OPERATIONS_DIRECTOR",
  SALES_DIRECTOR: "SALES_DIRECTOR",
  FINANCE_MANAGER: "FINANCE_MANAGER",
  BILLING_MANAGER: "BILLING_MANAGER",
  MARKETING_MANAGER: "MARKETING_MANAGER",
  MARKETING_ASSISTANT: "MARKETING_ASSISTANT",
  STOCK_MANAGER: "STOCK_MANAGER",
  COUNTER_MANAGER: "COUNTER_MANAGER",
  CAISSIERE: "CAISSIERE",
  INVOICER: "INVOICER",
  ORDER_PREPARER: "ORDER_PREPARER",
};

const Permission = {
  COUNTRY_READ: "COUNTRY_READ",
  COUNTRY_WRITE: "COUNTRY_WRITE",
  MARKETING_WRITE: "MARKETING_WRITE",
  USER_ADMIN: "USER_ADMIN",

  PRODUCT_READ: "PRODUCT_READ",
  PRODUCT_WRITE: "PRODUCT_WRITE",

  DISCOUNT_READ: "DISCOUNT_READ",
  DISCOUNT_WRITE: "DISCOUNT_WRITE",

  PREORDER_READ: "PREORDER_READ",
  PREORDER_UPDATE_STATUS: "PREORDER_UPDATE_STATUS",

  INVOICE_CREATE: "INVOICE_CREATE",
  PAYMENT_VALIDATE: "PAYMENT_VALIDATE",
  EXTERNAL_PAYMENT_LINKS_MANAGE: "EXTERNAL_PAYMENT_LINKS_MANAGE",

  PREPARATION_UPDATE: "PREPARATION_UPDATE",

  EXPORT_READ: "EXPORT_READ",
};

const ROLE_PERMISSIONS = {
  [AdminRole.SUPER_ADMIN]: Object.values(Permission),

  [AdminRole.TECH_ADMIN]: Object.values(Permission),

  [AdminRole.OPERATIONS_DIRECTOR]: [
    Permission.COUNTRY_READ,
    Permission.MARKETING_WRITE,
    Permission.USER_ADMIN,
    Permission.PRODUCT_READ,
    Permission.PRODUCT_WRITE,
    Permission.DISCOUNT_READ,
    Permission.DISCOUNT_WRITE,
    Permission.PREORDER_READ,
    Permission.PREORDER_UPDATE_STATUS,
    Permission.PAYMENT_VALIDATE,
    Permission.PREPARATION_UPDATE,
    Permission.EXPORT_READ,
  ],

  [AdminRole.SALES_DIRECTOR]: [
    Permission.COUNTRY_READ,
    Permission.MARKETING_WRITE,
    Permission.PRODUCT_READ,
    Permission.DISCOUNT_READ,
    Permission.DISCOUNT_WRITE,
    Permission.PREORDER_READ,
    Permission.PREORDER_UPDATE_STATUS,
    Permission.INVOICE_CREATE,
    Permission.EXTERNAL_PAYMENT_LINKS_MANAGE,
    Permission.EXPORT_READ,
  ],

  [AdminRole.FINANCE_MANAGER]: [
    Permission.COUNTRY_READ,
    Permission.PREORDER_READ,
    Permission.PAYMENT_VALIDATE,
    Permission.EXTERNAL_PAYMENT_LINKS_MANAGE,
    Permission.EXPORT_READ,
  ],

  [AdminRole.BILLING_MANAGER]: [
    Permission.COUNTRY_READ,
    Permission.PREORDER_READ,
    Permission.PREORDER_UPDATE_STATUS,
    Permission.INVOICE_CREATE,
    Permission.EXTERNAL_PAYMENT_LINKS_MANAGE,
    Permission.EXPORT_READ,
  ],

  [AdminRole.MARKETING_MANAGER]: [
    Permission.COUNTRY_READ,
    Permission.MARKETING_WRITE,
    Permission.PRODUCT_READ,
    Permission.DISCOUNT_READ,
    Permission.EXPORT_READ,
  ],

  [AdminRole.MARKETING_ASSISTANT]: [
    Permission.COUNTRY_READ,
    Permission.MARKETING_WRITE,
    Permission.PRODUCT_READ,
    Permission.DISCOUNT_READ,
    Permission.EXPORT_READ,
  ],

  [AdminRole.STOCK_MANAGER]: [
    Permission.COUNTRY_READ,
    Permission.PRODUCT_READ,
    Permission.PRODUCT_WRITE,
    Permission.PREORDER_READ,
    Permission.PREPARATION_UPDATE,
  ],

  [AdminRole.COUNTER_MANAGER]: [
    Permission.COUNTRY_READ,
    Permission.PREORDER_READ,
    Permission.PAYMENT_VALIDATE,
    Permission.EXTERNAL_PAYMENT_LINKS_MANAGE,
    Permission.EXPORT_READ,
  ],

  [AdminRole.CAISSIERE]: [
    Permission.COUNTRY_READ,
    Permission.PREORDER_READ,
    Permission.PAYMENT_VALIDATE,
    Permission.EXTERNAL_PAYMENT_LINKS_MANAGE,
  ],

  [AdminRole.INVOICER]: [
    Permission.COUNTRY_READ,
    Permission.PREORDER_READ,
    Permission.INVOICE_CREATE,
    Permission.EXTERNAL_PAYMENT_LINKS_MANAGE,
  ],

  [AdminRole.ORDER_PREPARER]: [
    Permission.COUNTRY_READ,
    Permission.PREORDER_READ,
    Permission.PREPARATION_UPDATE,
  ],
};

function getRolePermissions(role) {
  return ROLE_PERMISSIONS[role] || [];
}

function hasPermission(role, permission) {
  const permissions = getRolePermissions(role);
  return permissions.includes(permission);
}

function normalizePermissionList(value) {
  if (!Array.isArray(value)) return [];
  const valid = new Set(Object.values(Permission));
  return [
    ...new Set(
      value
        .map((item) => String(item || "").trim())
        .filter((item) => valid.has(item)),
    ),
  ];
}

function getEffectivePermissions(role, permissionAllow = [], permissionDeny = []) {
  const merged = new Set([
    ...getRolePermissions(role),
    ...normalizePermissionList(permissionAllow),
  ]);

  for (const permission of normalizePermissionList(permissionDeny)) {
    merged.delete(permission);
  }

  return [...merged];
}

module.exports = {
  AdminRole,
  Permission,
  ROLE_PERMISSIONS,
  getRolePermissions,
  getEffectivePermissions,
  normalizePermissionList,
  hasPermission,
};
