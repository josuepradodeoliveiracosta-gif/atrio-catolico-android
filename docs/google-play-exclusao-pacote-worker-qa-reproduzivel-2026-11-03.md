# Átrio Católico — pacote de fontes verificável para o Worker privado

**03/11/2026. Exclusão de contas — agilização da homologação.**

## O que foi automatizado

A CI agora gera, após passar nos testes do motor e da auditoria, um **artefato de fontes ESM do Worker privado da Cloudflare**, guardado por 3 dias no GitHub Actions. O pacote inclui apenas módulos alcançáveis a partir de `privacy-freeze-stage/src/index.js`, com dependências locais sob `cloudflare/privacy-freeze-stage/src/` e `cloudflare/account-deletion-audit/src/`. Importações externas, dinâmicas, links simbólicos, fontes fora da lista e arquivos não revisados são recusados.

O `manifest.json` inclui SHA do commit efetivamente empacotado, caminhos, tamanhos, SHA-256 por módulo, quantidade de módulos e digest ordenado do grafo. A função `verifyQaWorkerSourceArtifact` refaz a comparação byte a byte e rejeita inclusões e adulterações. O manifest contém `deployAuthorized:false` e `productionAuthorized:false`.

Esta etapa produz **fontes verificadas**, não um bundle binário assinado nem uma versão já implantada. Não inclui o arquivo Wrangler, secrets, ID D1, binding real, credenciais Firebase ou tokens Cloudinary.

## Etapas para promoção posterior

A promoção do Worker privado continua bloqueada até: conferência independente da origem do commit, build real de módulo compatível com Cloudflare, revisão de IAM, inventário de rotas das zonas, bindings preservados, upload de versão sem exposição pública, rollback documentado e autorização específica para deploy no stage. Não usar em Workers oficiais nem conectar contas de usuários reais.

## Proteções

Nenhum deploy, alteração de produção, publicação Play, migração de D1, exclusão real ou modificação de backup é feita pelo workflow. CI de revisão PR apenas, sem credenciais persistidas. O pacote temporário é de curta retenção e não deve ser interpretado como assinatura de segurança.
