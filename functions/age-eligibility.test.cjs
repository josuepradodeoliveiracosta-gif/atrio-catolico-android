"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  AGE18_METHOD,
  AGE18_MINIMUM,
  AGE18_POLICY_VERSION,
  normalizeAgeAttestation,
} = require("./age-eligibility.cjs");

test("adult declaration creates only a minimal age eligibility record", () => {
  assert.deepEqual(normalizeAgeAttestation({
    attests18Plus: true,
    policyVersion: AGE18_POLICY_VERSION,
  }), {
    status: "eligible",
    minimumAge: AGE18_MINIMUM,
    policyVersion: AGE18_POLICY_VERSION,
    method: AGE18_METHOD,
  });
});

test("negative declaration revokes eligibility without receiving birth data", () => {
  assert.equal(normalizeAgeAttestation({
    attests18Plus: false,
    policyVersion: AGE18_POLICY_VERSION,
  }).status, "ineligible");
});

test("rejects birth dates, documents, extra keys, and unknown policy versions", () => {
  for (const data of [
    { attests18Plus: true, policyVersion: AGE18_POLICY_VERSION, dateOfBirth: "1990-01-01" },
    { attests18Plus: true, policyVersion: AGE18_POLICY_VERSION, documentImage: "..." },
    { attests18Plus: "true", policyVersion: AGE18_POLICY_VERSION },
    { attests18Plus: true, policyVersion: "old-policy" },
    null,
  ]) {
    assert.throws(() => normalizeAgeAttestation(data), /invalid_attestation/);
  }
});
