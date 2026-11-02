# Átrio Católico — caminho crítico acelerado para Google Play
**Atualização:** 02/11/2026 · PR #71 (rascunho) · sem deploy, sem merge e sem modificação de backups ou produção.

## Decisão de foco
**Pausar a expansão de protótipos sintéticos de broadcast** após corrigir vulnerabilidades reais e preservar seus testes. A prioridade agora é liberar um **primeiro pacote de teste fechado que cumpra as políticas**, antes de otimizar notificações para grandes volumes. A compilação Android não é o bloqueio dominante; a candidata Play `0.20.2`, code `37`, targetSdk `36`, já teve AAB **não assinado** aprovado. Assinar, carregar na Play Console, testar num aparelho pela Play e declarar conformidade são fases distintas.

## Trabalho em paralelo — bloqueios reais

| Frente | Entrega objetiva | Dependência / responsável | Como comprovar |
| --- | --- | --- | --- |
| **A. Política e conta** | Identidade do controlador, canal público, política de privacidade e termos comunitários revisados, URLs HTTPS reais | Responsável pelo app e revisão jurídica/LGPD | Política e termos acessíveis em navegador anônimo e pelo app; histórico de versão; sem placeholders |
| **B. Exclusão efetiva** | Pedido iniciável dentro do app e pela web, identificação segura, atendimento e exclusão dos dados associados; exceções de retenção justificadas | Engenharia + operador autorizado; não ativar portal existente até existir atendimento real | Solicitação em duas identidades de QA e processamento ponta a ponta com evidência; outra conta preservada; nenhuma saída de dados reais em testes |
| **C. Comunidade UGC** | Aceite de termos vigente antes de postar; denúncias de post, resposta e usuário; bloqueio de membros e moderação operacional | Engenharia + moderação e política de conteúdos | Testes de duas contas em emulador, depois aparelho; Rules e Push não contornáveis por cliente legado |
| **D. Assinatura e Play Console** | Confirmar app `br.com.atriocatolico`, suporte, ficha da loja, Segurança dos dados, classificação, público-alvo, acesso do revisor e certificados | Titular da conta Play Console | Conferência de dados no Console, integridade do app, compatibilidade com APK atual, assinatura manual aprovada |
| **E. Teste fechado** | Após primeiros gates, enviar **manualmente** AAB assinado e realizar instalação pela Play | Titular do Console + testadores | Link de adesão, instalação real, evidências pós-upload para exclusão/UGC; somente depois considerar produção |

O Google permite que a solicitação externa de exclusão use **formulário ou atendimento**, sem exigir necessariamente autoexclusão imediata no navegador. Contudo, a opção precisa funcionar, ser clara e remover os dados associados quando o pedido for processado, salvo retenções legalmente justificadas. **Não basta congelar a conta.** As regras de UGC exigem aceite de termos e mecanismos de denúncia, bloqueio e moderação apropriados.
Fontes oficiais: https://support.google.com/googleplay/android-developer/answer/13327111 e https://support.google.com/googleplay/android-developer/answer/9876937 .

## O que pode ser feito agora, sem credenciais novas
- Concluir código e testes de integração de B e C no emulador, sem ativar nem modificar backend real.
- Revisar os campos da política e os rascunhos da ficha da loja em paralelo, coletando as decisões de titularidade, suporte e retenção fora do repositório público.
- Validar o caminho de assinatura e de migração de certificado, **sem criar chave** e sem copiar certificados privados ou senhas.
- Manter o `--enforce` bloqueado até haver URLs/serviços reais, testes e revisores; preservar `verified:false` e `releaseAuthorized:false`.

## Aceleração do CI sem dispensar segurança
O workflow `play-closed-aab-ci.yml` continua executando as verificações de privacidade, auditoria de evidências, exclusão de QA e gates de assinatura em alterações relevantes. A compilação `bundlePlayRelease` só é dispensável em eventos `pull_request:synchronize` quando o histórico anterior é comprovadamente ancestral e **todos** os arquivos alterados pertencem à lista fechada de backend, documentos ou testes isolados. Novo PR, execução manual, diff faltante, histórico reescrito ou arquivos desconhecidos = **recompilar AAB**. O workflow informa quando NÃO construiu AAB naquela revisão; um resultado verde não é uma homologação do pacote. O workflow de assinatura manual sempre compila integralmente.

