# Átrio Católico 0.19.7 — fotos Cloudinary (branch de desenvolvimento)

## Estado: NÃO IMPLANTADO
Branch `feature/fotos-cloudinary-0197`. Sem deploy de Firestore, Cloudflare, Cloudinary ou Release. O APK de QA só habilita fotos públicas quando a variável de compilação `ATRIO_AVATAR_WORKER_URL` indicar o Worker aprovado.

## Arquitetura
- Reutiliza o seletor de fotos nativo, recorte 400×400 e geração JPEG 180 KB **sem EXIF**. Entrada JPG, PNG, WebP de até 5 MB.
- Android transmite JPEG para Worker Cloudflare com token Firebase. Nenhuma chave Cloudinary entra no APK.
- Worker consulta Firebase Authentication e associa o upload exclusivamente ao UID do token, limita frequência via D1, limita MIME/tamanho e envia foto para Cloudinary via assinatura calculada no servidor.
- Upload inicia no Cloudinary como **authenticated** com moderação **manual**. O arquivo não é entregável sem autenticação. Após aprovação pelo revisor no Console Cloudinary, o botão «Verificar aprovação» manda o Worker conferir status, promover o arquivo para tipo público `upload` e publicar `profile_photos/{uid}`.
- `profile_photos/{uid}` contém `photoUrl`, `photoPublicId`, `photoUpdatedAt`; leitura por UID autenticado, listagem negada, qualquer gravação por cliente bloqueada. Esta coleção é **independente** de `public_profiles`: a foto é voluntária, sem revelar a biografia privada.
- Todos os `MemberAvatar` observam o registro de fotos. URLs versionadas invalidam cache após substituição; sem registro retorna ao avatar padrão ou foto privada antiga local.
- Remoção autenticada apaga a referência Firestore antes da exclusão Cloudinary; solicita invalidação de CDN.
- O painel Moderação exibe remoção de foto por UID e motivo com confirmação; o Worker valida a coleção `admins` no Firestore e registra a ação em `avatar_moderation` no D1. Um participante normal não pode invocar essa ação. **CDNs e dispositivos podem manter cópias por algum tempo**.
- Em caso de falha de upload, mantém a foto anterior. A moderação depende de ação humana; não afirmar que já funciona sem Cloudinary + Worker configurados.

## Compatibilidade com o Cloudinary Free
A conta conectada foi consultada somente para leitura, sem upload e sem alterações. O plano apresentado é Free, com limite de 10 MB por imagem, superior ao teto de 5 MB aplicado pelo aplicativo. Custos e disponibilidade de moderação manual devem ser conferidos antes da publicação.

## Antes do primeiro deploy (necessita autorização nova)
1. Criar/selecionar ambiente Cloudinary, verificar plano e habilitar moderação manual.
2. Em `cloudflare/avatar-worker`, copiar `wrangler.example.toml` para `wrangler.toml`, criar D1 isolado `atrio-avatar-control` e definir seu ID real (não alterar a base de push). Aplicar `schema.sql` à base de fotos.
3. Inserir com `wrangler secret put` os segredos `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `FIREBASE_SERVICE_ACCOUNT_JSON` (projeto atrio-catolico) e `FIREBASE_WEB_API_KEY`. NUNCA enviar segredos por chat ou Git.
4. Testar regras Firestore do arquivo revisado via emulador e **comparar com regras atuais de produção**; após aprovação, publicar só regras. Não sobrescrever alterações remotas recentes.
5. Publicar Worker separado somente com aprovação. Compilar APK Debug com `ATRIO_AVATAR_WORKER_URL=https://atrio-avatares.<conta>.workers.dev` (valor validado no Gradle).
6. Testar com duas contas reais: publicar, aprovar manualmente, verificar publicação, visualizar de outra conta, substituir, aprovar novamente e remover. Conferir 401, 413, 429 e proibição de escrita direta nas regras.
7. Só depois solicitar autorização de integração à `main`; Release assinada só mediante autorização expressa.

## Observações de segurança
- URLs Cloudinary do tipo `upload` tornam-se acessíveis a quem conhecer o link, **mesmo fora do Átrio**; o app avisa antes do upload. Restringir visibilidade exclusivamente a usuários autenticados exigiria distribuição de imagens autenticadas, outra arquitetura.
- Fotos pendentes não entram no Firestore e ficam no tipo autenticado; aprovação administrativa é mandatória.
- A rota `/avatar/status` usa POST porque pode promover um arquivo aprovado e publicar no Firestore. A aprovação é feita no Console Cloudinary, nunca pelo APK.
- A lista de pendências D1 requer revisão periódica e eventual limpeza de arquivos rejeitados/não publicados. Rate limit por UID, não por IP, impede rajadas na mesma conta, mas pode necessitar controles adicionais.
- Se a gravação Firestore falhar após a promoção, a publicação falha e o Worker tenta remover a imagem; investigar falhas e limpar órfãos se necessário.
- O fluxo de moderação e exclusão real não pode ser validado em produção sem credenciais e implantação explicitamente aprovadas.
- Nenhum backup protegido deve ser alterado.
