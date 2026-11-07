# Átrio Conversas — implementação isolada da etapa 1

Base de desenvolvimento: `main` em `626e70d7b544e549947aad5f58ae4bde8eb9a1d9`.
Origem: *Átrio Conversas — Plano Completo* (06/11/2026), páginas 3–11 e 14.

## Escopo implementado no código

- Caixa de entrada individual com busca, solicitações separadas, contador de
  mensagens não lidas, ordenação, silenciar, fixar e arquivar.
- Entrada por perfil público e perfil pessoal.
- Solicitação de contato por uma única mensagem inicial sem links, com **aceite
  explícito** do destinatário. Visualizar não aceita.
- Após aceite, mensagens de texto via transação Firestore, estados de envio e
  confirmação, carregamento incremental do histórico.
- Bloquear participante e denunciar uma mensagem selecionada, sem expor
  a conversa inteira ao painel de moderação.
- Controle de quem pode solicitar contato: de todos ou de ninguém.
- Validação no Firestore: somente dois participantes autorizados leem;
  mídia, GIF, documento, áudio e outros tipos não são gravados;
  verificar bloqueio tanto no pedido quanto no envio; impedir autorizações
  forjadas e leitura por terceiros.
- Cloudflare Worker: evento autenticado pelo Firebase, valida mensagem
  já persistida, autor e destinatário, bloqueios e silenciamento;
  avisa FCM sem expor conteúdo. Android só exibe uma prévia genérica e
  revalida Firestore ao abrir a conversa.
- Fonte grande, botões de toque adequados, cores vinho/dourado existentes.

## O que **não** está pronto

A etapa 1 ainda requer compilação em CI, emulador Firebase, testes reais com
duas contas e a implantação controlada. A presença dos arquivos não é prova
de que os testes passaram. Os recursos seguintes **não foram liberados**:
confirmações completas de leitura/entrega, respostas citadas, reações, edição,
exclusão, envio de discussões por cartão, grupos e mensagens temporárias.

Mídia e chamadas permanecem excluídas de TODAS as etapas. Este chat não possui
criptografia ponta a ponta: o Firestore tem controles de acesso por regras,
o que é diferente de E2EE. Não anunciar criptografia ponta a ponta.

## Compatibilidade com o selo de integridade de Selos V2

O arquivo original `firestore.rules` foi **preservado byte a byte** porque
`scripts/selos-v2-production-guarded-deploy.mjs` mantém um fingerprint
criptográfico fixado da última política aprovada. Não alteramos os fingerprints,
a ferramenta protegida nem o script de deploy antigo.

As regras novas do chat estão em
`firebase/atrio-conversas-v1.rules.fragment`. O teste
`tests/security/atrio-conversas.test.mjs` combina o fragmento com a
política oficial **apenas em memória**, dentro do emulador. Esse fragmento
não é publicado automaticamente pelo `firebase.json`.

Antes de ativar chat real, a política combinada precisa de **nova auditoria,
aprovação explícita e procedimento de deploy independente**. Nunca atualizar
o hash fixado de Selos V2 só para silenciar o CI.

## Ativação em segurança (fail-closed)

**NÃO** ativar o chat em produção somente por merge de código.
A configuração `app_config/conversations` é somente leitura no APK, alterável
por operador de serviço no Console/Admin SDK. Ausente/desativada mantém
**todos** os writes e reads novos do chat fechados. No ambiente de homologação,
após implantar e testar as regras, criar:
```json
{"enabled": true, "version": "2026-11-v1"}
```
O valor é exclusivamente para homologação **após** revisar política de menores,
privacidade e abusos. Não compartilhar credenciais ou API de serviço no app.

Cada destinatário também deve optar por `requests: "all"` em
`users/{uid}/chatSettings/privacy`. Padrão é `none`.

## Riscos e limites documentados

- O plano exige política especial para menores, prazos de retenção e limites
  de taxa. Ainda não há decisão final aprovada; manter o chat desligado em
  produção.
- Há uma única solicitação inicial por par de contas; ainda falta o limitador
  **global** do Guardião para solicitações em massa e mensagens repetitivas.
- Edição e exclusão não estão presentes; o usuário não verá botões falsos.
- Um push pode atrasar ou não chegar; FCM aceitar o evento não prova recebimento.
- Silenciar e arquivar são preferências individuais, não equivalem a bloquear.
- Chamadas e anexos não serão acrescentados por "atalho" de compartilhamento.
- O aviso push é **genérico e privado**, sem texto, independente da opção
  `showPushPreview` (que fica desabilitada na implementação inicial).
- Mensagens entregues ao servidor não devem ser descritas como "entregues
  ao aparelho" ou "lidas": faltam confirmações de recebimento/leitura.
- O primeiro limite técnico de mensagem no código é 1.500 caracteres,
  **provisório**, sujeito à aprovação do produto antes da abertura.
- A consulta da caixa de entrada tem limite inicial de 100 conversas; deverá
  ser paginada para escala. O histórico pagina de 40 em 40.
- Este PR não executa deploy de regras, Worker, FCM nem backend, não cria
  contas reais e não altera certificado, backups protegidos, versão Release
  nem dados dos usuários.

## Verificações necessárias para homologação

1. Regras no emulador: nenhuma leitura externa, solicitação, aceite,
   bloqueios concorrentes, ausência de anexos, denúncias limitadas.
2. Worker: autenticação, destinatário e preferências, prevenção de duplicados,
   tokens inválidos e falha de rede.
3. Android: compilar Debug e executar testes, conferir telas pequenas e fonte
   160%/200%, teclado, rotação e ausência de controles de mídia.
4. Duas contas reais de teste: convite, aceite, conversa, silenciamento,
   bloqueio durante envio, logout e re-login no mesmo aparelho.
5. Push: aplicativo aberto, fechado e segundo plano, privacidade na tela
   bloqueada e acesso negado caso a permissão tenha mudado.
6. Só depois da aprovação humana: planejar fase 2 de texto enriquecido e
   fase 3 de grupos de texto.

Revisar os resultados de CI no PR antes de qualquer merge para `main`.
