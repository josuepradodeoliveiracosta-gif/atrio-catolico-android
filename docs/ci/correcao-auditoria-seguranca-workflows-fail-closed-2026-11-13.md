# Segurança dos GitHub Actions — corrigir auditoria permissiva sem quebrar proteção da main

**Data:** 13/11/2026, fuso America/Fortaleza.  
**Base auditada:** `15e08ca269236dbaf7b25152ecedd2ac3057247a` (`main`).  
**Escopo:** scanner estático de workflows e seus testes, sem execução externa, implantação, alteração de credenciais, do Guardião, Firebase/Cloudflare, regras de proteção, release ou backups.

## 1. Falha confirmada e impacto

O check obrigatório `Detectar segredos em arquivos e histórico Git`, em `.github/workflows/security-audit.yml`, usava:

```bash
set -euo pipefail
! grep -RInE '...pull_request_target...|...permissions...write-all...' .github/workflows
echo 'OK: nenhum pull_request_target ou write-all encontrado'
```

O operador de negação `!` no Bash **inverte o código de retorno** da correspondência e não provoca `errexit` nesse contexto. Quando `grep` encontra uma linha proibida, o shell pode continuar até `echo OK`, retornando sucesso. Logo, **o resultado verde do check anterior não comprova que esta regra era efetivamente aplicada**. Não há evidência de comprometimento da conta ou de exploração da falha; trata-se de uma **lacuna real de validação**.

A política antiga também possuía um falso positivo estrutural: a `main` contém um uso **legítimo e específico** de `pull_request_target` em `.github/workflows/proteger-repositorio.yml`, necessário à verificação contra exclusões em massa. Não seria seguro simplesmente mudar para `grep` sem exceção; isso quebraria a proteção existente.

## 2. Política nova: falhar fechado com exceção explícita e verificável

O novo `scripts/ci_workflow_security.py`, sem dependências externas:

1. Examina todos os `.github/workflows/*.yml` e `.yaml` (diretório obrigatório e não vazio).
2. **Rejeita `permissions: write-all`** em qualquer workflow, incluindo aspas e comentários finais.
3. **Rejeita `pull_request_target` em qualquer workflow diferente de `proteger-repositorio.yml`**, inclusive variantes de chave com aspas e mapeamentos inline suspeitos.
4. Exige exatamente um gatilho `pull_request_target` no protetor existente; se o arquivo desaparecer ou o gatilho for modificado, **falha**.
5. Verifica invariantes do protetor: permissão de leitura, apenas um checkout, checkout do SHA da **base confiável**, `persist-credentials: false`, busca da PR apenas para comparação dos SHAs, `merge-base`, execução do verificador `guard_exclusoes.py`, sem referência de checkout ao head não confiável e sem `secrets.`, `id-token: write` ou permissões de escrita diretas no protetor.
6. Devolve erro não zero em qualquer violação e imprime só nomes de arquivos e regras violadas, **sem imprimir linhas que poderiam conter credenciais**.

O scanner foi adicionado ao check obrigatório de segurança, **preservando integralmente** `scripts/check_public_secrets.py --history`, o checkout com histórico completo e `persist-credentials: false`. Nenhuma proteção existente foi removida.

## 3. Testes de regressão

O módulo `scripts/test_ci_workflow_security.py` cobre offline:

- `main` proposta com 40 workflows e único uso autorizado de `pull_request_target`;
- workflow normal e protetor legítimo;
- uso não autorizado do evento (inclusive com aspas e `on:` inline);
- `permissions: write-all` com diferentes formas sintáticas;
- linhas de comentários que não devem provocar falsos positivos;
- remoção ou duplicação do evento do protetor;
- substituição do checkout da base pelo head da PR;
- escrita de token, permissão elevada e segundo checkout no protetor;
- perda de invariantes do verificador e diretório ausente/vazio;
- garantia de que `security-audit.yml` chama os novos testes e scanner e mantém o scanner histórico de segredos.

Os testes rodam **dentro do próprio check obrigatório de segurança**, antes da auditoria dos workflows. O módulo foi incluído ainda na suíte do check obrigatório `Regras de seguranca Firestore`. Assim, duas trilhas distintas de checks obrigatórios o exercitam.

## 4. Limites conhecidos e decisões fora do escopo

- O scanner é uma política estática conservadora para **dois riscos concretos**; **não é um parser completo de YAML, uma análise de todas as expressões GitHub Actions, nem certificação de ausência de vulnerabilidades**. Permissões de escrita restritas e necessárias para operações manuais, como `security-events: write` do CodeQL ou `contents: write` de publicação oficial, **não são proibidas** indiscriminadamente.
- Não modifica `pull_request_target` do protetor, `workflow_run` do relatório diagnóstico, `workflow_dispatch` manual, `cron` do Guardião nem gates de produção.
- A auditoria precedente identificou que `guardiao-v2-moderator-runner.yml`, apesar do título mencionando desligamento, possui schedule ativo e jobs já executados com identidade WIF. A confirmação de efeitos reais exige auditoria específica, inclusive logs e controles de produção; **não alterar/desativar agendamento ou identidades sem aprovação separada**.
- Para futuras modificações em `proteger-repositorio.yml`, revisar a alteração do diff e executar testes do protetor antes de autorizar merge; invariantes estáticas não impedem toda modificação maliciosa possível.
- A nova implementação é candidata em **branch + PR draft**, sem merge automático. Avaliação de segurança global ainda requer exame das permissões WIF, ambientes e riscos de execução privilegiada; **não atribuir nota 10/10 antes das evidências**.

## 5. Critérios de aceite

1. Check `Detectar segredos em arquivos e histórico Git` verde, inclusive teste e scanner novos.
2. Check `Regras de seguranca Firestore` verde com novos testes, e `Compilar Android de testes` preservado.
3. Código QL em quatro linguagens, verificação de versão, revisão de dependências e proteção contra exclusões aprovados.
4. Testes negativos provam que `write-all` e `pull_request_target` indevido provocam erro.
5. Diff limitado aos dois workflows de CI, scanner, testes e este documento; **zero mudanças em produção, backups, Guardião, release, Firebase ou Cloudflare**.

**Regra de decisão:** avançar com merge apenas com autorização expressa do proprietário após validação real dos checks da PR.
