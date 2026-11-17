export const accounts = [
  {uid: 'qa-nav-alice', name: 'Alice QA', email: 'alice.navegacao@qa.invalid'},
  {uid: 'qa-nav-bob', name: 'Bob QA', email: 'bob.navegacao@qa.invalid'}
];

export function documents(now) {
  const bob = accounts[1];
  const profiles = accounts.flatMap(({uid, name}) => {
    const profile = {displayName: name, bio: 'Conta fictícia do QA Geral.', createdAt: now};
    return [
      ['profiles/' + uid, profile],
      ['public_profiles/' + uid, {...profile, uid}],
      ['users/' + uid + '/private/account', {onboardingStatus: 'complete'}],
      ['users/' + uid + '/chatSettings/privacy', {requests: 'none', readReceipts: false}],
      ['users/' + uid + '/chatAgeEligibility/current', {
        status: 'eligible', minimumAge: 18, policyVersion: '2026-11-18plus-qa-v1',
        reviewExpiresAt: new Date(now.getTime() + 86400000)
      }]
    ];
  });
  return [
    ['app_config/conversations', {
      enabled: false, minorPolicyApproved: false, version: '2026-11-v1',
      safetyReviewVersion: '2026-11-safety-v1'
    }],
    ['app_config/email_verification', {enabled: true, version: '2026-11-v1'}],
    ['app_config/community_rules', {enabled: false}],
    ['posts/qa-nav-bob-profile', {
      uid: bob.uid, authorName: bob.name, title: 'Publicação fictícia do QA Geral',
      body: 'Publicação de teste para abrir o perfil público de Bob QA.',
      category: 'Vida espiritual', createdAt: now
    }],
    ...profiles
  ];
}
