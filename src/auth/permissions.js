// src/auth/permissions.js
// Définition des rôles d'administrateurs et de leurs permissions associées, utilisées pour contrôler l'accès aux différentes fonctionnalités de l'admin.

const AdminRole = {
  SUPER_ADMIN: "SUPER_ADMIN",
  TECH_ADMIN: "TECH_ADMIN",
  OPERATIONS_DIRECTOR: "OPERATIONS_DIRECTOR",
  SALES_DIRECTOR: "SALES_DIRECTOR",
  BILLING_MANAGER: "BILLING_MANAGER",
  MARKETING_ASSISTANT: "MARKETING_ASSISTANT",
  STOCK_MANAGER: "STOCK_MANAGER",
  COUNTER_MANAGER: "COUNTER_MANAGER",
  INVOICER: "INVOICER",
  ORDER_PREPARER: "ORDER_PREPARER",
};

const Permission = {
  COUNTRY_READ: "COUNTRY_READ",
  COUNTRY_WRITE: "COUNTRY_WRITE",
  PRODUCT_READ: "PRODUCT_READ",
  PRODUCT_WRITE: "PRODUCT_WRITE",
  DISCOUNT_READ: "DISCOUNT_READ",
  DISCOUNT_WRITE: "DISCOUNT_WRITE",
  PREORDER_READ: "PREORDER_READ",
  PREORDER_UPDATE_STATUS: "PREORDER_UPDATE_STATUS",
  INVOICE_CREATE: "INVOICE_CREATE",
  PAYMENT_VALIDATE: "PAYMENT_VALIDATE",
  PREPARATION_UPDATE: "PREPARATION_UPDATE",
  EXPORT_READ: "EXPORT_READ",
};

const allPermissions = Object.freeze(Object.values(Permission));

const ROLE_PERMISSIONS = Object.freeze({
  [AdminRole.SUPER_ADMIN]: allPermissions,
  [AdminRole.TECH_ADMIN]: allPermissions,
  [AdminRole.OPERATIONS_DIRECTOR]: [
    Permission.COUNTRY_READ,
    Permission.PRODUCT_READ,
    Permission.PRODUCT_WRITE,
    Permission.DISCOUNT_READ,
    Permission.DISCOUNT_WRITE, // AJOUT
    Permission.PREORDER_READ,
    Permission.PREORDER_UPDATE_STATUS,
    Permission.PAYMENT_VALIDATE,
    Permission.PREPARATION_UPDATE,
    Permission.EXPORT_READ,
  ],
  [AdminRole.SALES_DIRECTOR]: [
    Permission.COUNTRY_READ,
    Permission.PRODUCT_READ,
    Permission.DISCOUNT_READ,
    Permission.DISCOUNT_WRITE, // AJOUT
    Permission.PREORDER_READ,
    Permission.PREORDER_UPDATE_STATUS,
    Permission.INVOICE_CREATE,
    Permission.EXPORT_READ,
  ],
  [AdminRole.BILLING_MANAGER]: [
    Permission.COUNTRY_READ,
    Permission.PREORDER_READ,
    Permission.PREORDER_UPDATE_STATUS,
    Permission.INVOICE_CREATE,
    Permission.PAYMENT_VALIDATE,
    Permission.EXPORT_READ,
  ],
  [AdminRole.MARKETING_ASSISTANT]: [
    Permission.COUNTRY_READ,
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
    Permission.PREORDER_UPDATE_STATUS,
    Permission.INVOICE_CREATE,
    Permission.PAYMENT_VALIDATE,
  ],
  [AdminRole.INVOICER]: [
    Permission.COUNTRY_READ,
    Permission.PREORDER_READ,
    Permission.INVOICE_CREATE,
    Permission.PAYMENT_VALIDATE,
  ],
  [AdminRole.ORDER_PREPARER]: [
    Permission.COUNTRY_READ,
    Permission.PREORDER_READ,
    Permission.PREPARATION_UPDATE,
  ],
});

function getRolePermissions(role) {
  return ROLE_PERMISSIONS[role] || [];
}

function hasPermission(role, permission) {
  return getRolePermissions(role).includes(permission);
}

module.exports = {
  AdminRole,
  Permission,
  ROLE_PERMISSIONS,
  getRolePermissions,
  hasPermission,
};