Paths antes não incluídos na CI Play agora acionam as verificações: `cloudflare/privacy-batch-stage/**`, `cloudflare/privacy-freeze-stage/**`, `cloudflare/push-worker/**`, `tests/security/**`, `firestore.rules`, configuração Gradle na raiz e auditoria Firebase.

## Critérios de decisão, sem atalho falso
- Manifesto atual: **0/9 controles de privacidade** e **0/6 controles UGC** com evidência homologada; os testes de faixa fechada são necessariamente posteriores ao primeiro envio.
- O requisito de **12 testadores contínuos por 14 dias** aplica-se, para solicitar acesso à produção, a contas pessoais criadas depois de 13/11/2023. Não é pré-requisito para **começar** o teste fechado. Fonte: https://support.google.com/googleplay/android-developer/answer/14151465 .
- Não assinar, fazer upload, alterar flags de produção, liberar broadcast por tópico ou publicar o portal até revisão operacional e autorização específica.
- Guardar evidências verdadeiras com revisor e data; jamais preencher o manifesto automaticamente para aprovar um release.

**Próxima implementação com melhor retorno:** fechar B (atendimento e exclusão efetiva) e C (teste UGC ponta a ponta), além de resolver em paralelo os dados públicos e materiais do Console. A homologação Cloudflare independente é uma dependência de engenharia quando exigida pelo desenho adotado, não uma razão para continuar adicionando QA sintético sem fim.


## Bloqueio de comunicados FCM legados na variante Play — 02/11/2026

A variante `playRelease` não deve se inscrever em
`atrio_comunicados_v1`: comunicados em tópico não conseguem respeitar
individualmente bloqueios, exclusões ou desativação de destinatários.
Agora `PushRegistry.register` tenta **desinscrever** o tópico geral na
variante Play, preservando a inscrição do APK OTA legado. A rotina de
sincronização também tenta remover tópicos antigos das discussões.

O receptor Play só mostra `kind=broadcast` quando a mensagem de dados
contém o `uid` exatamente igual ao usuário autenticado **e não provém
de um tópico FCM**. Mensagens sem destinatário ou com outro UID são
ignoradas. A política pura `PlayBroadcastDeliveryPolicy` tem teste
JUnit incluído na compilação AAB já existente; não requer novo job.

**Risco remanescente:** a desinscrição FCM depende de rede e não tem
confirmação operacional nesta PR. Em mensagens FCM com payload
`notification`, o sistema pode exibi-las sem passar pelo código do
receptor, principalmente em segundo plano. Portanto é obrigatório
**desligar a emissão por tópicos nos Workers reais** e homologar a
entrega individual `data`, o controle de bloqueio e a exclusão antes de
publicar. O novo filtro Android não autoriza o lançamento nem
substitui barreiras duráveis contra concorrência. Nenhum Worker ativo foi
atualizado e nenhuma notificação real foi enviada.


## Central administrativa também alerta denúncias de usuários (02/11/2026)

A `NotificationCenter` adiciona `user_reports` à categoria
**Administração · denúncias**, junto das denúncias de discussões e
respostas. A consulta é paginada pelo limite atual da Central e as
Firestore Security Rules continuam restringindo a leitura a
administradores. Somente denúncias pendentes são mostradas, com título
genérico, sem motivo, UID ou identificador do denunciante na mensagem.
O identificador guardado nas preferências de leitura é um digest
SHA-256 do ID da denúncia mais o timestamp, evitando salvar UIDs
em claro. A consulta de `user_reports` só alimenta avisos quando
confirmada pelo servidor, sem cache ou gravações locais pendentes;
erro ou sessão incorreta oculta os itens e exibe erro de consulta.

Não foi criado push externo, não houve alteração no Worker, Rules ou
em produção. O aviso abre a moderação existente, onde a fila administrativa
do tipo `user_reports` já é acessível. Os testes JUnit verificam
agrupamento, privacidade do texto/identificador e remoção das
denúncias analisadas da lista de pendências. O painel não é prova
de disponibilidade contínua de moderadores nem autoriza a Play.


