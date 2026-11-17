import {accounts, documents, moderator} from '../fixtures.mjs';

export const projectId = 'demo-atrio-v11';
export const [alice, bob] = accounts;
export {moderator};

export function pilotFlags(enabled = false) {
  return [
    ['app_config/conversations', {
      enabled, minorPolicyApproved: enabled, version: '2026-11-v1',
      safetyReviewVersion: '2026-11-safety-v1'
    }],
    ['app_config/chat_groups', {
      enabled, minorPolicyApproved: enabled, version: '2026-11-groups-v1'
    }]
  ];
}

// A admissão é provisionada pelo contexto privilegiado do Emulator. São dados de teste.
export function pilotDocuments(now) {
  const reviewExpiresAt = new Date(now.getTime() + 86400000);
  const rows = new Map(documents(now));
  for (const entry of pilotFlags()) rows.set(...entry);
  for (const {uid} of accounts) {
    rows.set(`users/${uid}/chatAgeEligibility/current`, {
      status: 'eligible', minimumAge: 18, policyVersion: '2026-11-18plus-qa-v1', reviewExpiresAt
    });
    rows.set(`users/${uid}/chatGroupAccess/eligibility`, {
      status: 'approved', policyVersion: '2026-11-group-safety-v1', reviewExpiresAt
    });
  }
  rows.set('admins/' + moderator.uid, {enabled: true});
  return [...rows];
}
