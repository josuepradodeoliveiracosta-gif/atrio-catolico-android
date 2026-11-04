# Cadastro, segurança e privacidade — preparação para Google Play

**Situação:** proposta técnica integrada ao APK de testes após aprovação de CI. **Não representa publicação na Play nem homologação jurídica, Firebase ou Cloudflare.**

## O que a mudança oferece

- Cadastro por nome público, e-mail, senha (15–128 caracteres) e confirmação.
- Validação e mensagens claras; não reduzir a política de login de contas antigas.
- Exibir/ocultar senha, teclado adequado e `ContentType` para preenchimento automático.
- Aceite expresso das **Regras da Comunidade** ao criar conta; texto acessível na própria tela.
- Enviar e-mail de verificação após criar usuário; perfil permite reenviar e atualizar a confirmação.
- Solicitação privada de exclusão em `account_deletion_requests/{uid}`; regra Firestore autoriza apenas a criação pelo próprio usuário e leitura restrita a administrador e titular.
- Nenhuma senha é gravada no Firestore ou em logs; autenticação segue pelo Firebase.

## Segunda etapa: moderação e Regras da Comunidade

- `community_consents/{uid}` registra aceite versionado das regras, individual e privado;
  contas antigas precisam aceitar antes de acessar a comunidade no APK atualizado.
- No cadastro, o aceite já é solicitado e gravado após criação Firebase; o listener
  deve liberar a navegação somente quando o Firestore confirmar o registro.
- `users/{uid}/blockedMembers/{blockedUid}` mantém bloqueios privados por conta.
  O perfil público permite bloquear/desbloquear, e feed, salvos, detalhes e
  respostas ocultam conteúdo de autores bloqueados.
- `user_reports/{reporterUid}__{targetUid}` recebe denúncia privada de usuário,
  com motivo de 10 a 500 caracteres. Somente o denunciante e admins podem
  consultar. Um par denunciante/alvo possui uma denúncia imutável.
- O painel administrativo inclui uma fila das 30 denúncias de participantes mais recentes, com opção de marcar como analisadas; a decisão fica associada ao UID do administrador e ao tempo do servidor.
- As denúncias de posts e respostas anteriores permanecem funcionando.

**Pendências de UGC ainda relevantes:** o controle do aceite deve ser validado
também nas regras de publicação do servidor antes do envio à Play. As versões
antigas do APK não possuem a nova tela; adicionar bloqueio estrito diretamente
às regras sem migração interromperia essas versões. O painel de moderação tem uma fila inicial `user_reports`, mas ainda é necessário
definir atendimento, medidas corretivas, prevenção de abuso e critérios
operacionais. Bloqueio é pessoal/visual: não é expulsão nem impede
todas as interações originadas do bloqueado em outros dispositivos.

## Portões de produção NÃO atendidos por esta etapa

1. **Política de senha no servidor:** configurar 15 caracteres mínimos em Firebase Console > Authentication > Settings > Password policy, com modo **Require** para cadastro. A validação no app isoladamente não impede SDKs antigos ou chamadas diretas. Testar impacto nas redefinições de senha de contas anteriores.
2. **Verificação obrigatória:** o e-mail é enviado e a interface pode conferi-lo. Ainda não existe regra de autorização no Firestore que impeça contas novas não verificadas de postar/responder. Não declarar esse controle como ativo até instalar e testar a regra.
3. **Senhas vazadas:** lista local mínima bloqueia senhas triviais; não equivale a uma checagem segura de senhas comprometidas. Projetar proteção confiável, com consulta por prefixo de hash ou serviço compatível, sem enviar senhas legíveis nem inserir chaves de API no aplicativo.
4. **Exclusão de conta:** o pedido é armazenado, mas **NÃO exclui automaticamente** Firebase Auth, perfis, postagens/respostas, fotos, notificações, dispositivos FCM ou metadados de moderação. Precisa de backend privilegiado auditável, operação administrativa e prazos de retenção, com verificação de identidade e tratamentos legais. Nunca apagar só Auth e deixar dados órfãos.
5. **Canal externo:** publicar uma página HTTPS acessível sem login que permita solicitar exclusão mesmo depois da desinstalação; registrar sua URL no Play Console. Nenhuma URL foi inventada.
6. **Privacidade e Termos legais:** aprovar e publicar documentos completos e verdadeiros: controlador, contato, tratamento de dados, finalidade, bases legais, provedores, retenção, direitos e exclusão. A UI atual só traz aviso de transição e regras da comunidade. Revisão jurídica/LGPD necessária.
7. **UGC:** aceite de regras para contas antigas e novas, denúncia de usuário e bloqueio visual foram adicionados ao APK. **Ainda faltam** bloqueio/autorização no servidor para versões antigas, auditoria de interações e atendimento de `user_reports` pelo painel de moderação. A Play requer moderação contínua real: uma fila que marca como analisada não substitui investigação e ação.
8. **Play Console:** preencher Data Safety, política de público-alvo, classificação Social, conteúdo infantil se aplicável, política CSAM e instruções de denúncia. Gerar AAB oficial, assinar, testar e publicar em fluxo separado autorizado.

## Cenários mínimos de homologação

- Cadastro novo: senha <15 não avança; 15–128 sem mistura obrigatória é permitida; 129 rejeitada; confirmação divergente bloqueia; regras não aceitas bloqueiam; e-mail malformado bloqueia.
- Voltar para login mantém **login antigo com senhas >=6**, sem forçar alteração, mas cadastro novo exige a política nova.
- Verificar se botão olho mantém caracteres e não expõe senha em logs.
- Criar conta no projeto Firebase emulado: gravar perfil, solicitar e-mail, abrir comunidade, reenviar e atualizar verificação.
- Pedir exclusão: somente o dono cria seu documento com `status=pending` e `requestedAt=request.time`; tentar criar solicitação de terceiros ou modificá-la deve falhar; admins podem consultar, não apagar via app.
- Falha de rede após criação Firebase e antes do perfil: interface de conclusão de perfil recupera conta sem segundo cadastro.
- Testar modo offline, rotações, TalkBack, tablets, keyboard IME, scroll com teclado visível, fonte ampliada e gerenciador de senhas.
- Confirmar Play privacy/terms e exclusão **somente** depois da aprovação jurídica e implantação de backend e URL pública.

Fontes:
- [Google Play — User Data / Account Deletion](https://support.google.com/googleplay/android-developer/answer/10144311)
- [Google Play — User Generated Content](https://support.google.com/googleplay/android-developer/answer/9876937)
- [Firebase Authentication — Password Policy](https://firebase.google.com/docs/auth/android/password-auth)
- [Android — Autofill in Compose](https://developer.android.com/develop/ui/compose/text/autofill)

**Não modificar backup, assinatura de produção, versionCode, Firebase Console ou serviço externo como efeito desta PR.**
