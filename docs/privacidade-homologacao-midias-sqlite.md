# Homologação isolada de imagens — SQLite, Cloudinary e Firestore

**Etapa em rascunho, 31/10/2026. Nenhum dado real consultado ou alterado.**

Esta etapa complementa a PR #79 (auditoria de fotos) e depende das PRs #73 → #74 → #77 → #78 → #79. Sua finalidade é verificar o comportamento dos adaptadores de leitura usando o **mesmo esquema SQL de D1** que o Worker de avatares utiliza, mas em um banco `SQLite :memory:` efêmero.

## Como os testes funcionam

- `avatar-media-sqlite.integration.test.js` abre um banco **em memória** e aplica o arquivo verdadeiro `cloudflare/avatar-worker/schema.sql`.
- Os testes inserem dados **fictícios** de dois usuários exclusivamente nesse banco. A interface entregue ao auditor só aceita `SELECT` parametrizado e mantém registro das consultas efetuadas.
- O Cloudinary é substituído por uma função de resposta HTTP **local em memória**, que exige método `GET`, destino oficial literal e filtro por UID, e simula dois tipos de entrega (`upload` e `authenticated`) e paginação com mais de cem recursos.
- O Firestore é substituído por respostas HTTP simuladas restritas à leitura de `profile_photos/{uid}`, retornando apenas `photoPublicId`. **Não existe conexão com o Firebase real.**
- Verifica-se também que nenhuma linha das quatro tabelas de QA foi alterada pelo processo de auditoria.
- São cobertos: fotografia pendente protegida, fotografia publicada, arquivo órfão, mídia faltante, conflito com dados de outra conta, 106 registros de moderação (paginação), paginação Cloudinary de 103 imagens, erro em página posterior e referência ao UID errado.
- As contagens em um resumo são compartilháveis sem UID, identificadores de mídia, e-mail ou URL privada; detalhes completos permanecem apenas em estruturas do auditor, não em endpoints.

## Limitações e próximos passos

**Este teste não é uma execução no Cloudflare D1 nem na API Cloudinary verdadeira.** O banco é SQLite local, e o protocolo Cloudinary/Firestore é simulado. Antes de conectar produção será necessário homologar D1 em ambiente remoto isolado, Cloudinary com recursos exclusivamente de teste, o domínio/credenciais e a revisão de IAM.

Também permanecem pendentes mídia anterior aos padrões de identificador adotados, cópias locais e derivadas, dados em outras coleções, decisão de retenção de moderação, executor idempotente de exclusão e portal HTTPS ativo.

O inventário conserva `safeToExecute=false` e `globalMediaCoverageComplete=false`; **nenhuma conta, foto ou discussão é excluída nesta etapa.**

### Comando de QA

```bash
node --experimental-sqlite --test cloudflare/account-deletion-audit/src/avatar-media-sqlite.integration.test.js
```

O fluxo `.github/workflows/privacy-account-portal-ci.yml` continuará executando esse teste junto com os testes Node de privacidade, sem segredos ou dependências adicionais.
