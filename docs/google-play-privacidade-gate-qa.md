# Google Play — privacidade e exclusão de contas (testes fechados, QA)

Estado: **BLOQUEADO para publicar**. Trabalho concentrado na PR #98; issue #72 aberta.
Este documento não atesta conformidade nem substitui revisão jurídica, verificação HTTPS ou teste em aparelhos reais.

## O que foi adicionado

- `docs/google-play-privacidade-evidencias.json`: nove exigências com estado inicial `verified:false`, sem URLs fictícias, endereços pessoais ou credenciais.
- `scripts/play_privacy_gate.mjs --audit`: audita se a solicitação Android e o portal estão preparados no código, se o simulador mantém `deletionAuthorized:false`, e lista bloqueios. A auditoria não implanta nada nem autoriza o Google Play.
- `scripts/play_privacy_gate.mjs --enforce`: código de saída **2** enquanto houver qualquer requisito pendente; código **1** para evidência inválida ou falta de salvaguarda. Não é um substituto do processo humano. Uso futuro em pipeline de release só após integrar e revisar o gate.
- `scripts/play_privacy_gate.test.mjs`: impede autorizações fictícias, URL de exemplo e liberação baseada apenas em CI verde.
- `.github/workflows/privacy-account-portal-ci.yml`: roda os testes e a auditoria de privacidade junto aos testes seguros da PR, **sem deploy**.

## Evidências que ainda precisam ser coletadas

1. AAB Play com opção de exclusão visível e testes de autenticação no dispositivo, preservando assinatura e OTA.
2. Portal real HTTPS, acessível sem APK, com login e recuperação de conta, sem URL falsa.
3. Executor de exclusão real e seguro de Auth, dados Firestore relacionais/subcoleções, Avatar/Cloudinary, D1, notificações e tokens FCM.
4. Barreira distribuída efetiva de Avatar, Guardião, Push, crons, filas, retries e toda escrita privilegiada.
5. Política de retenção, exceções justificadas e revisão legal.
6. Política de privacidade pública e contato verificável, com coleta, compartilhamento, provedores e prazos descritos.
7. Declarações de Segurança dos dados da Play Console consistentes com código e política.
8. IAM administrativo, reautenticação, antifraude, testes de falha parcial, auditoria mínima e reconciliação.
9. Teste fechado ponta a ponta com duas contas distintas e registros verificáveis de conclusão, sem apagar contas reais durante QA.

Ao obter cada evidência: registrar URL HTTPS verificável (ex.: execução GitHub Actions ou documento de revisão), identificador de revisor e data; não inserir nomes de usuários reais, UID, tokens ou senhas. **Uma marca `verified:true` não constitui prova técnica de serviço implantado**: evidências devem ser verificadas independentemente.

## Regras de segurança

- Firebase Emulator usa exclusivamente `demo-atrio-v11`; Cloudinary/FCM/D1 simulados ou isolados.
- Não executar `--enforce` como autorização de deploy até haver integração revisada no pipeline de AAB Play (PR #71); a flag em si não publica nem assina nada.
- Não fechar a issue #72, não fazer merge da PR #98, não implantar nem excluir contas reais com base nos testes.
- Não mudar a `main`, o backup protegido, os certificados, o `applicationId`, o `versionCode`, APK OTA ou Play Console.
- Em caso de evidência parcial, falha operacional ou desconhecimento, **continuar bloqueado**.

Documentação oficial:
- https://support.google.com/googleplay/android-developer/answer/13327111
- https://support.google.com/googleplay/android-developer/answer/10144311
