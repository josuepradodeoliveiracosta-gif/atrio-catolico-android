# Três bots de QA — exclusivamente ambiente de testes

Clara, Miguel e Lúcia são três **identidades simuladas** usadas para verificar o funcionamento do Átrio Católico e as regras reais do Firestore em emulador local (projeto Firebase de demonstração `demo-atrio-v11`). **Não são contas de produção** e não aparecem no perfil do fundador nem na comunidade pública.

## Perfis e responsabilidades

- **Clara (BOT DE TESTE):** publica uma discussão, recebe avisos e marca uma notificação como lida.
- **Miguel (BOT DE TESTE):** responde na discussão e envia aviso de resposta no mesmo batch. Tenta acessar informações privadas e alterar discussões de terceiros; as regras devem rejeitar.
- **Lúcia (BOT DE TESTE):** responde, simula denúncias e verifica bloqueios contra identidade falsa e privilégios administrativos.

As três identidades executam operações como **usuários autenticados distintos**, por meio do SDK do Firebase contra o **emulador**. O teste cobre permissões de perfis, publicação, respostas, notificações internas, relatórios e detecção por regex de CPF fictício. Também verifica que a conversa e seus dados permanecem íntegros. Não é necessário um administrador do app para iniciar o teste.

## Execução e resultados

A suíte `tests/security/three-bots.test.mjs` roda junto com os testes de segurança:

```sh
cd tests/security
npm ci
npm test
```

O comando prepara as regras e executa os testes no emulador Firestore. A rotina também integra o job **Regras de seguranca Firestore** da workflow `.github/workflows/selos-ci.yml`, automaticamente em PRs para main, ou manualmente no GitHub Actions pela opção **Run workflow**, sem adicionar controles ao aplicativo.

O relatório de terminal mostra **PASS BOT-QA** para cada cenário e termina com JSON incluindo `productionWrites: 0`, `realAccountsCreated: 0` e contagem de verificações. Qualquer falha devolve código não-zero e marca o job em vermelho; não publica nada na comunidade real.

## Segurança, limites e escopo

- O antigo botão de criação no perfil fundador, o arquivo `AdminTestBotsPanel.kt` e a rota `POST /test-bots/provision` foram removidos. O Worker não precisa mais do escopo OAuth Identity Toolkit para administrar contas Firebase Auth.
- O sinalizador `TEST_BOTS_ENABLED` não tem uso no código atualizado e deve permanecer **desabilitado**, ou ser retirado da configuração ativa do Worker.
- Nenhum destes testes executa o app Android em um aparelho nem mede entrega real de Push FCM. O comportamento do Push no backend é verificado por outros testes unitários. Para testes E2E com três celulares, seria necessário infraestrutura adicional de dispositivos e contas de teste separadas.
- Não há bots publicando mensagens a cada hora no ambiente real, respostas automáticas em discussões de usuários, nem perfis falsos que se passam por humanos. Todo conteúdo simulado é isolado e etiquetado como teste.
- O teste de CPF valida a regra local `classifyGuardiao`, **não prova** recebimento de eventos pelo Cloudflare em produção. O problema anterior de detecção no APK exige depuração separada.

## Bots sob demanda na comunidade oficial (estrutura da próxima versão)

A comunidade oficial poderá receber uma conversa **claramente identificada como simulação** apenas quando o fundador solicitar uma sessão nesta conversa. A arquitetura utiliza:

- Cloudflare Queue privada `atrio-qa-manual-v19`, sem Cron e sem endpoints HTTP de ativação.
- Mensagem `{kind:"manual_chat_qa_v1",requestId:"...",createdAt:"..."}` enviada somente quando houver uma nova autorização explícita nesta conversa.
- O Worker usa três **perfis de serviço identificados como bots** (Clara, Miguel e Lúcia), escreve uma única discussão, duas respostas e dois avisos internos entre os próprios bots, e registra a execução em `qa_bot_runs/{requestId}`.
- Cada gravação verifica `exists:false` no commit atômico do Firestore. Reenviar o mesmo `requestId` não duplica publicações.
- Os textos de demonstração não contêm CPFs reais ou outros dados pessoais; o programa não responde a discussões de pessoas reais.
- Os perfis no Firestore **não representam três contas Firebase Auth com login**; a simulação de permissões de login continua ocorrendo no emulador Firebase.
- Não serão criadas interfaces ou botões no perfil do fundador, nem programação para execução espontânea.
- Nenhuma publicação deve ser efetuada durante a preparação da infraestrutura. Somente uma solicitação posterior específica do usuário autoriza inserir a primeira mensagem na fila.

A infraestrutura nova não substitui nem desativa os testes automatizados do emulador. A fila do Cloudflare é distinta desses testes e serve apenas para realizar **uma sessão real solicitada**.

## Resultado do primeiro teste oficial — sessão qa_chat_20261026_01

- Um comando por Cloudflare Queue foi aceito e reprocessado para diagnóstico com o **mesmo identificador idempotente**.
- O Worker registrou `qa_profile_http_403`: o Firestore negou a criação de perfil de teste. A execução parou **antes do commit das discussões e respostas**, conforme o fluxo `executeQaCommand`.
- Nenhuma execução foi classificada como `created`.
- Medidas de contenção: `QA_MANUAL_ENABLED=false`, fila sem backlog, sem Cron. `GUARDIAO_ENABLED` e `PUSH_ENABLED` permaneceram `true`.
- **Não reativar** antes de corrigir a permissão de gravação para a identidade de serviço no projeto Firebase/Google Cloud (necessária `datastore.entities.create`) e de obter **uma nova autorização explícita do fundador nesta conversa** para uma sessão adicional.
- Evitar concessão desnecessária de papéis administrativos amplos. Se for preciso um papel predefinido, `roles/datastore.user` permite acesso de leitura e escrita e deve ser avaliado quanto ao alcance. Preferir serviço exclusivo de QA com permissões mínimas.
