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

## Política obrigatória: execução exclusivamente solicitada nesta conversa

**Clara, Miguel e Lúcia só podem atuar mediante pedido explícito do fundador nesta conversa.**
Nenhum job de CI, agendamento, Cron do Cloudflare, tarefa recorrente, inicialização de APK, evento de publicação ou serviço em segundo plano poderá disparar interações na comunidade oficial por conta própria.

- Uma autorização é limitada a **uma única sessão de teste**, com os cenários indicados no pedido. Não significa permissão para executar novamente em datas posteriores.
- Cada execução real precisará de autorização explícita na conversa, mesmo que o usuário tenha aprovado uma execução anterior.
- Somente bots claramente identificados como `BOT DE TESTE` podem gerar dados na comunidade. Não interagir com discussões de pessoas reais sem um pedido específico e consciente.
- **Nenhum agendamento é permitido.** Após completar a sessão, os bots permanecem inativos.
- O ambiente isolado de QA continua disponível para verificação do código, mas a execução de cenários na comunidade oficial deve ser feita apenas mediante comando na conversa.
- A existência de testes de CI para novas versões **não constitui** autorização para publicação real na comunidade.
- Não criar painel, botão ou configuração no perfil do fundador.
- **Estado atual:** a automação que cria contas e conteúdos na produção ainda não está instalada. Esta política é uma restrição de arquitetura, não uma confirmação de que a invocação pela conversa já está operacional.

