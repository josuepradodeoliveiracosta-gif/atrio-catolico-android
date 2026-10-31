# Átrio Católico — preparação para testes fechados na Google Play

Preparado em 31/10/2026. **Proposta em branch; nenhum envio à Google Play.**
O canal OTA/GitHub e a atual versão instalada são preservados até análise e integração.

## Arquitetura de dois canais

| Canal | Task | Instalação/atualizações |
| --- | --- | --- |
| Direto (GitHub) | `assembleRelease` | APK oficial; detector/download/instalador OTA com consentimento do Android |
| Google Play | `bundlePlayRelease` | Android App Bundle (`.aab`); Google Play gerencia instalação e atualizações |
| QA | `assembleDebug` | APK debug com assinatura de testes, sem OTA |

A variante `playRelease` preserva o pacote `br.com.atriocatolico` e o `versionCode`, marca `BuildConfig.PLAY_STORE_BUILD=true`, retira a permissão `REQUEST_INSTALL_PACKAGES` e o `FileProvider` OTA do manifesto final e impede qualquer tentativa de sideload de APK via código de execução.
A variante direta usa `PLAY_STORE_BUILD=false` e continua independente da Play. Para cumprir a política de envios da Play em 2026, a proposta atualiza `targetSdk` para **36**, aplicado aos builds do módulo: todas as telas e fluxos precisam de regressão (inclusive edge-to-edge e notificações).

A variante Play mostra **Atualizações pela Google Play**, sem consulta à API GitHub. Atualizações automáticas do Google Play estão disponíveis pelo mecanismo da loja; integração visual com Play In-App Updates API (Play Core) é trabalho separado e não está anunciada como concluída.

## Criar o AAB de pré-validação (sem assinatura)

Em execução isolada na PR, `.github/workflows/play-closed-aab-ci.yml` testa primeiro `scripts/play_release_gate.py --audit` e os testes unitários (o bloqueio de publicação é esperado), e em seguida executa `gradle :app:bundlePlayRelease` sem segredos, testa o arquivo `app/build/outputs/bundle/playRelease/app-playRelease.aab`, o manifesto final e `PLAY_STORE_BUILD=true`.
Não publica, não gera APK instalável Play, não salva um AAB não assinado como download.

O fluxo manual de assinatura, **antes de acessar qualquer chave**, executa `scripts/play_release_gate.py --enforce`. Esse controle valida a existência das nove evidências, revisores, datas UTC não futuras, URLs HTTPS não fictícias, `targetSdk=36`, pacote e overlay Play. Também exige `versionCode > 36`, pois o candidato OTA v0.20.1 da PR #70 reserva o código 36. Isso não certifica URLs, exclusão real ou autenticação do site; essas comprovações continuam externas e humanas. **Não elevar a versão do app automaticamente**, não tratar QA offline como autorização.

O canal de APK existente `build-apk.yml` continua com os mesmos nomes de tarefas/artifacts e a assinatura oficial continua exigindo aprovação do Guardião V2. Nenhuma assinatura nova é criada pela proposta.

## Chave de assinatura e migração — decisão obrigatória ANTES do primeiro envio

**Atenção especial:** o mesmo `applicationId` não basta para atualizar por cima do APK distribuído aos amigos: o certificado do APK entregue pela Google Play precisa corresponder ao certificado permanente do APK antigo.

No Play Console, **antes de cadastrar a assinatura padrão como definitiva**, decidir entre:

1. **Preservar a assinatura permanente:** configurar Play App Signing com a chave de assinatura original, seguindo o fluxo do Google Play (PEPK, caso indicado). A chave original não deve aparecer em repositório, mensagem, log nem publicação. O Play pode usar uma chave de **upload** diferente da chave que assina o APK instalado; isso é normal e recomendável. Essa é a opção preferida **quando o objetivo é manter a compatibilidade com instalações OTA existentes**.
2. **Chave gerada pelo Google:** simplifica a custódia de chaves, mas normalmente impede atualizar diretamente o APK OTA pré-instalado com assinatura diferente. Seria necessária migração planejada e preservação de dados antes da troca de origem.

Conferir no Play Console **certificado da chave de assinatura do app** (não apenas o certificado da chave de upload) e compará-lo com o certificado do Átrio antigo. Verificar também o SHA-1/SHA-256 de certificados no Firebase Authentication conforme os métodos de login utilizados. Não inventar fingerprints.
A proposta **não** faz upload de chaves privadas para Google.