## Bloqueio de regressão FCM antes de assinatura Play (02/11/2026)

O gate existente `scripts/play_release_gate.py` executa agora
`play_push_privacy_blockers` nos modos `--audit` e `--enforce`, sem
novo workflow ou serviço. Ele recusa a assinatura se desaparecerem
as proteções do cliente Play contra recebimento de comunicados por
tópicos, migração de inscrições legadas, identificação por UID ou
o bloqueio deliberado do endpoint `/broadcast` no código do Worker.

A suíte offline `scripts/test_play_release_gate.py` valida o contrato
atual e seis regressões sintéticas: ausência de destinatário, volta de
subscribe ao tópico geral, perda da desinscrição de tópicos de
discussões, eliminação do filtro UID, eliminação da checagem de origem
por tópico e reativação indevida do broadcast no Worker.

**Limite:** auditoria estática não comprova que o Worker atualmente
implantado corresponda ao código da PR, nem que a desinscrição FCM
tenha sido completada em todos os aparelhos ou que as barreiras
distribuídas já estejam operacionais. Testar FCM individual real com
contas fictícias e o conteúdo do AAB final continua obrigatório,
e `push_block_safe_delivery` permanece não verificado.


## Token FCM: diagnóstico restrito à sessão OTA — 02/11/2026

Na variante Play, o painel avançado de notificações **não oferece**
o comando de copiar token FCM para a área de transferência do Android.
O botão permanece disponível na distribuição OTA de diagnóstico, mas
só funciona quando a conta autenticada ainda corresponde ao UID do
painel e as notificações estão habilitadas nesse aparelho. A mesma
regra é reavaliada quando a consulta assíncrona do token termina,
para evitar copiar um token após logout, troca de conta ou desativação.
Nenhum token é registrado em logs, no estado do Compose ou em mensagem
de erro.

A regra pura `mayUseFcmTokenDiagnostics` é testada na suíte JUnit
existente de `PushRegistrationDiagnosticTest`. O gate pré-assinatura
também recusa regressões que tornem o botão disponível na Play ou
retirem a checagem de sessão; os testes sintéticos ficam na suíte
Python já utilizada. Não foram alterados o cadastro FCM, a entrega
de notificações, as permissões Firestore, a chave de assinatura nem
o Worker implantado.

**Limitação:** isso protege a cópia *iniciada pelo app*; não limpa
tokens copiados anteriormente em outros aplicativos e não comprova
a exclusão do registro remoto de `pushDevices` quando o usuário
encerra a sessão sem conexão. O recebimento de mensagens `notification`
por fora do receptor e o cancelamento remoto de inscrições antigas
continuam sujeitos à homologação real antes da Play.


## Logout FCM confirmado no servidor — 02/11/2026

O logout anterior apagava o registro `pushDevices/{deviceId}` de forma
assíncrona e chamava `auth.signOut()` imediatamente. Agora o aplicativo
desliga os avisos localmente, registra uma pendência persistida por UID,
solicita a remoção e só encerra a sessão automaticamente após
**confirmação do Firestore sob a mesma conta autenticada**.
O diálogo permite **Sair sem confirmação** caso a remoção permaneça
pendente ou falhe; também oferece permanecer no app ou tentar de novo
após erro. Cancelar invalida os callbacks de saída tardios.

Enquanto o servidor não confirma a exclusão remota, novas ativações
FCM nessa conta/dispositivo são bloqueadas. A tela de Push mostra
explicitamente a pendência e oferece repetição da remoção. Quando o
titular entra novamente na mesma conta, tenta-se reconciliar a
pendência antes de reativar o cadastro. Não se apagam registros de
outra conta com sessão incorreta. Um teste JUnit acrescentado à suíte
existente verifica a condição pura da conclusão automática.

**Limites:** offline pode impedir confirmação indefinidamente; logout
explícito sem confirmação pode deixar o documento remoto até o titular
autenticar-se outra vez ou até limpeza administrativa autorizada.
A confirmação do Firestore não comprova revogação completa do token
FCM, cancelamento de todo tópico legado ou exclusão de conta. Ainda
são obrigatórios QA de rede, duas contas e tokens em aparelhos reais.
Nenhum deploy ou mudança de produção foi realizado.
