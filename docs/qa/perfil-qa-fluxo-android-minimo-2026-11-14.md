# Perfil QA — fluxo Android mínimo (Agente 3, 14/11/2026)

## Contrato e estado

- **Origem:** [Issue #105 / GO offline de segurança](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/issues/105#issuecomment-6886309734) e [parecer do Agente 7](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/issues/105#issuecomment-6886221978).
- **Branch exclusiva:** `feature/ag3-perfilqa-fluxo-minimo-20261114`, criada sobre o HEAD da [PR #297](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/297) `29bb1fda0d0bc2d22855ff53285829114b144b5b`. Depende da sequência #291 → #294 → #296 → #297. Nenhuma dessas PRs foi integrada na main.
- **Ambiente:** testes automatizados em Debug e projeto Firebase Emulator `demo-atrio-v11`; aplicativo QA futuro identificado exclusivamente por `br.com.atriocatolico.perfilqa` e Firebase `atrio-catolico-qa-perfil`. A candidata de Rules #296 ainda não está implantada. Configuração real de QA não é versionada nem distribuída.
- **Sem autorização:** iniciar Firebase QA remoto, criar conta/dados, migrar dados, instalar em aparelho, fazer merge, deploy, publicar Rules ou mudar produção. Este código é proposta testável, não APK de homologação real.

## Fluxo restrito

1. O Manifest de `src/perfilQa` remove o launcher da `MainActivity`, o serviço Push, o FileProvider OTA e permissões de notificações/instalador; a **única Activity lançável** é `PerfilQaActivity`. Sem invocar `OnlineAtrioApp`, `OnlineUserScreen`, cadastro/onboarding padrão, feed global ou Conversas.
2. Antes de instanciar Auth/Firestore, exigir **os quatro identificadores** do app (pacote runtime, BuildConfig.APPLICATION_ID, Firebase project ID e Firebase Android App ID) e default FirebaseApp. Em desconformidade, mostrar **bloqueio**. O buildType de #297 exige configuração QA validada por SHA-256 e mantém serviço/push/assinatura oficial desabilitados.
3. Admitir **login com e-mail/senha de conta sintética já provisionada**, sem `createUserWithEmailAndPassword` nem formulário comunitário. Antes da leitura, recarregar Auth, obter token atualizado e exigir `email_verified` no usuário e no ID token; UID sempre `auth.currentUser.uid`. Verificação ou perfil faltante → erro controlado e logout, nunca criar documentos para contornar Rules.
4. Consultar somente `profiles/{uid}` por get servidor. Editar apenas `displayName` e `bio` dentro dos limites declarados. **Apenas durante edição** ler `public_profiles/{uid}` (não listar). Se já existir opt-in, atualizar perfil privado e projeção pública na **mesma transação**, com `update` e timestamp de servidor (nunca `set` que recrie uma publicação revogada); falha de verificação → **nenhuma escrita**. Não oferecer opt-in, criação de perfil, foto, selos, exclusão, alertas ou dados administrativos.
5. Exibir `Minhas discussões` usando consulta própria `whereEqualTo("uid", uid).orderBy("createdAt", DESC).limit(20)`, cursor por documento e varredura opcional por ID para legados sem `createdAt`. Os cartões são **não clicáveis** no piloto, impedindo acesso a detalhes, replies, UGC e recursos não autorizados. Não há botão Publicar nem abas comunitárias.
6. `Sair da conta` encerra a sessão local. A Activity não registra push ou listeners globais. A identidade de e-mail verificado **não é lista administrativa de testadores**; a autorização de contas depende de ato separado do fundador.

## Critérios de aceite e provas

- `PerfilQaIdentityTest` (JVM): pacote/projeto/App ID exatos aceitos; produção, Chat QA, campos ausentes e IDs divergentes negados.
- `ProfileLayoutUiTest` (Android Emulator): login sem cadastro/comunidade, editor restrito, navegação ao histórico, fonte ampliada e cartões sem ação de clique; usa mocks de UI e fixtures do projeto `demo-atrio-v11`, **nunca** o Firebase QA real.
- `ProfileDiscussionHistory` permanece clicável no aplicativo padrão e torna os cartões estáticos quando `onOpen = null` no piloto.
- CI de `assembleDebug`/emulador comprova **somente os trechos comuns**. Como a variante `perfilQa` exige JSON QA local autorizado ausente, ela **não é compilada** por esses workflows; manifest resultante, `assemblePerfilQa` e identidade do APK exigem futuro gate do Agente 5.
- Agente 2 deve restringir a candidata Rules #296 ao mesmo contrato: leitura de posts **somente próprios**, `profiles.create` negado, `public_profiles.get` só do titular quando necessário à edição, demais módulos deny-all. O cliente restringir consultas não substitui a regra no servidor.
- Agente 7 deve conciliar a variante `chatQa` da #193 e a `perfilQa` da #297 no Gradle em **branch de integração separada**. Esta PR **não modifica `app/build.gradle.kts` nem a branch #193**; não existe prova de compilação simultânea.

## Acessibilidade e QA físico futuro (sujeito a autorização)

- Conferir ordem TalkBack entre título, e-mail, campos privados, editar/salvar/cancelar, Minhas discussões, paginação, busca legada e sair.
- Validar fonte 150% e 200%, rolagem, campo de senha mascarado, botões ≥48dp, mensagens de erro com live region e foco sem abertura de rotas proibidas.
- Coletar SHA, variante, package name, `project_id`/Firebase App ID **do APK**, assinatura debug, Android/telefone e capturas sem informações pessoais. **Nenhum telefone foi utilizado neste trabalho**.

## Progresso e encaminhamento

**Cinco marcos de mesmo peso:** (1) diagnóstico/contrato/coordenação; (2) Activity/Manifest fail-closed; (3) login verificado e perfil com atualização opt-in; (4) histórico próprio e readonly; (5) CI e documentação com evidências, revisão e passagem. Atualizar porcentagem somente após comprovar cada marco. 

**Status inicialmente:** implementado em branch, aguardando CI e revisão. **NO-GO remoto e integração.**
