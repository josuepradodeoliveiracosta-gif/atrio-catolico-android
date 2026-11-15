# Perfil QA — regras de titularidade para o piloto Android isolado

**Agente 2 · Backend e Firebase · 15/11/2026 · somente OFFLINE e NÃO publicado.**

## Contrato e referências

- Fluxo Android restrito da PR #298, derivado da cadeia #297 → #296 → #294 → #291.
- Destino futuro: Firebase QA atrio-catolico-qa-perfil, banco (default), Spark; índice composto posts(uid ASC,createdAt DESC) confirmado READY por Termux do fundador.
- Security Rules reais permanecem na política inicial deny-all visualizada no Console; a release efetivamente publicada ainda carece de confirmação read-only independente.
- O arquivo de Rules aqui não é referenciado pelo firebase.json da raiz. **Não executar deploy.**
- A PR #193 (chatQa), o Firebase oficial e os demais QA não foram alterados.

## Menor privilégio no piloto

Todas as leituras e edições permitidas exigem Firebase Auth com email_verified=true e UID do próprio token:

| Caminho | Permitido | Negado |
| --- | --- | --- |
| profiles/{uid} | get do titular; update somente displayName de 2–35 e bio até 180 | list, create, delete, campo alheio, outros UIDs |
| public_profiles/{uid} | get do próprio titular; update de projeção existente e sincronizada | get de terceiros; list, create e delete |
| posts/{postId} | get de post cujo uid armazenado corresponde ao Auth UID; list com filtro uid próprio e limit <=20 | posts de terceiros; sem filtro/limite; create/update/delete |
| Todos os demais caminhos | nenhum acesso | read e write |

Quando a apresentação pública já existe, a edição do perfil precisa sincronizá-la na mesma transação com getAfter. O aplicativo não pode recriar opt-in revogado nem alterar joinedAt, createdAt ou privilégios.

A atualização de `public_profiles.updatedAt` **isoladamente é negada**, mesmo
quando os documentos privado e público já estão consistentes. A regra
`public_profiles.update` compara `get()` e `getAfter()` de `profiles/{uid}`
e exige diferença efetiva em `displayName` ou `bio` na mesma operação
atômica. Atualização privada sem sincronização pública continua negada
quando o opt-in já existe. O teste regressivo inclui também batch com
escrita privada sem mudança efetiva, que não autoriza atualizar só o timestamp.

**Security Rules não filtram consultas.** A PR #298 deve manter os filtros UID e limit(20) nas consultas ordenadas por createdAt DESC com cursor e na varredura legada por documentId. Uma consulta que possa alcançar posts de outro autor será negada, mesmo se limitar 20.

O piloto não faz cadastro, criação de perfil, UGC/replies, postagens, gerenciamento de selos/fotos, leitura de app_config, conversas, notificações, dados religiosos, Storage ou ações de moderação/Admin.

**email_verified não é whitelist de contas de homologação.** Nunca provisionar identidades ou dados no Firebase real sem autorização específica.

## Testes e evidências

No clone, de modo exclusivamente local:
- cd tests/security
- npm ci
- npm test

A suíte existente usa o Firebase Emulator Suite com projeto sintético demo-atrio-v11. O arquivo qa-perfil-rules.test.mjs cobre **19 blocos positivos e negativos**, incluindo titularidade, criação negada, transação/opt-in existente, paginação 20+5, legado, outras contas, consulta sem filtro/limit, modificações indevidas e coleções fora do escopo. O teste não acessa o Firebase remoto.

**Declarar PASS apenas após conferir execução real no SHA final da PR.** Um build Debug/CI não equivale a APK perfilQa nem testes em aparelho.

## Revisão e gates

- Agente 4: revisar permissão por UID, Auth verificado, getAfter e negativas.
- Agente 5: confirmar logs do Firebase Emulator por SHA e regressões. Homologação APK/física requer autorização específica futura.
- Agente 7: conferir integração com fluxo da PR #298 e preservação do chatQa da PR #193.
- Fundador: autoridade final para qualquer deploy, contas/fixtures reais, APK conectado e merge.

**NÃO foram alterados** Firebase remoto, Rule publicada, contas, dados reais, custos, produção, Conversas, backups, assinatura oficial ou main.
