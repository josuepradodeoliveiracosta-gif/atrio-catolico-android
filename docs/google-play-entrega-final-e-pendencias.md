# Átrio Católico — execução final para o teste fechado Google Play

**Documento operacional, não uma autorização de lançamento.**
Branch: `feature/play-closed-testing-aab-20261031`. PR #71 (draft).
App: `br.com.atriocatolico`; candidata Play `0.20.2`, `versionCode 37`, `targetSdk 36`.
Os números da versão precisam ser conferidos de novo antes de assinar, sobretudo se um novo APK OTA for publicado.

## Situação efetivamente verificada

- AAB Play **sem assinatura** aprovado na execução GitHub Actions `41262009257` (31/10–01/11/2026), incluindo manifesto e testes isolados.
- APK, regras Firestore, Guardião, selos, relay Push e segurança passaram nessa revisão.
- **Não houve assinatura do AAB, upload no Play Console, faixa fechada iniciada, publicação de site ou implantação de executor.**
- Evidências de privacidade **0/9** e UGC **0/6**, todas `verified:false`; `releaseAuthorized:false`.
- Interface Android para solicitar exclusão: código integrado, testes no Emulator.
- Portal de exclusão: código integrado; o formulário **permanece bloqueado**. Não afirmar URL pública nem capacidade de atendimento.
- Plano e coordenação de exclusão: apenas QA com contas fictícias, incluindo testes de falhas e de freeze; **não apagam conta real**.
- Não houve verificação do Play Console (não conectado a esta conversa), dos certificados reais ou de testadores inscritos.

## Ordem obrigatória para habilitar primeira distribuição na faixa fechada

| Prioridade | Responsabilidade | Trabalho e comprovação necessária | Critério de aceite |
| --- | --- | --- | --- |
| 1 | Responsável pelo app + revisão jurídica | Confirmar nome do controlador, contato público de suporte/privacidade, direitos dos titulares, categorias de dados religiosos, prazos e razões legais de retenção | Política revisada e aprovada, sem campos `[A CONFIRMAR]` |
| 2 | Engenharia + revisão de segurança | Integrar barreira persistente **em todas** as escritas reais de Avatar, Guardião, Push, filas, cron, fanout, D1, Firebase Admin e Cloudinary; proteger sessões/efeitos em andamento | QA multiusuário/concorrente e teste de não regressão completos, sem bypass |
| 3 | Engenharia + revisão jurídica | Executor idempotente real de exclusão e reconciliação (Auth **por último**), segurança de identidade administrativa e decisões de retenção | Caso isolado e ponta a ponta comprovado, sem apagar dados de terceiros |
| 4 | Engenharia + responsável | Publicar política HTTPS e portal web de solicitação **funcional e utilizável sem APK**, com atendimento real e recuperação de acesso | URL externa validada em navegador anônimo e pedido de teste reconhecido; não revelar credenciais |
| 5 | Responsável + QA | Moderar conteúdos, publicar termos versionados e exigir aceite antes de UGC; homologar denúncia, bloqueio bilateral e Push respeitando bloqueio **na infraestrutura ativa** | Cinco controles UGC pré-envio com evidência e revisão real |
| 6 | Responsável + revisão LGPD | Preencher e revisar Segurança dos dados, classificação indicativa, acesso do revisor, público-alvo, informações de contato e ficha Play | Declarações coerentes com AAB e serviços realmente ativos |
| 7 | Responsável pelo certificado | Decidir Play App Signing comparando **certificado de assinatura do aplicativo** com os APKs OTA existentes; validar certificado **de upload** separadamente; preparar segredos no GitHub sem copiá-los em PR/chat | Compatibilidade de upgrade estabelecida ou migração explicitamente planejada |
| 8 | CI + responsável | Somente após gates verdadeiros, revisar evidências e executar assinatura manual, validar AAB e realizar upload pelo Play Console | AAB assinado aceito na faixa fechada, sem instalador OTA |
| 9 | Testadores + QA | Instalar **pela faixa fechada** e testar exclusão, termos, denúncia, bloqueio, notificações, migração, login e Android 16; registrar evidências `closed_track_e2e` e `closed_track_ugc_e2e` | QA E2E pós-upload homologada, não preenchida retroativamente |
| 10 | Responsável Play Console | Cumprir eventual requisito de conta pessoal nova (12 testadores inscritos continuamente por 14 dias) e solicitar acesso à produção posteriormente | Aprovação do Play Console; não confundir com início da faixa fechada |

## Informações que só o responsável pode autorizar ou fornecer

Os seguintes dados **não devem ser inventados nem publicados no GitHub**:

1. Conta Play Console verificada, app cadastrado e status do pacote `br.com.atriocatolico`.
2. Identidade/nome jurídico do controlador e **contato público de suporte e privacidade**.
3. Decisões sobre prazos, bases legais e exceções de retenção, inclusive dados relativos à religião.
4. Domínio/URL HTTPS legítimos para política e solicitação de exclusão.
5. Escolha de assinatura do app e conferência das impressões digitais reais **fora de arquivos públicos**.
6. Credenciais de acesso de revisor, listas de testadores e evidências de adesão (somente no Play Console/canal privado).

Nenhum desses pontos pode ser substituído por aprovar manifestos JSON ou publicar artefatos de QA.

## Verificações e pontos de controle

- PR: https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/71
- Exclusão: https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/issues/72
- UGC/Push: https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/issues/99
- Gate local de pré-assinatura (não destrutivo): `python3 scripts/play_release_gate.py --audit`
- Modo de assinatura `--enforce` **continua bloqueado** até evidências reais.
- Fontes oficiais: https://support.google.com/googleplay/android-developer/answer/13327111 ,
  https://support.google.com/googleplay/android-developer/answer/9876937 e
  https://support.google.com/googleplay/android-developer/answer/14151465 .

**Proibido antecipar:** merge de PRs incompatíveis, deploy em produção, destruição de conta, geração de nova chave ou aprovação artificial de evidências.
