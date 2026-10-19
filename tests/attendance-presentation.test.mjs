import assert from "node:assert/strict";
import test from "node:test";

import { getAttendanceStatus, hasAttendanceIncident } from "../src/lib/attendance/presentation.ts";

test("an open shift is shown as in progress, even when it has no configured schedule", () => {
  assert.equal(getAttendanceStatus({ status: "open", incompleteBreaks: false, scheduledMinutes: null }), "open");
});

test("closed shifts distinguish incomplete breaks, missing schedules, and complete shifts", () => {
  assert.equal(getAttendanceStatus({ status: "closed", incompleteBreaks: true, scheduledMinutes: 480 }), "incomplete");
  assert.equal(getAttendanceStatus({ status: "closed", incompleteBreaks: false, scheduledMinutes: null }), "unscheduled");
  assert.equal(getAttendanceStatus({ status: "closed", incompleteBreaks: false, scheduledMinutes: 480 }), "closed");
});

test("incident filters include a missing schedule, incomplete break, lateness, or early departure", () => {
  const normal = { incompleteBreaks: false, scheduledMinutes: 480, latenessMinutes: 0, earlyDepartureMinutes: 0 };
  assert.equal(hasAttendanceIncident(normal), false);
  assert.equal(hasAttendanceIncident({ ...normal, scheduledMinutes: null }), true);
  assert.equal(hasAttendanceIncident({ ...normal, incompleteBreaks: true }), true);
  assert.equal(hasAttendanceIncident({ ...normal, latenessMinutes: 1 }), true);
  assert.equal(hasAttendanceIncident({ ...normal, earlyDepartureMinutes: 1 }), true);
});
