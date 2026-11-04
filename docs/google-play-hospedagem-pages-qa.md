# Átrio Católico — hospedagem de homologação Cloudflare Pages

**Data da verificação:** 02/11/2026  
**Escopo:** PR #71, QA isolado, sem produção, sem deploy e sem backup.

## O que foi criado de verdade

Consulta à API da conta Cloudflare conectada confirmou um projeto
Pages novo com estes atributos (os nomes não são segredos):

| Propriedade | Valor constatado |
| --- | --- |
| Projeto | atrio-catolico-privacidade-qa |
| Branch definida para publicação | qa-manual-review |
| Domínio reservado | atrio-catolico-privacidade-qa.pages.dev |
| Último deployment | null (nenhuma implantação) |
| Integração Git | não configurada |
| Domínios personalizados | nenhum confirmado |
| Recursos de produção alterados | nenhum |

**O domínio reservado NÃO equivale a um site publicado.** A criação do
projeto não hospeda ainda o formulário de exclusão ou a política de
privacidade. Não usar o endereço em Google Play Console nem como link
de privacidade do aplicativo.

## Barreiras contra publicação prematura

O gate estático em scripts/play_release_gate.py e o gate de acesso
HTTPS em scripts/play_web_live_preflight.py rejeitam expressamente
atrio-catolico-privacidade-qa.pages.dev como endereço de produção.
Regressões offline verificam o bloqueio. Nenhum dado real de usuários
ou credenciais do Cloudflare é incluído nos testes.

O modo de e-mail do gerador
cloudflare/account-deletion-support/build.mjs permanece condicionado
a revisão explícita do atendimento e de uma política de privacidade
HTTPS real. Não há liberação de envio ou exclusão automática.

## Para realizar a futura homologação, em ordem

1. Aprovar a versão final da política de privacidade: identificação
   do operador/controlador, contato público, finalidade, dados sensíveis
   relativos a religião, prestadores, retenção, exclusão e direitos LGPD.
   Confirmar que o fluxo administrativo *efetivamente consegue apagar*
   Auth, Firestore, mídia e notificações, com limites legais documentados.
2. Gerar os artefatos do site em modo local, usando o gerador
   protegido e o endereço público de contato
   atriocatolico.privacidade@gmail.com. Não armazenar senhas no
   repositório nem criar uma política fictícia para completar o build.
3. Submeter somente a versão de teste a revisão de segurança, operação
   e conteúdo. O projeto Pages de QA pode receber um deploy manual
   **somente em solicitação futura explícita de homologação**,
   acompanhado de testes e configuração específica de ambiente.
4. Confirmar no navegador, com leitura pública sem sessão, os links,
   política, informações exibidas, cabeçalhos de segurança e
   funcionamento de e-mail. Sem redirecionamento oculto, credenciais ou
   scripts que enviem dados pessoais por URL.
5. Só então criar a infraestrutura **separada de produção**, com URL
   própria e homologação independente, e cadastrar os endereços na
   Google Play Console. Nunca usar o projeto de QA como produção.

## Auditoria de custo e segurança

Não há execução de jobs ou implantação automática ligada ao novo
projeto. Criá-lo não prova conformidade LGPD, exclusão de conta ou
status "aprovado" na Play Console.

Referências:
- https://developers.cloudflare.com/pages/get-started/
- https://developers.cloudflare.com/pages/get-started/direct-upload/
- https://support.google.com/googleplay/android-developer/answer/13327111
