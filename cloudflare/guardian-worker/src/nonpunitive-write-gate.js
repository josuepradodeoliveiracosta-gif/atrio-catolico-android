// Átrio Guardião V2: barreira de escrita não punitiva antes do commit.
// Esta barreira não fornece identidade IAM, quota global nem autorização de deploy.
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const CASE_ID = /^guard_[a-f0-9]{32}$/;
const TARGET = /^posts\/[A-Za-z0-9_-]{1,128}(?:\/replies\/[A-Za-z0-9_-]{1,128})?$/;
const RESOURCE = /^projects\/[a-z][a-z0-9-]{4,29}\/databases\/\(default\)\/documents$/;

function reject() { throw Error('guardian_v2_nonpunitive_write_denied'); }
function object(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function exactKeys(value, expected) {
  return object(value) && Object.keys(value).sort().join(',') === [...expected].sort().join(',');
}
function str(fields, key) { return fields?.[key]?.stringValue; }
function stamp(fields, key) { return fields?.[key]?.timestampValue; }
function createOnly(write, path, allowedFields) {
  if (!exactKeys(write, ['update','currentDocument']) ||
      !exactKeys(write.update, ['name','fields']) ||
      !exactKeys(write.currentDocument, ['exists']) ||
      write.currentDocument.exists !== false ||
      write.update.name !== path ||
      !exactKeys(write.update.fields, allowedFields)) reject();
  return write.update.fields;
}

/**
 * Somente a transação original de triagem V2: caso + auditoria + aviso + verify.
 * Qualquer delete, transform, updateMask, quarentena ou caminho extra é negado.
 * A operação continua sendo executada por quem chamou db.commit: este módulo
 * valida o contrato, mas NÃO concede privilégios de servidor.
 */
export function enforceNonpunitiveBatch(writes, {
  resource, caseId, ownerUid, targetPath, sourceUpdateTime, action
} = {}) {
  if (!RESOURCE.test(resource || '') || !CASE_ID.test(caseId || '') ||
      !ID.test(ownerUid || '') || !TARGET.test(targetPath || '') ||
      typeof sourceUpdateTime !== 'string' || sourceUpdateTime.length < 8 ||
      !['review','warn'].includes(action) ||
      !Array.isArray(writes) || writes.length !== 4) reject();

  const parts = targetPath.split('/');
  const isReply = parts.length === 4;
  const casePath = resource+'/guardian_cases/'+caseId;
  const auditPath = resource+'/guardian_audit/'+caseId;
  const noticePath = resource+'/guardian_notices/'+ownerUid+'/items/'+caseId;
  const fields = createOnly(writes[0], casePath, [
    'engine','ownerUid','targetPath','targetType','postId',
    ...(isReply ? ['replyId'] : []),
    'ruleCode','sourceUpdateTime','reason','status','source','createdAt'
  ]);
  const expectedStatus = action === 'warn' ? 'warned' : 'review';
  if (str(fields,'engine') !== 'v2' ||
      str(fields,'ownerUid') !== ownerUid ||
      str(fields,'targetPath') !== targetPath ||
      str(fields,'targetType') !== (isReply ? 'reply' : 'post') ||
      str(fields,'postId') !== parts[1] ||
      (isReply && str(fields,'replyId') !== parts[3]) ||
      str(fields,'status') !== expectedStatus ||
      str(fields,'source') !== 'guardiao' ||
      str(fields,'sourceUpdateTime') !== sourceUpdateTime ||
      !/^[a-z_]{2,60}$/.test(str(fields,'ruleCode') || '') ||
      typeof str(fields,'reason') !== 'string' ||
      str(fields,'reason').length > 200 ||
      !stamp(fields,'createdAt')) reject();

  const audit = createOnly(writes[1], auditPath, ['event','caseId','at','actor']);
  if (str(audit,'event') !== action ||
      str(audit,'caseId') !== caseId ||
      str(audit,'actor') !== 'guardian_v2' ||
      stamp(audit,'at') !== stamp(fields,'createdAt')) reject();

  const notice = createOnly(writes[2], noticePath, [
    'title','body','caseId','ruleCode','action','createdAt'
  ]);
  if (str(notice,'caseId') !== caseId ||
      str(notice,'ruleCode') !== str(fields,'ruleCode') ||
      str(notice,'action') !== action ||
      str(notice,'title') !== 'Átrio Guardião' ||
      typeof str(notice,'body') !== 'string' ||
      str(notice,'body').length > 500 ||
      stamp(notice,'createdAt') !== stamp(fields,'createdAt')) reject();

  if (!exactKeys(writes[3], ['verify','currentDocument']) ||
      writes[3].verify !== resource+'/'+targetPath ||
      !exactKeys(writes[3].currentDocument, ['updateTime']) ||
      writes[3].currentDocument.updateTime !== sourceUpdateTime) reject();

  return writes;
}
