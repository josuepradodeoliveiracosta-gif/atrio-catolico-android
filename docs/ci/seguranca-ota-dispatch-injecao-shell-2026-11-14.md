# Segurança OTA — entradas `workflow_dispatch` são dados, não código de shell

**Data:** 14/11/2026 (America/Fortaleza).  
**Base:** `96cbbe735ece5d74ea8092aba26c6ec516d0237d` (main após PR #282).  
**Escopo:** pré-voo da publicação oficial de APK, exclusivamente em branch/PR. Nenhuma publicação, assinatura, execução manual de `workflow_dispatch`, gravação em produção, alterações de variáveis, secrets, backup, IAM/WIF ou `main`.

## Falha identificada

Em `.github/workflows/ota-publish-release.yml`, o passo `Conferir parâmetros obrigatórios` usava diretamente `inputs.confirmation` e `inputs.mode` dentro de aspas no bloco `run: |` do Bash. O GitHub expande expressões antes de executar o script. Caso uma entrada contenha substituição de comandos — por exemplo, `$(...)` — a expansão de shell pode executá-la mesmo entre aspas. O campo de confirmação é uma string controlada pelo autor do disparo; o campo de modo é choice, mas também foi protegido para defesa em profundidade. Isso representa uma **superfície de injeção**; não há evidência de exploração.

## Correção

- O passo recebe `RELEASE_MODE` e `RELEASE_CONFIRMATION` via `env`, usando `inputs.mode` e `inputs.confirmation` como **valores**.
- A validação usa `"$RELEASE_MODE"` e `"$RELEASE_CONFIRMATION"`, sem inserir expressões do evento dentro de `run`. Valores de variáveis expandidos pelo Bash não são reanalisados como comandos.
- O modo é verificado explicitamente contra `validate` e `publish`; qualquer outro valor falha com saída não zero.
- Mantidos: confirmação literal `PUBLICAR ATRIO`, exigências de homologação OTA, e-mail, moderação, SHA-256 e certificado; validação de assinatura e origem; `publish-release` condicionado a aprovação e execução manual na `main`; assinatura, publicação e gates existentes inalterados.

## Testes e evidências

`scripts/test_ota_release_gate.py` foi ampliado para verificar estaticamente que nenhuma expressão de `inputs` permanece no script Bash de parâmetros e para executar **somente esse fragmento Bash em um diretório temporário** com um ambiente simulado.

Testes cobrem:
1. Confirmação legítima `PUBLICAR ATRIO` aprovada no preflight (com aprovações **fictícias locais**).
2. Confirmação contendo `$(touch <marcador temporário>)` rejeitada e nenhum comando de toque executado.
3. Modo adulterado com substituição de comandos rejeitado, sem executar o comando.
4. Modo `validate` preservado, sem depender de aprovação de publicação.
5. Gate obrigatório de publicação e sua restrição a `workflow_dispatch` permanecem presentes.

O módulo também é executado nos dois checks obrigatórios: `Detectar segredos em arquivos e histórico Git` e `Regras de seguranca Firestore`. A suíte não baixa APKs, não usa credenciais e não publica releases. Os workflows obrigatórios continuam seus demais testes, sem supressão de cobertura.

## Limites e próximos controles

- A mudança corrige **a injeção no passo estudado**, não assegura que todos os demais workflows e comandos estejam livres de injeção.
- Revisar `ota-publish-release.yml` por outras formas de interpretação de entradas e, separadamente, verificar SHA de actions, permissões de publicação e integridade de artefatos.
- Esperar todos os checks da PR terminarem com sucesso antes de qualquer merge, sujeito à autorização expressa do proprietário.
