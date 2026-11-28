# Pré-integração de autorização e orçamento (QA local)

O adaptador official-preflight.mjs chama o classificador oficial policy.js diretamente, após os gates de orçamento e autorização do laboratório. Somente fixtures de fórum. Não é importado pelo Worker e não tem I/O, persistência, credenciais ou permissões de escrita. Os valores de orçamento são sintéticos; nenhuma reserva real ou comprovação IAM/WIF foi feita. Não usar como autorização remota. A proposta de revisão não equivale a punição.

Execução local: node --test tools/guardian-integration-lab/*.test.mjs

Resultado em Node 22.16.0: 377/377 testes JS (351 regressão + 26 novos), com policy.js original blob 11f19cf14f322cf142b7c267cca94e32296a036c e gates idênticos à branch. Sem APK, deploy, Firebase ou novos serviços. Kotlin/Compose não reexecutados nesta etapa.

Bloqueios: fonte de métricas confiável, reserva atômica real, separação efetiva de IAM/WIF, integração dos adaptadores de Firestore e homologação. Não alterar index.js, regras, workflows ou produção até essas validações.
