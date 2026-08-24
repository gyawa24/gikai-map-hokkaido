import assert from "node:assert/strict";
import test from "node:test";

import { hasPublishedMemberThemes } from "../lib/member-activity-capability.mjs";

test("themes capability requires classified activity with at least one theme", () => {
  assert.equal(hasPublishedMemberThemes({}), false);
  assert.equal(hasPublishedMemberThemes({ legacy: { themes: ["防災"] } }), false);
  assert.equal(
    hasPublishedMemberThemes({ member: { classification_status: "classified", themes: [] } }),
    false,
  );
  assert.equal(
    hasPublishedMemberThemes({
      member: { classification_status: "classified", themes: ["防災"] },
    }),
    true,
  );
  assert.equal(
    hasPublishedMemberThemes(
      { member: { classification_status: "classified", themes: ["防災"] } },
      { minutesAccess: "restricted" },
    ),
    false,
  );
});
