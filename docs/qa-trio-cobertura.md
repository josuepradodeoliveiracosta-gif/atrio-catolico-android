# Plano de cobertura QA — Clara, Miguel e Lúcia (Átrio Católico v0.19.0)

## Política operacional
- Os três bots só agem na **comunidade oficial** quando o fundador pedir **uma sessão específica nesta conversa**; a autorização não se renova. `QA_MANUAL_ENABLED=true` mantém a fila pronta entre sessões, conforme solicitação de 27/10; isso não gera mensagens automaticamente. Sem Cron nem painel no perfil do fundador.
- Perfis públicos identificados como **BOT DE TESTE**. Nunca simular usuários humanos sem identificação, falsificar selo eclesial, atingir discussões reais de terceiros ou divulgar dados reais.
- Sessões de produção registradas: `qa_chat_20261027_02` e `qa_real_auth_20261027_01`. Esses registros históricos não autorizam novas sessões pelo simples fato de alterar código ou verificar CI.
- Não executar alterações destrutivas em produção por bots. Limpeza de conteúdo de teste requer uma operação de manutenção cuidadosamente delimitada aos IDs gerados pela sessão e com autorização independente.

## Três camadas complementares de testes

| Área | Bot / teste | Ambiente | Situação / evidência |
|---|---|---|---|
| Entrada e perfil | Clara | Firestore emulador | Testes estendidos de create/update/get, privacidade, limitações |
| Discussão / categorias | Clara e Miguel | Firestore emulador | Criar, consultar, editar, validar tamanhos/categoria, excluir própria |
| Resposta / threads | Miguel e Lúcia | Firestore emulador | Responder, consultar, prevenir falsificações, excluir própria |
| Curtidas / Salvos | Miguel e Lúcia | Firestore emulador | Criar/consultar/desfazer, garantir isolamento por UID |
| Notificações internas | Os três | Firestore emulador | Batch resposta+aviso, leitura, marcar lido, dispensar, impedir avisos falsos |
| Selo leigo / verificação clerical | Os três | Firestore emulador | Pedido de verificação, leitura admin, bloqueio de autoaprovação |
| Denúncias e moderação | Lúcia e admin sintético | Firestore emulador | Denúncia de post/resposta, leitura admin, bloqueio de remoção não autorizada |
| Registros FCM | Clara e Lúcia | Firestore emulador | Registrar/revogar token sintético, privacidade, sem FCM verdadeiro |
| Guardião | Os três | Unit + Firestore emulador | CPF fictício, proteção contra auto-ocultação indevida, denúncias e quarentena |
| Regras Firebase | Os três e admin sintético | Firestore emulador | 155+ testes gerais + 21 testes dos bots + 75 cenários estendidos |
| Publicações e respostas oficiais | Clara, Miguel e Lúcia | Comunidade oficial | Sessão `qa_real_auth_20261027_01` concluída com três ID tokens individuais e regras comuns; requer novo pedido para repetir |
| Interface Android básica | Clara, Miguel e Lúcia | AndroidTest Compose em modo **demonstração local** | 9 testes instrumentados de demonstração aprovados; consultar execução e commit na seção de evidências |
| Interface Android com Firebase emulado | Três contas criadas no Firebase Auth Emulator | Android virtual + Auth/Firestore locais | Consultar execução e commit na seção de evidências; não usa contas ou dados oficiais |
| Interface Android autenticada na produção | Contas oficiais de QA | APK conectado ao projeto oficial | **Pendente**: não comprovada por testes em emuladores Firebase |
| Entrega Push fora do aplicativo | Aparelho físico/emulador com Google Play Services e FCM | Dispositivo real / laboratório separado | **Não comprovada** |
| Desempenho, acessibilidade, rede lenta/offline | Laboratório de testes | Android instrumentado | **Pendente** |
| Moderação de casos ambíguos e apelações | Administração real, em cenário controlado | Revisão humana | Requer autorização específica e critérios de proteção |

