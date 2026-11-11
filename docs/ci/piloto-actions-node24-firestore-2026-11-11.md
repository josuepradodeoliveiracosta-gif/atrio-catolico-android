# Piloto de modernização das GitHub Actions — job Firestore

**Data:** 11/11/2026. **Escopo:** apenas o job obrigatório `Regras de seguranca Firestore` em `.github/workflows/selos-ci.yml`. O job Android, workflows de publicação, CodeQL, OTA e demais rotinas permanecem inalterados.

## Por que esta mudança

A [PR #243](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/243) comprovou o uso de **Node.js 22.23.4** na suíte Firestore, sem os avisos `npm WARN EBADENGINE` vistos com Node 20. Contudo, o log ainda apresentava um aviso sobre o **runtime Node 20 das actions** `checkout@v4`, `setup-node@v4` e `setup-java@v4`.

**Distinção:** `node-version: '22'` governa a versão que roda o Firebase Emulator e os testes; as versões das actions determinam o runtime da própria action. A atualização de uma não substitui a outra.

## Piloto restrito (reversível por PR)

| Action do job Firestore | Antes | Piloto |
| --- | --- | --- |
| Checkout | `actions/checkout@v4` | `actions/checkout@v7` + `persist-credentials: false` |
| Preparar Node | `actions/setup-node@v4` | `actions/setup-node@v7` |
| Preparar Java | `actions/setup-java@v4` | `actions/setup-java@v6` |

O piloto **mantém** Node 22 para os testes, Java 17, a chave de cache npm `tests/security/package-lock.json`, `npm ci`, `npm test`, todos os testes locais de preflight e o emulador Firestore. Os gatilhos, timeouts, concorrência e permissão `contents: read` não mudam. O job `Compilar Android de testes` continua com suas actions anteriores, para isolar o risco e permitir comparação posterior.

O teste offline `test_node24_actions_pilot_isolated_to_firestore` exige essas invariantes no check obrigatório de regras Firestore.

## Critérios de aprovação

1. Job Firestore completo, com todos os contratos, emuladores e pré-voos, **aprovado** na PR.
2. `Compilar Android de testes`, revisão de dependências, segurança do repositório, conferência de versão e as quatro análises CodeQL **aprovadas**.
3. Confirmar no log que as três novas actions executaram sem erro; verificar a remoção do aviso de runtime Node 20 associado às três actions antigas, distinguindo qualquer aviso relativo a outras actions.
4. Nenhuma alteração em release, assinatura de APK, deploy, credenciais, regras de produção, Cloudflare, Firebase real, backups ou branch protection.
5. Se houver regressão, não incorporar; medir duração antes/depois com amostras comparáveis e **não alegar ganho de desempenho sem evidência**.

## Referências

- [actions/checkout](https://github.com/actions/checkout)
- [actions/setup-node](https://github.com/actions/setup-node)
- [actions/setup-java](https://github.com/actions/setup-java)
- [Política de minutos no repositório público](politica-minutos-actions-repositorio-publico.md)

**Decisão:** validar um job obrigatório por vez; não incorporar indiscriminadamente as PRs automáticas do Dependabot que alteram muitos workflows, principalmente os de distribuição e publicação.
