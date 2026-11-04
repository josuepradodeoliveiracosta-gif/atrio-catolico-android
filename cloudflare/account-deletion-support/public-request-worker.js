/* Public Átrio Católico account-deletion request information.
 * Static and privacy-preserving: no log, cookie, tracker, database, login,
 * dynamic user data or deletion promises. Requests go to the support email.
 * This does NOT implement back-end account deletion.
 */
const EMAIL='atriocatolico.privacidade@gmail.com';
const SUBJECT=encodeURIComponent('Átrio Católico — solicitação de exclusão de conta e dados');
const PAGE=String.raw`<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>Solicitar exclusão de conta e dados | Átrio Católico</title>
<meta name="description" content="Solicite a exclusão da conta e de dados associados ao Átrio Católico sem precisar instalar o aplicativo.">
<style>
:root{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#fbf9f7;color:#302b2a;font-synthesis:none}
*{box-sizing:border-box}body{margin:0}header{background:#542631;color:#fff;padding:28px 18px}
main,header>div,footer>div{max-width:740px;margin:auto}header h1{font-size:1.65rem;margin:0 0 6px}header p{margin:0;color:#f6e6e7}
main{padding:28px 18px 42px}h2{font-size:1.12rem;margin-top:30px}
p,li{line-height:1.7}a{color:#6e2940}a:focus-visible{outline:3px solid #b17b45;outline-offset:3px}
.cta{display:inline-block;background:#64293b;color:white;padding:15px 20px;text-decoration:none;border-radius:8px;font-weight:650;margin:12px 0 6px}
.note{border-left:4px solid #b17b45;padding:10px 16px;background:#f3ece4}
footer{background:#f0eae5;border-top:1px solid #ddd3ca;padding:18px;font-size:.9rem}
</style>
</head>
<body>
<header><div><h1>Átrio Católico</h1><p>Solicitação de exclusão de conta e dados</p></div></header>
<main>
<h2>Solicite mesmo sem ter o aplicativo instalado</h2>
<p>Você pode iniciar a solicitação de exclusão da sua conta do Átrio Católico e dos dados pessoais a ela associados enviando uma mensagem ao canal de privacidade abaixo. Não é necessário reinstalar o aplicativo.</p>
<p><a class="cta" href="mailto:atriocatolico.privacidade@gmail.com?subject=__SUBJECT__">Solicitar exclusão por e-mail</a></p>
<p>Endereço para contato: <a href="mailto:atriocatolico.privacidade@gmail.com">atriocatolico.privacidade@gmail.com</a></p>
<h2>Como fazer o pedido</h2>
<ol>
<li>Envie uma mensagem com o assunto “Exclusão de conta e dados — Átrio Católico”.</li>
<li>Informe o endereço de e-mail vinculado à sua conta e solicite a exclusão da conta e dos dados associados.</li>
<li>O atendimento poderá solicitar confirmação de titularidade por um procedimento seguro antes de realizar a exclusão.</li>
</ol>
<div class="note"><p><strong>Privacidade:</strong> nunca envie sua senha, CPF, documentos ou códigos de autenticação por e-mail. O pedido por e-mail não realiza o apagamento automaticamente; a exclusão exige verificação e processamento efetivo.</p></div>
<h2>Quais dados estão relacionados?</h2>
<p>A solicitação envolve a conta e os dados associados a ela, como informações de perfil, conteúdo enviado à comunidade e registros vinculados ao uso do aplicativo, observadas as exceções de retenção que sejam legalmente justificadas e comunicadas ao titular.</p>
<p>Se ainda possuir o aplicativo, você também pode utilizar o caminho de solicitação disponível nas configurações da conta.</p>
</main>
<footer><div>Átrio Católico — atendimento de privacidade. Esta página apenas recebe a solicitação pelo seu aplicativo de e-mail; não coleta dados diretamente neste site.</div></footer>
</body></html>`;
const HTML=PAGE.replace('__SUBJECT__',SUBJECT);
const HEADERS={
 'Content-Type':'text/html; charset=utf-8',
 'Cache-Control':'public,max-age=300',
 'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
 'Strict-Transport-Security':'max-age=31536000; includeSubDomains',
 'X-Content-Type-Options':'nosniff',
 'Referrer-Policy':'no-referrer',
 'X-Frame-Options':'DENY'
};
addEventListener('fetch',event=>{
 const request=event.request;
 const url=new URL(request.url);
 const legal=(url.pathname==='/'||url.pathname==='/exclusao'||url.pathname==='/exclusao-de-conta');
 if(!legal){
   event.respondWith(new Response('Não encontrado',{status:404,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}}));
   return;
 }
 if(request.method!=='GET'&&request.method!=='HEAD'){
   event.respondWith(new Response('Método não permitido',{status:405,headers:{'Allow':'GET, HEAD','Cache-Control':'no-store'}}));
   return;
 }
 event.respondWith(new Response(request.method==='HEAD'?null:HTML,{status:200,headers:HEADERS}));
});