Os 75 cenários estendidos passaram em `three-bots-extended.test.mjs`; 21 outros passaram em `three-bots.test.mjs`.
O comando de CI `tests/security/npm test` executa os dois conjuntos **sem usar Firebase em produção**.

## Para usar
- **Validação de regras e código:** CI `Validar selos (Android e Firestore)` executa automaticamente testes do emulador Firebase e compila os testes instrumentados Android.
- **Interação com telas em Android virtual:** workflow automático em PRs relevantes e manual `QA Android dos três bots (emulador isolado)`, arquivo `.github/workflows/android-bots-ui.yml`. Executa `:app:connectedDebugAndroidTest` sem chaves Google Cloud nem Firebase oficial; demonstração local e `OnlineAtrioApp` conectado exclusivamente aos emuladores Auth/Firestore.
- **Sessão oficial:** pedir explicitamente aqui quais funcionalidades deseja testar; somente a fila privada `atrio-qa-manual-v19` recebe comando isolado. A função atual produz uma discussão + duas respostas + dois avisos internos, **não cobre todos os recursos do app oficial**.
- **Interações externas:** testes com Google Cloud IAM, dispositivos físicos, Play Store, FCM real, versão release assinada e políticas de administradores **não são automatizados** por esses três bots hoje.

## Critérios de qualidade
1. Somente marcar **aprovado** após resultado efetivo do teste; código compilado não equivale a execução em aparelho.
2. Nunca promover perfis de QA a administradores ou conceder selos clericais no Firebase real.
3. Cada cenário deve produzir resultado observável (PASS / FAIL), indicando ambiente, cobertura e limite da evidência.
4. Execuções em produção são opt-in, limitadas, rastreáveis, com trava de duplicação e inativas ao término.
5. Falha de infraestrutura não equivale a falha funcional do Android: classificar separadamente.

## Retomada 27/10 — execução de testes Android

- A workflow `.github/workflows/android-bots-ui.yml` também dispara com mudanças relevantes de código da PR; roda **somente** em Android virtual, com testes Compose de demonstração e um cenário conectado aos emuladores locais de Auth/Firestore (`demo-atrio-v11`).
- Os testes de autenticação real da comunidade são executados pelo Cloudflare sob comando isolado, sem credenciais expostas no Android e sem acesso da automação de UI à produção.
- A compilação instrumental Android pode passar sem provar os toques: verificar a conclusão da job `Testar telas do Átrio em Android virtual` antes de marcar os cenários visuais como aprovados.
- Nenhum teste visual envolve entrega FCM física, Play Store ou navegação de três dispositivos Android autenticados no projeto de produção. Essas coberturas permanecem explicitamente pendentes.

## Evidência de execução — 27/10/2026

- Commit de código validado: `6c9d2fef4395d237ce17c06565cc7300919f724a`, na PR #15.
- [Execução Android 40540050475](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/40540050475): **10 testes aprovados**, sem falhas ou testes ignorados (9 de demonstração e 1 cenário com Firebase emulado).
- O cenário conectado cria três contas locais, entra pelo formulário, publica como Clara, responde como Miguel, curte e salva como Lúcia e retorna à conta Clara para verificar o aviso interno. As gravações são verificadas no servidor Firestore emulado. A preparação das contas e o encerramento das sessões usam o SDK; a leitura do aviso é pelo SDK, sem testar o toque na central de notificações.
- Corrigidos no teste: botões fora do viewport, consulta do feed antes do snapshot após trocar de conta e digitação antes do carregamento da discussão. Agora há rolagem, verificações de visibilidade/habilitação e esperas condicionais limitadas. Os cliques de envio continuam sendo feitos pela interface.
- As verificações de versão, relay push e Android/Firestore também passaram nesse commit. O teste do relay não comprova entrega de push em aparelho físico.
- Esta rodada não executou bots na comunidade oficial, não publicou infraestrutura, não gerou um lançamento e não alterou a assinatura do aplicativo. A PR permanece em rascunho.
