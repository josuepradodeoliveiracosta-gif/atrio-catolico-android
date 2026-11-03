# Homologação de provedores — etapa isolada (03/11/2026)

**Situação: QA; produção e Play Store NÃO autorizadas.** Este documento acompanha a PR #71 e a pendência #72.

## Evidência obtida anteriormente

- O coordenador e os três clientes de QA Cloudflare executaram pelo Service Binding privado com HMAC e D1 exclusivo. Resultado hospedado: três canários `completed`, nenhuma operação em trânsito; todos os gatilhos temporários foram removidos.
- As versões de `atrio-avatares`, `atrio-guardian-v2` e `atrio-push` em produção permaneceram inalteradas.
- Uma busca **somente-leitura** no Cloudinary pelo prefixo `atrio-avatares/qa-delete-` nos tipos `upload` e `authenticated` retornou listas vazias. Isso **não prova** inexistência de recursos legados, derived, versões em backup ou outros tipos.

## Contrato adicional: limpeza de referências D1 *sintéticas*

A migration `cloudflare/privacy-freeze-stage/migrations/0004_qa_provider_refs.sql` cria **somente** no D1 QA tabelas com CHECK de UID, classes e nomes sintéticos. Não há dados pessoais, token FCM nem resource ID real. Nada é implantado automaticamente em bases produtivas.

O novo módulo `cloudflare/privacy-freeze-stage/src/qa-provider-reconciliation.js` contém um procedimento deliberadamente **não importado por nenhum Worker implantado**:
1. Validar UID e caso fixos de QA, autorização independente e congelamento distribuído.
2. Confirmar case na fase exata, sem operação em trânsito nem registro sujeito a revisão de moderação/retenção.
3. Verificar inventário de três referências sintéticas presentes, sem campos desconhecidos.
4. No D1, executar `batch` transacional: gravar checkpoint e remover precisamente as três referências. Lote com erro, corrida, ambiguidade ou contagem inesperada não certifica êxito.
5. Fazer SELECT fresco sobre os resíduos e checkpoint; retry idempotente com o mesmo caso exige ausência de referências. Caso diferente ou ressurgimento gera bloqueio.
6. Preservar todas as referências fictícias da outra conta.

Os testes Node em SQLite reproduzem o contrato SQL, incluindo retenção, operação pendente, ausência de freeze, permissão revogada, manifesto incompleto, transação revertida, resposta incerta, ressurgimento de referência e conflito de casos. **São testes de QA, não evidência de um recurso externo ter sido apagado.**

## Pendências reais para concluir a exclusão de contas

| Provedor | Evidência necessária | Estado |
| --- | --- | --- |
| Cloudflare D1 de produção | Inventário paginado de todas as tabelas, trilha de retenção, congelamento nos Workers, delete condicional e duas leituras independentes em ambiente segregado | Não homologado |
| Cloudinary | Listagem completa de upload/authenticated, resource ID, derived e backups; remoção e confirmação negativa com credenciais somente de QA e namespace rigorosamente isolado | Não homologado |
| Firebase/Firestore | Inventário completo de documentos e referências de terceiros; preservação explícita de moderação; autenticação apagada **somente ao final** | Emulator integrado, ambiente remoto pendente |
| FCM | Remoção dos registros de tokens e inscrições administradas pelo app; bloqueio das rotinas de envio/fan-out e verificação de ausência por conta | Não homologado |
| Jurídico/LGPD/Play | Base legal, retenção, atendimento, política, Data safety, UGC e evidências revisadas | Não homologado |

**Nota técnica:** um servidor não consegue afirmar que revogou universalmente um registro FCM apenas por apagar uma linha de banco. O que o aplicativo deve provar é que eliminou o vínculo de entrega sob seu controle e que os emissores deixam de direcionar mensagens ao titular. Cloudinary também pode manter versões de backup e derivados cuja remoção exige fluxos próprios.

A aprovação desses testes não muda `releaseAuthorized:false` e não constitui autorização para alterar `main`, assinar/lançar AAB, excluir uma conta real ou tocar em Cloudinary/Firebase/FCM de produção.
