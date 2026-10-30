# Átrio Guardião V2 — aviso educativo antes de publicar (pré-lançamento)

**Situação:** ainda sem publicação pública e sem usuários reais. Implementado somente na branch `feature/guardiao-autonomo-20261029`, incluído no APK **Debug de QA**, não na `main` ou em Release distribuída.

## Funcionalidade adicionada

O módulo Kotlin puro `GuardianPreflight.kt` faz uma classificação **local e simples** antes de enviar um texto do Android ao Firestore. Não usa internet, banco de dados, Cloudflare, IA paga, permissões administrativas, armazenamento nem logs de texto.

O `OnlineAtrioApp.kt` usa a triagem em quatro fluxos: nova discussão (título e corpo), resposta normal, resposta direta/menção e edição de discussão. Quando uma regra conservadora detecta possível risco, o app abre um diálogo com as opções **Revisar texto** e **Publicar mesmo assim**. Nenhuma publicação é feita até que a pessoa confirme; cancelar uma resposta informa `done(false)` para devolver o controle ao formulário.

Sinais testados: CPF matematicamente válido, link associado a solicitação de senha ou dados, ameaça em primeira pessoa, texto com quatro ou mais links e entrada muito longa. O detector reconhece termos de contexto religioso ou relato ao avaliar ameaças/fraudes, reduzindo acusações indevidas contra citações teológicas.

**Não é censura e não é punição.** Mesmo textos sinalizados podem ser enviados após confirmação. A regra não analisa denúncias: denunciar conteúdo suspeito não deve gerar obstáculos para quem denuncia.

## Limitação fundamental

**Essa verificação não é uma defesa do servidor.** Ela é executada no aplicativo do autor, portanto um cliente Android modificado, uma chamada direta à API do Firestore ou outro app podem ignorá-la. As regras Firestore continuam sendo a barreira de autorização; o Guardião backend continua responsável pela moderação posterior. Não anunciar o sistema como moderação automática 24/7 por causa dessa funcionalidade.

Um detector por expressões simples tem falsos negativos e positivos. É uma orientação preventiva para reduzir erros acidentais, não um modelo de moderação infalível. A pessoa pode revisar sem perder o texto ou continuar explicitamente.

## Validação

- `app/src/test/java/br/com/atriocatolico/GuardianPreflightTest.kt`: testes Kotlin para discussão católica legítima, citação teológica, link de coleta de senha, ameaça, CPF válido/aleatório, excesso de links, texto longo e ausência de vazamento de dados no aviso.
- Os eventos da interface usam `Modifier.testTag("atrio-guardian-continue")` e `Modifier.testTag("atrio-guardian-revise")`, para ensaio visual futuro no Android Emulator.
- `ThreeBotsOnlineEmulatorTest` exercita o aviso no aplicativo real, conectado apenas aos emuladores locais de Auth e Firestore. Confere que revisar ou pressionar Voltar preserva título e corpo sem gravar; confirmar publica uma única discussão com o texto intacto; o próximo formulário começa vazio. Também confere que revisar uma resposta preserva o rascunho e libera o botão para enviar o texto corrigido. As leituras de verificação usam `Source.SERVER`, não apenas o cache da interface.
- O formulário mantém o rascunho enquanto a confirmação está pendente ou o envio falha. Ele é descartado quando a publicação bem-sucedida navega para o início. A correção avança somente a versão Debug de testes para `0.19.8`; a Release e sua assinatura permanecem inalteradas.
- O workflow GitHub `guardiao-autonomo-qa.yml` executa `gradle :app:testDebugUnitTest :app:assembleDebug`. **Não declarar compilação aprovada antes da conclusão do job do HEAD que contém esta alteração.**

## Isolamento e custos

Nenhuma alteração na `main`, Firebase oficial `atrio-catolico`, Worker de push `atrio-push`, backups, chaves, contas, índices ou versão Release. A rotina sintética Cloudflare QA permanece ativada, com moderação real desligada. Nenhum serviço pago foi criado ou habilitado.

**Próximo objetivo:** validação dos testes Debug, seguida de teste da experiência de revisão no Android Emulator. Depois será preciso uma autenticação do backend realmente contínua e aprovada para moderar conteúdo do Firebase sem depender do aplicativo do autor.

