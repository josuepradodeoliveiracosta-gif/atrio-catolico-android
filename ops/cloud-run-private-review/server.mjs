/**
 * Candidate-only Cloud Run bootstrap. Never run locally or through GitHub
 * Actions: private-read-runtime rejects missing Cloud Run identity metadata.
 * The server receives requests ONLY after Cloud Run's Invoker IAM enforcement.
 */
import {createServer} from 'node:http';
import {initializeApp,applicationDefault} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore} from 'firebase-admin/firestore';
import {createPrivateDeletionReadRuntime}
  from '../../cloudflare/account-deletion-audit/src/private-read-runtime.js';
import {createPrivateReviewHttpHandler}
  from '../../cloudflare/account-deletion-audit/src/cloud-run-private-handler.js';

const project='atrio-catolico';
const port=Number(process.env.PORT);
if(!Number.isInteger(port)||port<1||port>65535)
  throw Error('cloud_run_private_port_required');
const app=initializeApp({
  credential:applicationDefault(),projectId:project
});
const auth=getAuth(app);
const store=getFirestore(app);
const db=Object.freeze({
  app,
  collection:name=>store.collection(name)
});
const reader=createPrivateDeletionReadRuntime({app,auth,db});
const server=createServer(createPrivateReviewHttpHandler({reader}));
server.requestTimeout=10000;
server.headersTimeout=5000;
server.keepAliveTimeout=3000;
server.maxRequestsPerSocket=8;
server.listen(port,'0.0.0.0');
// No route, log or callback in this process performs deletion, writes to
// Firestore, changes Auth, or invokes Cloudinary/D1. IAM is an external gate.
process.on('SIGTERM',()=>server.close());
