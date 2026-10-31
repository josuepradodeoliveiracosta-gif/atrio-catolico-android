/* Copie para config.js SOMENTE no ambiente web aprovado. Nunca registre senhas.
   A configuração Firebase Web (apiKey/authDomain/projectId/appId) é pública,
   mas deve corresponder ao projeto correto e usar restrições de API adequadas.
   O serviço só será habilitado depois da homologação do backend real. */
window.ATRIO_ACCOUNT_DELETION_REQUESTS_ENABLED = false;
window.ATRIO_FIREBASE_CONFIG = {
  apiKey: "SUBSTITUIR_PELO_FIREBASE_WEB_API_KEY",
  authDomain: "atrio-catolico.firebaseapp.com",
  projectId: "atrio-catolico",
  appId: "SUBSTITUIR_PELO_FIREBASE_WEB_APP_ID"
};
