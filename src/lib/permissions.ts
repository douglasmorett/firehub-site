// Todos os módulos disponíveis no sistema
export const ALL_PERMISSIONS = [
  { key: "dashboard",    label: "Dashboard" },
  { key: "products",     label: "Produtos (preço e cadastro)" },
  { key: "franchisees",  label: "Franqueados" },
  { key: "orders",       label: "Pedidos" },
  { key: "routes",       label: "Logística / Rotas" },
  { key: "finance",      label: "Financeiro (completo)" },
  { key: "payables",     label: "Contas a Pagar (lançar boletos)" },
  { key: "invoices",     label: "Notas de Compras" },
];

// Módulos que FRANCHISEE tem acesso automático
const FRANCHISEE_PERMISSIONS = ["dashboard", "orders", "finance", "payables", "invoices", "products"];

export function hasPermission(userPermissions: string, key: string, role: string): boolean {
  if (role === "ADMIN") return true; // Super Admin vê tudo
  if (role === "FRANCHISEE") return FRANCHISEE_PERMISSIONS.includes(key); // Dono de restaurante
  if (!userPermissions) return false;
  return userPermissions.split(",").includes(key);
}
