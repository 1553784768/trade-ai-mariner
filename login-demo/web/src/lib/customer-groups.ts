import type { Customer } from "./trade-types";

const TIER_ORDER: Record<string, number> = { A: 0, B: 1, C: 2 };

export function groupCustomersByCategory(customers: Customer[]) {
  const grouped = new Map<string, Customer[]>();
  for (const customer of customers) {
    const category = customer.main_category.trim();
    grouped.set(category, [...(grouped.get(category) || []), customer]);
  }
  return [...grouped.entries()]
    .map(([category, items]) => ({
      category,
      customers: [...items].sort(
        (left, right) =>
          (TIER_ORDER[left.tier] ?? 3) - (TIER_ORDER[right.tier] ?? 3) ||
          left.name.localeCompare(right.name, "zh-CN"),
      ),
    }))
    .sort((left, right) => {
      if (!left.category) return 1;
      if (!right.category) return -1;
      return left.category.localeCompare(right.category, "zh-CN");
    });
}
