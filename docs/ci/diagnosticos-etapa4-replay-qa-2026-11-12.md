# Etapa 4 — Reprodução controlada de diagnósticos (incremento QA)

Data: 12/11/2026. Este documento integra a PR em draft #258. **Não modifica produção nem reproduz automaticamente incidentes reais.**

## O que foi implementado

O módulo `scripts/ci_diagnostic_replay.py` executa novamente **nove casos inteiramente sintéticos e determinísticos** contra o classificador `scripts/ci_failure_classifier.py`. Esses casos incluem falha Kotlin, contrato de CI, fixture de Rules, mock de SHA, dois sinais de emulador, erro genérico inconclusivo, log que contém exemplos de falhas em um job bem-sucedido, estado não verificado e mensagens de erro muito distantes entre si.

O resultado contém exclusivamente IDs de cenários, códigos de regras, estados esperados/observados e resultado da comparação. **Não contém o texto dos logs sintéticos** nem logs reais, dados privados, credenciais ou comandos para produção.

### Como repetir a classificação em isolamento

O comando é seguro para uma cópia local de código de QA em ambiente Python, sem configuração de Firebase, Cloudflare, secrets ou acesso à rede:

```bash
python3 -m scripts.ci_diagnostic_replay --json replay.json --markdown replay.md
python3 -m unittest scripts.test_ci_failure_classifier scripts.test_ci_diagnostic_replay -v
```

Para reproduzir apenas um cenário controlado:

```bash
python3 -m scripts.ci_diagnostic_replay --case kotlin_reference --json replay.json --markdown replay.md
```

O classificador retornará código diferente de zero se algum caso divergir do resultado esperado; cenários não conhecidos são rejeitados. Nenhum comando arbitrário ou arquivo de log do usuário é aceito pelo reprodutor.

### Reproduzir falhas reais do aplicativo — procedimento separado

A reprodução determinística verifica **as regras do diagnóstico**, não compila Android nem reproduz uma falha do Firebase real. Quando necessário, utilizar os procedimentos e ambientes de QA já existentes:

1. Registrar SHA, ID do run e ID do job, verificação afetada e conclusão do job; não usar como evidência de HEAD atual um snapshot histórico.
2. Para falhas de lógica Python/CI, executar a suíte de `unittest` apropriada num checkout isolado, sem tokens.
3. Para Rules, utilizar os testes já existentes em `tests/security` e **emulador local isolado**, sem usar credenciais ou endpoints de produção.
4. Para Android, reaproveitar o job de compilação de debug `Compilar Android de testes` no workflow existente; não usar release, assinatura oficial, OTA nem deploy.
5. Anexar links aos jobs, SHA e resultado observado. **Não anexar log bruto** ao relatório público ou aos artefatos de classificação.
6. Se o problema não puder ser reproduzido sem rede/segredos ou ambiente de produção, interromper e solicitar revisão humana antes de prosseguir.

### Critérios de aceite e limitações

- Nove casos determinísticos aprovados; testes do reprodutor no check obrigatório existente de Firestore.
- Nenhum workflow, permissão ou novo gatilho foi adicionado. Sem auto-rerun, SSH, CodeQL extra, Firebase deploy ou bot de produção.
- Preservar o status `inconclusive` quando as evidências não permitirem classificar uma causa.
- Os exemplos são intencionalmente conhecidos pelo classificador; isso **não demonstra desempenho em falhas inéditas**. A etapa 5 deve incluir casos de avaliação independentes e validação operacional do relatório consolidado da PR #257.
- `main` e backups continuam sem alterações; PR permanece em draft e exige revisão humana antes de qualquer merge.

Este incremento corresponde à **reprodução da camada de diagnóstico**; a reprodução controlada de falhas funcionais do aplicativo depende dos jobs isolados já existentes e não foi automatizada nesta alteração.
