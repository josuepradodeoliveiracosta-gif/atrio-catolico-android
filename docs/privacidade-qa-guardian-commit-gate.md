# Proteção das gravações do Átrio Guardião — ensaio QA

**31/10/2026 — Proposta não implantada. Não utiliza contas reais.**

Etapa seguinte à PR #90 para avançar na segurança da exclusão de contas antes do teste fechado no Play Console. A issue #72 permanece aberta.

## Implementação

`cloudflare/account-deletion-audit/src/qa-guardian-commit-gate.js` envolve um adaptador Firestore fictício e intercepta o método `commit` que o código **real** do Guardião utiliza em:

- `processDocument`: casos de revisão, advertências, avisos e retenções com cópia protegida.
- `scanOnce`: processamento de cada documento identificado no ciclo, com o mesmo controle para os commits produzidos.
- `reviewCase`: restauração ou confirmação de uma retenção existente.
- `resolveReviewCase`: encerramento e orientação administrativa.

A camada de QA identifica o titular por referências consistentes no lote de gravações, valida os caminhos admitidos, confere o UID em documentos originais recuperados pelo adaptador de testes e admite uma operação na barreira SQLite **antes** de executar `db.commit`.

Quando há revisor, o ticket envolve **titular e moderador**; o congelamento de qualquer um impede a gravação. Falhas ou verificação inconclusiva deixam o ticket registrado e impedem que a conta seja declarada completamente congelada.

A camada também rejeita deliberadamente os métodos `create` e `update` que não foram revisados. Isso evidencia que operações administrativas de configuração e progresso do cron precisam de uma estratégia própria antes de integrar o Guardião à barreira.

## Testes

`qa-guardian-commit-gate.test.js` exerce funções reais do Guardião com um armazenamento Firestore fictício em memória e a barreira de QA sobre SQLite local. Abrange:

- Caso de revisão criado corretamente para conta ativa.
- Recusa de novo caso ou aviso de conta congelada.
- Restauração administrativa envolvendo duas contas, e recusa quando moderador ou titular está congelado.
- Resolução de triagem e varredura com isolamento entre contas.
- Falhas ambíguas no commit e verificações negativas que retêm a operação aberta.
- Operações já em andamento, antes da ativação do freeze, que precisam terminar.
- Recusa de lote com caminhos inesperados, donos incompatíveis ou operações sem cobertura.
- **Teste negativo intencional:** chamada direta ao adaptador original ainda ignora essa camada.

## Limitações — bloqueio de produção

**O Worker Guardião original não importa nem executa este adaptador.** O teste não equivale a proteção ativa de contas reais, nem assegura acesso IAM limitado ou controle dos Workers já implantados.

O verificador `verifyEffect` é uma função de QA injetada. A versão real exigirá conferir todos os documentos efetivamente gravados, administradores ativos, identidade e escopo dos conteúdos, além de evitar transições incompatíveis com a retenção de provas. A barreira atual não cobre `db.update` de `guardian_config/policy` e `guardian_runtime/last_scan`, nem os auxiliares automáticos de outros sistemas, e não deve ser aplicada sem análise dessas escritas.

A interligação de D1 e Firestore é distribuída; não há transação única. Quedas, retries e permissões de serviço exigem auditoria e reconciliação de estado. O código só admite identidades artificiais `qa-freeze-alice` e `qa-freeze-bob`; não pode ser implantado como autenticação de usuários reais.

O Átrio ainda precisa concluir o bloqueio privilegiado do Push, o processo de exclusão efetiva, o portal HTTPS, as decisões de retenção e a homologação integral para submissão à Play Store.

## Custo e segurança

A CI já executa todos os `src/*.test.js` pelo Node 22 com SQLite experimental. Sem Cloudflare remota, Firebase real, Cloudinary real, chaves, credenciais, alteração de main, APK/AAB, backups, OTA ou assinatura permanente.
