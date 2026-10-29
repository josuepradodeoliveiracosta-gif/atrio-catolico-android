# Átrio Guardião V2 — monitor independente na Cloudflare (29/10/2026)

**Worker exclusivamente QA:** `atrio-guardian-v2-qa`. Não se trata de ativação de moderação 24/7 ou de conexão contínua ao Firebase.

## Evidências

- O GitHub Actions `40966233058` confirmou a leitura real de dados sintéticos do Firestore QA usando GitHub OIDC / Google WIF e conta `guardian-qa-reader` com `roles/datastore.viewer`. Resultado do job `remote-qa-readonly`: `clear=1`, `hold_candidate=1`, `reports=1`, `error=0`.
- O cron Cloudflare permanece `*/15 * * * *`, mas o novo monitor consulta **apenas o status público do GitHub Actions na hora cheia UTC**, com duas requisições GET no máximo.
- O monitor está implementado em `src/github-qa-monitor.js`, integrado ao `scheduled()` e coberto por testes `github-qa-monitor.test.js`.
- A verificação do GitHub exige execução manual da branch `feature/guardiao-autonomo-20261029` e confere especificamente o job `remote-qa-readonly`. `skipped`, `failure`, `in_progress`, `missing` e `stale` **não são classificados como sucesso**.
- Resultados antigos (mais de 24 horas), API indisponível ou dados inconsistentes geram `stale`/`unavailable`. Apenas estado e idade agregada são registrados em log; não há conteúdo de publicações, token, URL de documento ou ID de usuário.

## Configuração Cloudflare verificada após implantação

```
GUARDIAN_V2_TEST_MODE=true
GUARDIAN_V2_ENABLED=false
GUARDIAN_V2_HOLD_ENABLED=false
GUARDIAN_V2_QA_SHADOW_READS=false
GUARDIAN_V2_QA_RUN_MONITOR=true
```

Nenhum secret Firebase, GitHub ou Google Cloud foi adicionado; o Worker não realiza consultas Firestore nem grava dados. Outros Workers, especialmente `atrio-push`, não foram modificados.

O endereço público `/health` permanece como teste de isolamento. O monitor deve ser observado nos logs da Cloudflare como `guardian_v2_qa_monitor` após uma execução agendada **na hora cheia UTC**; a implantação por si só não comprova que o próximo cron já disparou.

## Segurança e próximas etapas

1. Desativar após o teste a variável do repositório `GUARDIAN_QA_REMOTE_READY=false` via Termux, se ainda não foi feito. O MCP GitHub disponível não gerencia variables, portanto não há confirmação remota dessa alteração.
2. Confirmar nos logs reais da Cloudflare a primeira leitura do status público do GitHub. Nenhum novo workflow remoto é disparado pelo monitor.
3. Não armazenar service-account JSON no Worker. Para leitura contínua real do Firebase pela Cloudflare, criar identidade federada própria **sem chave longa** ou outra arquitetura segura, com separação estrita de projeto QA, antes de configurar `QA_SHADOW_READS=true`.
4. Só depois de validar e autorizar o backend de produção avaliar regras de moderação e intervenções reais. A `main`, backups, Firebase oficial e Worker Push continuam isolados.

**Limite importante:** este recurso é supervisão automática do **resultado do teste QA**, não classifica novas discussões continuamente. O teste remoto de conteúdo foi feito uma vez via GitHub Actions com dados sintéticos.
