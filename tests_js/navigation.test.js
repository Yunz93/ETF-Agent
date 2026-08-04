import test from "node:test";
import assert from "node:assert/strict";

import { MOBILE_SIDEBAR_MAX, SIDEBAR_COLLAPSE_MIN } from "../js/constants.js";
import { resolveSidebarPreference } from "../js/navigation.js";

test("sidebar defaults to collapsed when preference is missing", () => {
  assert.equal(resolveSidebarPreference(null), "collapsed");
  assert.equal(resolveSidebarPreference(""), "collapsed");
  assert.equal(resolveSidebarPreference("collapsed"), "collapsed");
});

test("sidebar expands only when preference is explicitly expanded", () => {
  assert.equal(resolveSidebarPreference("expanded"), "expanded");
});

test("drawer breakpoint covers tablet and aligns with collapse rail", () => {
  assert.equal(MOBILE_SIDEBAR_MAX, 1180);
  assert.equal(SIDEBAR_COLLAPSE_MIN, MOBILE_SIDEBAR_MAX + 1);
});
