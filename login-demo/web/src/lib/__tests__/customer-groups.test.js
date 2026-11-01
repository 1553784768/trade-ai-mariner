import { describe, expect, test } from "vitest";

import { groupCustomersByCategory } from "../customer-groups";

describe("groupCustomersByCategory", () => {
  test("groups by product category, sorts tiers, and keeps uncategorized last", () => {
    const groups = groupCustomersByCategory([
      { id: 1, name: "Beta Buyer", tier: "B", main_category: "工业水泵" },
      { id: 2, name: "Unknown Buyer", tier: "", main_category: "" },
      { id: 3, name: "Alpha Buyer", tier: "A", main_category: "工业水泵" },
      { id: 4, name: "Toy Buyer", tier: "C", main_category: "玩具" },
    ]);

    expect(groups.map((group) => group.category)).toEqual(["工业水泵", "玩具", ""]);
    expect(groups[0].customers.map((customer) => customer.name)).toEqual(["Alpha Buyer", "Beta Buyer"]);
  });
});
