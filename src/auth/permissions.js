// admin-app/src/auth/permissions.js
// Définition des rôles d'administrateurs et de leurs permissions associées, utilisées pour contrôler l'accès aux différentes fonctionnalités de l'admin.
// Ce module exporte les rôles d'administrateurs, les permissions disponibles, ainsi que des fonctions utilitaires pour vérifier les permissions d'un rôle donné.
// Les rôles sont définis avec des permissions spécifiques, et les fonctions `hasPermission` et `hasAnyPermission` permettent de vérifier si un rôle possède une permission particulière ou au moins une permission parmi une liste donnée.

// Miroir frontend des rôles + permissions admin

export const AdminRole = {
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

export const Permission = {
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

export const ROLE_PERMISSIONS = Object.freeze({
  [AdminRole.SUPER_ADMIN]: allPermissions,
  [AdminRole.TECH_ADMIN]: allPermissions,

  [AdminRole.OPERATIONS_DIRECTOR]: [
    Permission.COUNTRY_READ,
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
    Permission.PRODUCT_READ,
    Permission.DISCOUNT_READ,
    Permission.DISCOUNT_WRITE,
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

export function getRolePermissions(role) {
  return ROLE_PERMISSIONS[role] || [];
}

export function hasPermission(role, permission, userPermissions = []) {
  if (!role) return false;

  const rolePermissions = getRolePermissions(role);
  if (rolePermissions.includes(permission)) return true;

  if (Array.isArray(userPermissions) && userPermissions.includes(permission)) {
    return true;
  }

  return false;
}

export function hasAnyPermission(role, permissions = [], userPermissions = []) {
  return permissions.some((permission) =>
    hasPermission(role, permission, userPermissions),
  );
}