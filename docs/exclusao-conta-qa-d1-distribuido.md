# Átrio Católico — coordenador D1 de QA (sem produção)

**31/10/2026 — Proposta técnica em rascunho, sem deploy, sem contas reais e sem exclusão real.**

Esta etapa sucede a PR #82 (checkpoints SQLite de QA) e depende da sequência #73 → #74 → #77 → #78 → #79 → #80 → #81 → #82. A issue #72 permanece aberta.

## Objetivo e arquivos

- `cloudflare/account-deletion-audit/qa-d1-schema.sql`: tabela autônoma `qa_privacy_runs`, com restrição SQL que aceita **somente** a fixture fictícia `qa-delete-alice`. O arquivo **não é uma migração de produção** e não é aplicado ao banco de avatares existente.
- `cloudflare/account-deletion-audit/src/qa-d1-coordinator.js`: serviço isolado, sem rota, sem cron, sem binding configurado e sem métodos de exclusão de usuários. Tem as funções `acquire`, `renew`, `acknowledge`, `release` e `status`.
- `qa-d1-coordinator.test.js`: executa o SQL real em SQLite de arquivo com duas conexões simultâneas, usando um adaptador mínimo da API preparada do D1; não acessa a Cloudflare.

## Regras de segurança

1. A aquisição do bloqueio usa **uma única instrução SQL com UPSERT condicional e RETURNING**, que permite nova posse apenas quando o lease anterior expirou e a execução não está concluída. Geração sempre crescente.
2. Avanços de fase usam **um único UPDATE condicional e RETURNING**: o token, a geração, a ordem exata e o prazo de validade precisam coincidir. Se outro executor assumiu, o antigo não consegue confirmar.
3. O verificador de resultado é um callback de teste que deve retornar `true` antes de se confirmar uma etapa. Erro, retorno falso ou queda durante a confirmação não escreve o checkpoint.
4. A ordem de oito fases é fixa e a etapa equivalente à remoção de Firebase Auth só pode ser reconhecida depois de todas as anteriores. **O coordenador não remove nada:** registra apenas o estado simulado.
5. `status` retorna progresso agregado e não revela token, documento, UID de usuário real, e-mail ou dados pessoais.
6. O código não recebe nome de banco, UID arbitrário, SQL de cliente, path de recurso, token de usuário ou autorização de remoção.

## Lacunas cruciais antes de produção

**Não implantar este schema ou código em D1 real.** É somente homologação da lógica SQL. Mesmo uma operação atômica de checkpoint **não torna atômicas operações externas** em Firebase, Cloudinary e FCM. Um Worker que perdeu o lease pode ainda ter uma requisição externa em andamento; é necessário fencing end-to-end, controle real de novas escritas e verificação de dados por fase.

Para um processo de produção, ainda precisamos:

- Ambiente de QA **remoto separado**, com acesso explicitamente autorizado, IAM mínimo, testes de concorrência reais e restauração de estado, sem usar o D1 do avatar.
- Identidade verificada, autorização administrativa controlada, possibilidade de cancelar/pausar, logs sem PII e políticas de retenção.
- Inventário de todas as coleções, subcoleções órfãs, dados compartilhados e mídias legadas, sem assumir que ausência de dados indexados significa ausência total.
- Bloqueio de novas escritas com regras reais, correção de falhas em todas as origens, verificações pós-exclusão, exclusão do Auth por último e protocolo de conclusão confiável.
- Página HTTPS de exclusão publicada, responsável pelo atendimento e política de privacidade, e testes fechados Play somente após homologação efetiva.

## Execução de testes offline

O workflow existente de privacidade já executa os testes Node, com a opção SQLite experimental, e cria um banco temporário para cada cenário. Não usa chaves, Cloudflare remota nem Firebase real.

`node --experimental-sqlite --test cloudflare/account-deletion-audit/src/qa-d1-coordinator.test.js`

A OTA, o Play App Signing e os backups originais não são alterados nesta PR.
