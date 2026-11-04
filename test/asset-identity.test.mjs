import assert from "node:assert/strict";
import test from "node:test";
import { componentSlot, sameMsn, slotForIdentifier } from "../.test-dist/agent/lib/asset-identity.js";

test("MSN matching ignores numeric leading zeroes without changing source values", () => {
  assert.equal(sameMsn("05931", "5931"), true);
  assert.equal(sameMsn("0000", "0"), true);
  assert.equal(sameMsn("MSN-05931", "5931"), false);
  assert.equal(sameMsn("A-05931", "A-05931"), true);
});

test("database component labels map landing-gear positions to configured slots", () => {
  assert.equal(componentSlot("Landing Gear Nose"), "LandingGearNose");
  assert.equal(componentSlot("Main Landing Gear 1"), "LandingGearLeft");
  assert.equal(componentSlot("Landing Gear Main 2"), "LandingGearRight");
  assert.equal(componentSlot("Landing Gear"), null);
  assert.equal(slotForIdentifier("landing_gear_left_serial_number", "Landing Gear"), "LandingGearLeft");
});
