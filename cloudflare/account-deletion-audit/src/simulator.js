/**
 * Motor de homologação com dados fictícios, SEM acesso a Firebase, Cloudinary
 * ou rede. É IMPOSSÍVEL implantar este módulo como executor real: ele só
 * modifica arrays e Sets fornecidos pelo teste; não recebe adaptadores HTTP.
 */
import {makeDeletionPlan,ownedPrivatePath} from './inventory.js';
import {validUid} from './plan.js';

const PHASES = Object.freeze([
  'simulate_push_revocation',
  'simulate_cloudinary_cleanup',
  'simulate_recursive_firestore_cleanup',
  'simulate_auth_removal_last'
]);

/**
 * Mesmo uma simulação completa não é comprovante de exclusão real:
 * todos os checkpoints ficam confinados ao objeto de teste.
 */
export async function runDeletionSimulation({uid,request,fixture,journal,failAfter = null}) {
  if (!validUid(uid) || !fixture || fixture.simulationOnly !== true ||
      !Array.isArray(fixture.documents) || !Array.isArray(fixture.media) ||
      !Array.isArray(fixture.pushTokens) || !(fixture.authUids instanceof Set) ||
      !journal || !Array.isArray(journal.completed)) {
    throw Error('synthetic_fixture_required');
  }
  if (journal.uid != null && journal.uid !== uid) throw Error('checkpoint_uid_mismatch');
  if (!journal.plan) {
    journal.plan = makeDeletionPlan(uid,request,fixture);
    journal.uid = uid;
  }
  if (journal.plan.uid !== uid) throw Error('checkpoint_uid_mismatch');
  if (request?.fields?.status?.stringValue !== 'requested')
    throw Error('request_no_longer_pending');

  const stages = {
    simulate_push_revocation() {
      fixture.pushTokens = fixture.pushTokens.filter(row =>
        !(row.ownerUid === uid && journal.plan.pushTokenIds.includes(row.tokenId)));
    },
    simulate_cloudinary_cleanup() {
      fixture.media = fixture.media.filter(row =>
        !(row.ownerUid === uid && journal.plan.mediaIds.includes(row.publicId)));
    },
    simulate_recursive_firestore_cleanup() {
      // Simula apagar subcoleções antes dos pais; nenhuma API Firestore real.
      const paths = journal.plan.privatePaths.slice()
        .sort((a,b) => b.split('/').length - a.split('/').length);
      for(const path of paths) {
        if (!ownedPrivatePath(uid,path)) throw Error('cross_account_path');
        const index = fixture.documents.findIndex(row => row.path === path &&
          (row.ownerUid == null || row.ownerUid === uid));
        if(index >= 0) fixture.documents.splice(index,1);
      }
    },
    simulate_auth_removal_last() {
      fixture.authUids = new Set([...fixture.authUids].filter(id => id !== uid)); // Set local, não Firebase Authentication.
    }
  };
  for(const phase of PHASES) {
    if (journal.completed.includes(phase)) continue;
    if (phase === 'simulate_auth_removal_last' &&
        fixture.documents.some(row => ownedPrivatePath(uid,row.path))) {
      throw Error('orphan_private_data_before_auth');
    }
    stages[phase]();
    // Simula uma falha DEPOIS do efeito e ANTES do checkpoint durável.
    if(failAfter === phase) throw Error('simulated_interruption');
    journal.completed.push(phase);
  }
  return {
    status:'simulation_finished_not_production',
    phasesCompleted:journal.completed.length,
    allPhases:PHASES.length,
    userDataDeletedInProduction:false,
    pendingHumanReview:[...journal.plan.requiresManualReview]
  };
}

export const SIMULATION_PHASES = PHASES;
