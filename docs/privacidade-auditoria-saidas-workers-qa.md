# Átrio Católico — auditoria de pontos de saída dos Workers (somente QA)

**31/10/2026. Sem deploy, sem uso de recursos reais e sem autorização de exclusão.**

Esta etapa continua a PR #87, dependente da cadeia #73 → #74 → #77 → #78 → #79 → #80 → #81 → #82 → #83 → #84 → #85 → #87. A issue #72 ainda impede a liberação do fluxo de exclusão de conta na Play Store.

## Resultado do levantamento

Foram fixados no arquivo `qa-worker-sink-manifest.json` **59 pontos sintáticos candidatos a operações externas ou persistentes**, distribuídos assim:

| Worker | Pontos candidatos |
|---|---:|
| Avatar | 30 |
| Guardião | 3 |
| Push | 26 |
| **Total** | **59** |

Os pontos incluem **leituras e escritas**, porque o detector é conservador: HTTP `fetch`, SQL preparado D1, commits do Guardião e chamadas aos helpers Cloudinary, Firestore e FCM. **59 não significa 59 pontos de escrita confirmados**, nem 59 rotas protegidas.

O módulo `qa-worker-sink-inventory.js` extrai linhas candidatas dos arquivos atuais `cloudflare/{avatar-worker,guardian-worker,push-worker}/src/index.js`; o teste `qa-worker-sink-inventory.test.js` compara a extração com o manifest registrado na PR. Se um ponto de chamada novo aparecer, um conhecido desaparecer ou o conteúdo de uma chamada mudar, o teste falha e obriga a equipe a revisar e atualizar explicitamente o registro.

O teste também verifica um caso de evasão: chamada a `fetch` colocada na mesma linha da declaração de uma nova função precisa ser detectada.

### Escopo do alerta

O inventário é um **alarme de revisão por comparação de código**, não um parser completo de JavaScript e não é um sistema de bloqueio de requisições. Ele pode não perceber:

- Chamadas dinâmicas, imports de módulos adicionais, novos wrappers, scripts ou código indireto que não contenha esses padrões.
- Novas gravações inseridas dentro de métodos existentes sem que a linha candidata à operação externa seja alterada.
- Alterações em configuração remota, permissões IAM, Workers já implantados e código que roda fora destes três arquivos.
- Requisições anteriores ao congelamento, caches, retries e Workers antigos.

**O próprio resultado do detector informa `productionProtected:false`.** Um teste aprovado significa apenas que o conjunto conhecido de chamadas não mudou sem revisão.

## Proteções realmente pendentes

A PR #87 já demonstrou que a execução direta de funções reais dos Workers **contorna a barreira de QA**. O presente inventário documenta e monitora esses pontos, mas **não os protege em produção**.

A próxima implementação segura precisa aplicar ingressos autorizados e auditáveis antes de **cada** efeito privilegiado, com um controle remoto de QA separado e desligado por padrão, e testar exaustivamente todas as rotas HTTP, cron e tentativas automáticas. O encerramento de um ticket exigirá verificação do estado externo correspondente; efeitos inconclusivos bloqueiam o freeze até reconciliação.

É necessário também proteger contas reais contra escritas com Admin SDK, manter marcadores Firestore sob autoridade administrativa, inventariar conteúdos e mídias legados, decidir retenção de moderação e disponibilizar um portal público HTTPS com backend completo antes de solicitar conformidade da Google Play.

## Custo e isolamento

O workflow atual de privacidade executa automaticamente os testes Node da pasta `cloudflare/account-deletion-audit/src/*.test.js`. O inventário só lê arquivos do checkout GitHub. **Não requer credenciais, Cloudflare remota, Firebase real, Cloudinary real, APK/AAB ou publicação.**

Quando uma alteração legítima em um ponto de saída for revisada, atualize manualmente o manifest com justificativa na PR. **Não regenere e aprove automaticamente** um snapshot sem revisar os caminhos impactados.

Nenhum backup, OTA, assinatura permanente ou versão de produção foi modificado.
