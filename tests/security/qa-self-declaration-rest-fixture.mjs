import assert from 'node:assert/strict';

export async function assertDeclarationRequiresInteger(uid, reviewExpiresAt) {
  const project = 'demo-atrio-v11';
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const claims = {aud: project, sub: uid, user_id: uid, email_verified: true,
    iat: now, exp: now + 3600, auth_time: now,
    iss: `https://securetoken.google.com/${project}`, firebase: {sign_in_provider: 'custom'}};
  const token = `${encode({alg: 'none', typ: 'JWT'})}.${encode(claims)}.`;
  const parent = `http://127.0.0.1:8089/v1/projects/${project}/databases/(default)/documents/users/${uid}`;
  // O SDK serializaria o número 18 como inteiro. O REST preserva o tipo explicitado.
  function create(minimumAge) {
    return fetch(`${parent}/chatAgeEligibility?documentId=current`, {
      method: 'POST', headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({fields: {
        status: {stringValue: 'declared_18_plus'}, minimumAge,
        policyVersion: {stringValue: '2026-11-selfdecl-qa-v1'},
        reviewExpiresAt: {timestampValue: reviewExpiresAt.toDate().toISOString()}
      }})
    });
  }
  const refused = await create({doubleValue: 18});
  const error = await refused.json();
  assert.equal(refused.status, 403, JSON.stringify(error));
  assert.equal(error.error?.status, 'PERMISSION_DENIED');
  const accepted = await create({integerValue: '18'});
  const document = await accepted.json();
  assert.equal(accepted.status, 200, JSON.stringify(document));
  assert.deepEqual(document.fields.minimumAge, {integerValue: '18'});
}
