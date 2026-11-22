import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { PRIMARY_MOBILE_VIEWS, activeBottomTab } from "../../src/utils/mobileShell.js";

describe("mobileShell.activeBottomTab", () => {
  test("maps each primary view to its own bottom navigation tab", () => {
    for (const view of PRIMARY_MOBILE_VIEWS) {
      assert.equal(activeBottomTab(view), view);
    }
  });

  test("maps secondary views to the More drawer tab", () => {
    for (const view of ["calving", "breeding", "finance", "reports", "health-reports", "financial-reports", "settings", "users"]) {
      assert.equal(activeBottomTab(view), "more", view);
    }
  });
});
