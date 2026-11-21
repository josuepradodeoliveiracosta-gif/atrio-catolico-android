"use strict";

const AGE18_POLICY_VERSION = "2026-11-18plus-v1";
const AGE18_MINIMUM = 18;
const AGE18_METHOD = "local_birthdate_self_declaration";

function normalizeAgeAttestation(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new TypeError("invalid_attestation");
  }
  const keys = Object.keys(data).sort();
  if (keys.join(",") !== "attests18Plus,policyVersion" ||
      typeof data.attests18Plus !== "boolean" ||
      data.policyVersion !== AGE18_POLICY_VERSION) {
    throw new TypeError("invalid_attestation");
  }
  return {
    status: data.attests18Plus ? "eligible" : "ineligible",
    minimumAge: AGE18_MINIMUM,
    policyVersion: AGE18_POLICY_VERSION,
    method: AGE18_METHOD,
  };
}

module.exports = {
  AGE18_POLICY_VERSION,
  AGE18_MINIMUM,
  AGE18_METHOD,
  normalizeAgeAttestation,
};
