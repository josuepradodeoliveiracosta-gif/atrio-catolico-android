/** Bootstrap de QA geral. Implantado inicialmente sem FCM, Auth nem dados reais.
 *  Fases posteriores exigem revisão explícita e substituição controlada.
 */
const PROJECT = 'atrio-catolico-qa-geral';
const NAME = 'atrio-qa-geral';
const json = (status, state) => new Response(JSON.stringify({
  service: NAME, environment: 'qa', state,
  firebase_project_id: PROJECT, push_enabled: false,
  deploy_status: 'bootstrap_only'
}), {status, headers: {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});

export default {
  async fetch(request, env) {
    if (env.ATRIO_GENERAL_QA_MODE !== 'true' ||
        env.ATRIO_GENERAL_QA_PROJECT !== PROJECT ||
        env.PUSH_ENABLED !== 'false' ||
        env.BROADCAST_ENABLED !== 'false' ||
        env.GUARDIAO_ENABLED !== 'false' ||
        env.QA_MANUAL_ENABLED !== 'false' ||
        env.ATRIO_QA_BOOTSTRAP_ONLY !== 'true' ||
        env.FIREBASE_SERVICE_ACCOUNT_JSON ||
        env.FIREBASE_WEB_API_KEY) return json(503, 'qa_configuration_denied');
    const path = new URL(request.url).pathname;
    if (!((request.method === 'GET' && path === '/health') ||
          (request.method === 'POST' && path === '/event')))
      return json(404, 'qa_route_denied');
    if (!env.PUSH_DB || typeof env.PUSH_DB.prepare !== 'function')
      return json(503, 'qa_d1_identity_denied');
    try {
      const row = await env.PUSH_DB.prepare(
        'SELECT project_id FROM atrio_qa_identity WHERE name = ? LIMIT 1'
      ).bind(NAME).first();
      if (row?.project_id !== PROJECT) return json(503, 'qa_d1_identity_denied');
    } catch { return json(503, 'qa_d1_identity_denied'); }
    if (path === '/event') return json(503, 'qa_events_disabled');
    return json(200, 'disabled');
  }
};
