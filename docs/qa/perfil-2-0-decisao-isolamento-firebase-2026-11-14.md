# Decisão pendente: ambiente Firebase isolado para o Perfil 2.0

**Agente 2 • 14/11/2026 • natureza: parecer de arquitetura/coordenação, sem implementação de infraestrutura.**

Referências verificadas: `main` em `5de225a5cc2c287faf51749c3a889e6d42929d96`;
PR [#291](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/291)
em `b7c9bc8e1a18739db64d0490b71a91c1e4bc4ca3`;
PR [#294](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/294)
em `7f7d1ca069dd77eb2ae8bd9c937bad7847c19bf4`;
PR [#193](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/193)
em `530395026d0dc37ac424b788c3f5a22f79bb8fed`.
Coordenação: [Issue #105](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/issues/105).

## Evidências confirmadas

1. Em Termux, o fundador executou `firebase firestore:databases:list --project atrio-catolico-qa-geral`: existe o banco `(default)` (`FIRESTORE_NATIVE`, edição `STANDARD`).
2. Em Termux, `firebase firestore:indexes --pretty --project atrio-catolico-qa-geral --database '(default)'` retornou **`Compound Indexes / None`**. Logo, o índice `posts(uid ASCENDING, createdAt DESCENDING)`, declarado no GitHub, **não está implantado nesse banco**.
3. Em Termux, `firebase apps:list ANDROID --project atrio-catolico-qa-geral --json` indicou **um registro Android**, com nome `Atrio QA Conversas`, pacote `br.com.atriocatolico.chatqa`.
4. O `app/build.gradle.kts` versionado na PR #291 define `applicationId = "br.com.atriocatolico"`, com os sufixos de debug opcionais `.otalab` e `.v2preview`; **não** há variante `.chatqa` no Perfil 2.0. O `app/google-services.json` dessa PR aponta para o projeto `atrio-catolico` (produção).
5. A PR #193, **não integrada**, já implementa o build `chatQa` de pacote `br.com.atriocatolico.chatqa` com JSON próprio em `app/src/chatQa/google-services.json`, guardas contra produção e verificações offline. Também altera `app/build.gradle.kts`; não duplicar esse código nem substituir o destino desse build.
6. As PRs #291/#294 passaram testes automatizados no **Firebase Emulator `demo-atrio-v11`**, não em QA Geral. O runner `QaAndroidTestRunner.kt` fixa explicitamente o projeto demo e portas de emulador; isso não prova um APK ligado ao QA real.
7. A documentação da PR #193 descreve uma política remota QA de negação total em uma auditoria passada, **mas o estado atual das regras implantadas não foi consultado nesta tarefa**. Não presumir que a política publicada continua idêntica.

## Risco determinante

**Outro registro Android no mesmo projeto `atrio-catolico-qa-geral` não isola o backend.**
Aplicativos Firebase registrados em um mesmo projeto compartilham os serviços, incluindo Authentication e Firestore. As Security Rules aplicam-se ao banco, não ao nome do aplicativo Android. Um segundo pacote sob o mesmo projeto/banco **não é garantia de separação** das coleções, regras, contas e operações do QA Conversas.

Documentação oficial:
- https://firebase.google.com/docs/projects/learn-more
- https://firebase.google.com/docs/projects/dev-workflows/general-best-practices
- https://firebase.google.com/docs/firestore/security/rules-structure
- https://firebase.google.com/docs/android/google-services-plugin-and-file

## Alternativas e recomendação

### A. Ambiente Firebase dedicado para o Perfil 2.0 — **recomendado, sujeito à aprovação**

Preparar, **somente após decisão e autorização expressa do fundador**, um projeto de homologação independente, com banco Firestore e Auth próprios. O nome `atrio-catolico-qa-perfil` é **apenas uma sugestão**, não foi verificado como projeto existente nem registrado. Registrar nele um app Android **distinto**, por exemplo `br.com.atriocatolico.perfilqa`. O build isolado deve usar `app/src/perfilQa/google-services.json` e preflight rigoroso: confirmar pacote, `project_id`, app ID, projeto/banco autorizados, proibir URLs e credenciais de produção e impedir fallback para a configuração `app/google-services.json` já existente. Usar um buildType `perfilQa` desabilitado por padrão, acionável apenas em tarefa Gradle dedicada, sem assinatura oficial.

**Não implementar esse buildType antes de decidir o projeto e registrar o aplicativo**, pois a PR #193 altera o mesmo Gradle e sua coordenação é necessária. Não habilitar serviços pagos nem criar projetos/bancos/contas sem avaliação de custo e autorização específica.

### B. Compartilhar `atrio-catolico-qa-geral` — **não recomendado sem revisão cruzada formal**

Exigiria pactuar regras, autenticação, dados sintéticos, namespace, índices e políticas de acesso com a PR #193. O banco `(default)` tem atualmente zero índices compostos na listagem observada. Mesmo criando outro app Android, os serviços do projeto continuariam compartilhados. Precisa de avaliação dos Agentes 4 e 7 e anuência dos responsáveis pelo QA Conversas; o fundador decide. **Não acrescentar índice ou alterar regras no QA Geral automaticamente**.

Uma alternativa técnica de banco Firestore nomeado no mesmo projeto separaria regras/dados **do banco**, mas não os demais serviços do projeto e pode implicar condições de custo; também precisa de análise e autorização, e não resolve por si só o acoplamento do APK.

## Gates verificáveis para um futuro APK QA

1. **Decisão e autorização**: projeto/banco e pacote QA exclusivos aprovados; custos e dependências verificados. Nenhuma mudança em produção.
2. **Segurança da variante**: Gradle e arquivo de configuração QA específicos; `applicationId` distinto do oficial e do Chat QA; build fail-closed sem configuração apropriada, projeto Firebase e app ID confirmados; teste unitário dos bloqueios.
3. **CI e revisão**: branch própria, revisão dos conflitos com PR #193, testes offline/Emulator, checks por SHA; APK identificado por pacote, versão, assinatura, hash e projeto Firebase extraído de seus recursos. Não confundir compilação do projeto com APK homologado.
4. **Infra QA**: somente após autorização independente para qualquer operação de criação/publicação, verificar Firestore Rules QA e índice `posts(uid ASC, createdAt DESC)` efetivamente `READY` por comandos **somente leitura via Termux**. Não executar deploy nesta tarefa.
5. **Agente 5 e Agente 7**: testar em aparelho real com dados sintéticos e depois revisar a integração PR #291 → #294 e os conflitos PR #193, antes de qualquer autorização de merge.

## Estado e bloqueios

- **Implementado neste ramo:** somente documentação e coordenação; **nenhum APK, variante, Firebase app ou índice criados**.
- **Evidência real:** identificação de projeto/banco, ausência de índices compostos no QA Geral, e registro Android existente do Chat QA, todos por leituras Termux do fundador.
- **Não validado:** vínculo do APK Perfil ao Firebase QA, regras remotas atuais, novo projeto/registro de Perfil QA, índice READY nesse novo destino, Android físico.
- **Decisão técnica:** **NO-GO** para merge/deploy/release das PRs #291/#294. Seguir em homologação offline enquanto o fundador decide o isolamento; não permitir uma falsa aprovação baseada em Android Emulator ou em outro aplicativo registrado.

**Controle de mudanças:** branch documental independente a partir da `main` indicada. Sem alteração de Gradle, Java/Kotlin, Security Rules, dados, Firebase, Cloudflare, produção, assinaturas, backup ou workflow.
