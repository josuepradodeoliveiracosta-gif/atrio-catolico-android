# Átrio Guardião — moderação gratuita (0.19.0, testes)

## Política e escopo
- **Triagem apenas; não remove, oculta nem restringe automaticamente**. Só administradores ativos, após ler conteúdo e justificativa, podem usar o fluxo de moderação já existente para remover, registrar ou descartar denúncias. Decisões humanas não são alteradas pelo bot.
- Regras conservadoras para possíveis ameaças pessoais explícitas, pedido suspeito de senhas/códigos, padrão de CPF em conteúdo público, excesso de links e texto repetitivo. São **sinais**, não julgamento de culpa. Divergência doutrinária, debate teológico, testemunhos e relatos não justificam remoção por si sós.
- Cada alerta aparece como denúncia pendente com rótulo Átrio Guardião. Nunca publica a íntegra do conteúdo, CPF, token FCM ou UID em logs/estatísticas.
- Identidade `reporterUid=atrio_guardiao` é um identificador **de sistema**, não uma conta de login no Firebase. Uma conta Firebase separada com acesso privilegiado não é necessária; as credenciais administrativas permanecem em Secrets do Cloudflare.

## Segurança
- Após a gravação Firestore, um cliente Android 0.19.0 chama `POST /moderation/event` com Firebase ID token e somente `{type,postId,replyId?}`.
- O Worker valida o token via Firebase Identity Toolkit, confirma **autoria** e `createdAt` recente no Firestore, verifica a existência do post pai para respostas e extrai o texto diretamente da origem. IDs e campos extras não aceitos são rejeitados.
- Se as regras sinalizam possível risco, cria somente `reports/guard_<hash>`, usando `documentId` determinístico. Repetição é ignorada (409). O registro inclui `source=guardiao`, `ruleCode`, status `pending` e motivo **sem a mensagem original**.
- Não há DELETE de posts ou replies no Worker. Admin só faz exclusão pelo mecanismo atual do app, com autorização Firestore e confirmação.
- Push a administradores é genérico e só após persistir a denúncia. **Cooldown global de 5 minutos** via D1, para evitar spam nos aparelhos; falhas de FCM ou de D1 não removem nem invalidam alertas já persistidos.
- `GUARDIAO_ENABLED=true` habilita apenas triagem conservadora no Worker ativo. `GUARDIAO_AI_ENABLED=false` desliga toda inferência; não precisa criar API key de IA. O comando `wrangler deploy` usa `GUARDIAO_ENABLED=false` por padrão e nunca deve copiar segredos ao git.
- Etapa opcional de IA usa o binding Workers AI, orçamento **máximo 10 reservas por dia UTC** via tabela D1 `guardiao_ai_budget`. IA apenas anota `aiAssessment` sob precondição da versão original da denúncia. Não pode remover, ocultar ou alterar o status.

## Limitações assumidas e próximas etapas
- A versão atual usa **sinalização originada pelo APK novo**. Publicações anteriores e versões antigas/modificadas do cliente **não são cobertas de forma garantida**. Para cobertura integral, adicionar posteriormente reconciliação autenticada do lado do servidor (Cron/consulta incremental) com orçamento de leituras e revisão de regras.
- Não há detecção exaustiva de violência, exploração, discurso de ódio ou fraude: os padrões minimizam falsos positivos. Em conteúdo que não combina com regras, a IA nem é chamada. **Não anunciar como IA moderando tudo**.
- Possíveis falsos positivos vão para fila de revisão humana, sem remoção automática. Continuar testando com contas reais e casos de citação, denúncias de ameaças e CPF fictício.
- É uma funcionalidade experimental da **PR #15** da versão de testes; a branch `main` e o APK oficial 0.18.0 permanecem intactos. O Worker compartilha o projeto Cloudflare com o Push; preservar `PUSH_ENABLED`, `BROADCAST_ENABLED`, D1 e Secrets.

## Etapa 3 — piloto de quarentena reversível (feature flag)
- **Não ativar antes de validar a triagem em celulares reais.** O histórico de teste com CPF ainda exige diagnóstico. No ambiente publicado, `GUARDIAO_AUTOHIDE_ENABLED=false`. Mesmo com esta chave verdadeira, a retenção exige `GUARDIAO_AI_ENABLED=true`, resultado da IA `concern` e regra `threat` ou `credential_scam`. **CPF, links excessivos e texto repetitivo nunca são retidos automaticamente.**
- `guardiao_quarantine/{guard_<hash>}`: arquivo privado contém campos originais, proprietário, motivo, estado e momento da retenção. Um `documents:commit` atômico cria arquivo sob `exists=false` e remove documento do feed sob precondição `updateTime`. A exclusão do feed é **temporária**, não definitiva; anexos ou respostas órfãs da discussão continuam sujeitos à política de limpeza.
- `POST /moderation/review`: recebe Firebase ID token de **administrador ativo** e `{caseId,action:'restore'|'confirm',note}` (5–300 caracteres). Autorização do servidor, recusa auto-revisão pelo proprietário, confirma vínculo relatório/arquivo/alvo, exige estado pendente e precondições de versão. Restauração recria o documento original, marca arquivo `restored` e relatório `dismissed` no mesmo commit. Confirmação marca arquivo `removed` e relatório `removed` sem apagar o arquivo de auditoria.
- `guardiao_quarantine` só pode ser lido pelo dono original e administradores; usuários não podem criar/excluir arquivos. O dono pode incluir uma única `appealText` (10–500 caracteres) e `appealedAt`, sem alterar arquivo ou decisão. Administradores leem a contestação no painel e decidem pelo Worker. O painel de perfil inclui **Minhas revisões**.
- APKs antigos não podem atualizar `reports` com `source=guardiao` quando existe arquivo `held`, impedindo inconsistência por decisões de interface antiga.
- Não houve implementação de moderação retroativa ou garantia de entrega para clientes modificados/antigos. Não há aviso individual ao autor por Push nesta etapa: a área do perfil mostra casos disponíveis e permite contestar. Também não há punições automáticas por reincidência nem banimentos. Esses recursos exigem fluxos administrativos específicos.
- **IMPORTANTE:** enquanto `GUARDIAO_AUTOHIDE_ENABLED=false`, nenhuma publicação é ocultada automaticamente. O endpoint de revisão permanece implementado para casos de teste ou eventual retenção ativada de modo controlado.
