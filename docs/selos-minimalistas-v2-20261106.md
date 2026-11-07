# Selos minimalistas e verificação religiosa — implementação V2

**Escopo:** implementação integrada ao GitHub; publicação de regras e APK Release requerem etapas independentes de auditoria e autorização.

## O que mudou

- Ícones compactos (Compose vetorial) nas cores oficiais vinho/dourado, cruz dourada do Padre, fundo azul-petróleo do Diácono, marrom para Religioso(a) e neutro para Leigo(a).
- Uma identidade principal (Fundador > religioso verificado > leigo) + selo de Moderador adicional. Na implementação inicial, as artes antigas permaneceram em `res/raw`. Em 07/11/2026, a limpeza removeu somente cinco recursos e quatro componentes sem consumidores; as artes continuam no histórico Git. A medalha do Fundador, ainda usada no perfil, foi mantida. Nenhum dado de usuário foi removido.
- `/badges/{uid}.clergy` continua compatível com `padre` e `diacono`; acrescenta `religioso` e `religiosa`, sem migração destrutiva.
- `/badge_requests/{uid}` aceita quatro tipos, com estados `pending`, `approved`, `rejected`, `revoked` e `dismissed` legado.
- Aprovação e revogação exigem **batch atômico** entre solicitação e selo; revisor ativo não aprova/revoga o próprio pedido.
- `/badge_events/{eventId}`: histórico append-only privado para administradores, gerado no mesmo batch da decisão. Nenhum campo sensível, documento ou comprovante deve ser incluído na justificativa.
- Painel administrativo: solicitações pendentes e aprovadas; decisões justificadas de 10 a 300 caracteres; opção de revogar selos aprovados.
- Selo visual de Moderador concedido ou revogado apenas por `isFounderAdmin()`, combinando `admins/{uid}.enabled` e `app_config/founder.uid`. Esse campo **não é permissão**; direitos reais continuam em `admins/{uid}`.
- Participação informada no cadastro V2 é autodeclaração privada; não concede selos.

## Segurança e compatibilidade

1. Leia o arquivo `AGENTS.md` e registre o SHA atual da `main` antes de integrar.
2. Preserve `app_config/founder`, `admins`, `badges`, `badge_requests`, os históricos e o backup protegido existente. Não faça limpeza em massa dos selos antigos.
3. **Não publique `firestore.rules` em produção automaticamente**. Confirme as regras reais implantadas, revise o diff e obtenha autorização explícita do responsável antes de publicar.
4. Execute `npm test` em `tests/security` com o emulador Firestore e `gradle :app:testDebugUnitTest :app:assembleDebug` via CI. Teste contas leigas, Fundador, administrador ativo/revogado e quatro tipos de solicitações.
5. Publicar regras revisadas e verificar o resultado no Console **antes** de distribuir o APK correspondente. Faça testes em aparelhos com duas contas, verificando aprovação, revogação, reenvio, visibilidade e tratamento de perda de internet.
6. Não gere Release sem chave de assinatura oficial. `applicationId` e `versionCode` do Release não foram alterados; somente o contador Debug foi incrementado.
7. Validação de identidade de Padre, Diácono e Religioso(a) é **manual** por fonte eclesial confiável; o app não autentica ordenações ou vínculos automaticamente.

## Limitações operacionais

- O painel de Moderadores consulta **UID**, não indexa nomes ou e-mails privados de usuários.
- Os logs legados anteriores à criação de `badge_events` permanecem nos pedidos antigos quando disponíveis; a nova coleção não reconstrói eventos históricos.
- Eventos gravados pela interface são imutáveis, mas intervenções pelo Admin SDK/Console não são bloqueadas pelas Firestore Rules; acessos administrativos fora do app exigem controle operacional.
- Perfis com `clergy` já existentes continuam visíveis conforme o estado legado. Não serão revogados ou revalidados automaticamente.
- A implementação versionada não comprova publicação no Firebase, instalação no aparelho ou distribuição de Release. A auditoria read-only está documentada em `docs/selos-seguranca.md` e pode ser executada pelo Termux autenticado.

## Critérios de aceite

- [ ] Testes de regras Firebase e Android no CI sem regressões.
- [ ] Membro comum incapaz de autoconceder selo de Fundador, Padre, Diácono, Religioso(a) ou Moderador.
- [ ] Admin autorizado aprova/rejeita/revoga selos religiosos por batch; auditoria append-only.
- [ ] Fundador habilitado controla só o selo visual de Moderador.
- [ ] Selos legíveis em perfis e conversas com contraste adequado e sem medalhas pesadas.
- [ ] Regras e APK testados em homologação antes de produção.
