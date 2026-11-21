const interestLabels = new Map([
  ['oracao', 'Oração'],
  ['formacao', 'Formação'],
  ['comunidade', 'Comunidade'],
  ['noticias_catolicas', 'Notícias católicas'],
]);
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const response = body => Response.json(body, {headers:{'Cache-Control':'private, no-store'}});
const unavailable = () => response({status:'unavailable'});
const postIdFor = (link, key) => link?.fields?.postIds?.mapValue?.fields?.[key]?.stringValue;

export async function handleProfileInterestDiscussion(request, {
  readBody, verifyViewer, readAsVisitor, readProtected,
}) {
  try {
    const input = await readBody(request);
    if (!input || !validId(input.profileUid) || !interestLabels.has(input.interestKey)
      || Object.keys(input).length !== 2) return unavailable();
    const {profileUid, interestKey} = input;
    const viewer = await verifyViewer(request);
    if (!viewer || !validId(viewer.uid) || !viewer.token) return unavailable();

    const profilePath = 'public_profiles/' + profileUid;
    const profile = await readAsVisitor(viewer.token, profilePath);
    const interests = profile?.fields?.interests?.arrayValue?.values;
    if (!interests?.some(value => value.stringValue === interestLabels.get(interestKey))) {
      return unavailable();
    }

    const linkPath = profilePath + '/interest_discussions/current';
    const link = await readProtected(linkPath);
    if (!link) return response({status:'no_link'});
    const postIds = link.fields?.postIds?.mapValue?.fields;
    if (!postIds || !link.updateTime) return unavailable();
    if (!Object.hasOwn(postIds, interestKey)) return response({status:'no_link'});
    const postId = postIdFor(link, interestKey);
    if (!validId(postId)) return unavailable();

    // O token da sessão aciona as Rules do mural. A conta de serviço só lê o vínculo.
    const post = await readAsVisitor(viewer.token, 'posts/' + postId);
    const title = post?.fields?.title?.stringValue;
    const authorUid = post?.fields?.uid?.stringValue;
    if (typeof title !== 'string' || !title.trim() || !validId(authorUid)) return unavailable();
    const blocked = await readAsVisitor(viewer.token,
      'users/' + viewer.uid + '/blockedMembers/' + authorUid);
    if (blocked) return unavailable();

    // A remoção ou troca do vínculo durante a consulta invalida o resultado.
    const currentLink = await readProtected(linkPath);
    if (currentLink?.updateTime !== link.updateTime || postIdFor(currentLink, interestKey) !== postId) {
      return unavailable();
    }
    return response({status:'available', postId, title});
  } catch {
    return unavailable();
  }
}