## Checklist obrigatório antes de iniciar o teste fechado

- [ ] CI do AAB Play aprovado: target API 36; sem `REQUEST_INSTALL_PACKAGES`; sem instalador APK na variante Play.
- [ ] Validar telas em Android 16/API 36: navegação, margens sob barras de sistema, teclados e notificações.
- [ ] Encerre a homologação da versão 0.20.1 OTA (PRs #69/#70) antes de sincronizar `versionCode` na variante Play. O `versionCode` Play assinado deve ser **maior que 36** neste gate (código 36 reservado à candidata OTA); reavaliar o limite sempre que houver nova versão OTA. Não anunciar nem publicar uma nova numeração antes de testar atualização e assinatura.
- [ ] Confirme assinatura e plano de migração dos aparelhos atuais, evitando desinstalações precipitadas.
- [ ] Gerar AAB assinado **somente via workflow manual aprovado** e conferir SHA-256 do arquivo e certificado de upload.
- [ ] Criar/configurar o app no Play Console, `br.com.atriocatolico`, nome, categoria, imagens, descrição, contato e classificação indicativa.
- [ ] **Bloqueio identificado:** no código Android atual não foi localizado um caminho funcional para **solicitar exclusão de conta**. Implementar solicitação acessível no Perfil e um recurso público na web; o processo deve cobrir dados associados (Firebase Authentication, Firestore, imagens, notificações e outras cópias conforme aplicável) e declarar retenções justificáveis. Não criar botão que só elimina o login ou que apaga dados parcialmente.
- [ ] Adicionar política de privacidade pública, declarações de segurança dos dados, conteúdo e acesso de revisores; revisar moderação de conteúdo gerado pelos usuários e políticas aplicáveis.
- [ ] Testar autenticação Firebase, mensagens push, Guardião, discussões, perfil e atualização por cima em aparelhos reais **com a instalação proveniente da Google Play**.
- [ ] Definir a lista de testadores e faixa fechada, obter o link opt-in e confirmar aceite.
- [ ] Somente depois enviar o pacote à Google Play; nenhum workflow deve publicar automaticamente.

Em contas pessoais de desenvolvedor criadas após **13/11/2023**, para solicitar acesso de produção é exigido teste fechado com **pelo menos 12 testadores inscritos continuamente por 14 dias**. Isso **não impede** iniciar o teste fechado antes dos 14 dias.

## URLs oficiais para validação de requisitos

- Exclusão de conta e dados: https://support.google.com/googleplay/android-developer/answer/13327111
- Política de permissão de instalação: https://support.google.com/googleplay/android-developer/answer/12085295
- Alvo API 36 em 2026: https://support.google.com/googleplay/android-developer/answer/11926878
- Play App Signing e opções de chave: https://support.google.com/googleplay/android-developer/answer/9842756
- Testadores fechados: https://support.google.com/googleplay/android-developer/answer/14151465

**Estado:** projeto preparado para **validar o AAB**, não aprovado para publicar na Play Store sem revisão técnica e escolha da assinatura.

## Avanço do gate de assinatura — 31/10/2026

- `scripts/play_release_gate.py`: auditoria local sem rede e sem credenciais; `--audit` permite inspecionar candidatos ainda bloqueados e `--enforce` aborta assinatura antes do material de chave.
- `scripts/test_play_release_gate.py`: testes de regressão para colisão com versão OTA, API 35, variante/permissão OTA, URLs fictícias, evidências incompletas, revisões futuras, JSON inválido e ausência de manifesto.
- O workflow de CI sem assinatura executa os testes e o modo audit. O workflow manual exige o modo enforce antes da preparação de SDK e dos segredos de assinatura.
- A versão de código 35 da branch Play **continua intencionalmente bloqueada para assinatura**. `docs/google-play-privacidade-evidencias.json` também ainda não existe nessa branch nem na main; não criar evidências artificiais. O code 36 reservado ao OTA também será recusado. Nenhuma versão Play foi elevada ou publicada.
- Os resultados do gate não comprovam que o certificado de assinatura do app gerenciado pelo Google coincide com o APK já instalado. É obrigatória comparação externa no Play Console antes de upload ou migração de usuários.
