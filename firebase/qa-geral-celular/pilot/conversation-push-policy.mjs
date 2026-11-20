import {randomUUID} from 'node:crypto';

// Identidade fixada para o ensaio QA #199. Sem conexão ou configuração de deploy.
export const conversationPushIdentity = Object.freeze({
  projectId: 'atrio-catolico-qa-general',
  databaseId: '(default)',
  roundId: 'qa-199-push-isolado',
  ageMode: 'eligible',
  accounts: Object.freeze({
    'qa-nav-alice': 'alice.navegacao@qa.invalid',
    'qa-nav-bob': 'bob.navegacao@qa.invalid',
  }),
});

// Usar em cada concessão administrativa, inclusive na readmissão da mesma rodada.
export function createConversationPushAdmission(uid, admittedAt, expiresAt) {
  const {accounts, roundId} = conversationPushIdentity;
  if (!Object.hasOwn(accounts, uid) || !(admittedAt instanceof Date) ||
      !(expiresAt instanceof Date) || !(admittedAt < expiresAt)) {
    throw new Error('Concessão de push QA inválida');
  }
  return {
    roundId,
    status: 'active',
    email: accounts[uid],
    generation: randomUUID(),
    admittedAt,
    expiresAt,
  };
}
