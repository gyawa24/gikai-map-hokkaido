import assert from "node:assert/strict";
import test from "node:test";

import { extractFactionLeadershipLabels } from "../../site/src/lib/memberRoles.mjs";

test("extracts only an exact chair role in trailing faction parentheses", () => {
  assert.deepEqual(extractFactionLeadershipLabels("無所属（議長）"), ["議長"]);
  assert.deepEqual(extractFactionLeadershipLabels("市政クラブ（副議長）"), ["副議長"]);
  assert.deepEqual(extractFactionLeadershipLabels("市政クラブ ( 副議長 ) "), ["副議長"]);
  assert.deepEqual(extractFactionLeadershipLabels("議長会"), []);
  assert.deepEqual(extractFactionLeadershipLabels("議会運営委員長"), []);
  assert.deepEqual(extractFactionLeadershipLabels(undefined), []);
});
