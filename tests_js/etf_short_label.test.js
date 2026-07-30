import test from "node:test";
import assert from "node:assert/strict";

import { etfShortLabel, resolveEtfDisplayName } from "../js/utils.js";

test("etfShortLabel prefers readable name abbreviations", () => {
  assert.equal(etfShortLabel("A500ETF华泰柏瑞", "563360"), "A500");
  assert.equal(etfShortLabel("红利低波ETF易方达", "563020"), "红利");
  assert.equal(etfShortLabel("标普500ETF博时", "513500"), "标普");
  assert.equal(etfShortLabel("纳指100ETF博时", "513100"), "纳指");
  assert.equal(etfShortLabel("恒生科技ETF易方达", "513010"), "恒科");
  assert.equal(etfShortLabel("黄金ETF博时", "159937"), "黄金");
});

test("etfShortLabel falls back to code suffix only when name is empty", () => {
  assert.equal(etfShortLabel("", "563360"), "360");
  assert.equal(etfShortLabel("", ""), "?");
});

test("resolveEtfDisplayName upgrades quote short names with registry friendly names", () => {
  assert.equal(
    resolveEtfDisplayName({
      name: "纳指ETF",
      symbol: "513100",
      quoteName: "纳指ETF",
      registryName: "纳指100ETF博时",
    }),
    "纳指100ETF博时",
  );
  assert.equal(
    resolveEtfDisplayName({
      name: "",
      symbol: "513100",
      quoteName: "纳指ETF",
      registryName: "纳指100ETF博时",
    }),
    "纳指100ETF博时",
  );
  assert.equal(
    resolveEtfDisplayName({
      name: "我的自定义纳指",
      symbol: "513100",
      quoteName: "纳指ETF",
      registryName: "纳指100ETF博时",
    }),
    "我的自定义纳指",
  );
});
