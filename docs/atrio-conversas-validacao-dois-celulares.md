# Átrio Conversas — validação em dois celulares Android (sem produção)

**Estado:** teste funcional básico em dois celulares com APK e Firebase de homologação separados foi relatado pelo responsável em 07/11/2026 (Issue #199). Os 15 cenários abaixo ainda não têm evidências individuais suficientes; não confundir com ausência de qualquer teste físico.
**PR:** #193 · **Escopo:** chat privado e grupos textuais · **Ambiente:** homologação segregada.

## Pré-condições para iniciar

- [x] E2E Android emulado aprovado no commit `e20f52d` da PR (workflow #42494994938, job #128779213493). Revalidar somente se houver mudanças relevantes.
- [ ] Contas de teste **adultas e autorizadas**, sem dados de terceiros ou menores.
- [ ] Ambiente de homologação isolado, com projeto Firebase de teste, regras específicas revisadas e chave do Worker separada. **Não usar o Firebase nem as credenciais oficiais.**
- [ ] APK de teste distinto, sem assinar como Release oficial e sem substituir o APK da produção.
- [ ] Autorização de notificações Android concedida nos dois aparelhos de teste. Confirmar previamente os gates administrativos e política de retenção de homologação.
- [ ] Dois aparelhos Android físicos disponíveis, preferencialmente versões de Android ou fabricantes distintos.
- [ ] Registros de teste sem textos sensíveis, sem tokens FCM ou dados de autenticação em capturas ou logs.

## Preparação da variante Android Chat QA (sem produção)

A branch de homologação agora possui buildType `chatQa`, **desativado por padrão**, com pacote
`br.com.atriocatolico.chatqa`, assinatura Debug e sem acesso à assinatura Release. O
APK Debug normal produzido pelo CI não equivale a esse pacote isolado.

Para compilar localmente com aprovação explícita do ambiente de testes, o operador deve
providenciar um **Firebase separado**, um `app/src/chatQa/google-services.json` local
(ignorado pelo Git), e os valores aprovados de `ATRIO_CHAT_QA_PROJECT`,
`ATRIO_CHAT_QA_APP_ID`, `ATRIO_CHAT_QA_WORKER_URL` (Worker identificado como QA)
e `ATRIO_CHAT_QA_CONFIG_SHA256` (hash SHA-256 do JSON aprovado).
Não copiar a configuração oficial, nem salvar credenciais de servidor na pasta.

Com essas variáveis definidas e os endpoints gerais/credenciais oficiais ausentes,
o único comando de compilação permitido é:

```sh
ATRIO_CHAT_QA_BUILD=1 gradle :app:assembleChatQa --no-daemon
```

O gate offline exige igualdade do projeto, App ID, FCM sender, hash e pacote .chatqa,
e recusa Workers oficiais ou sem marcador QA. Isso **não prova** que o endpoint QA
seja independente em execução, nem que o APK final usou a configuração correta.
Antes de instalar, executar a auditoria do **APK real** abaixo e os testes FCM físicos
já previstos. Nenhum Firebase, Worker, Release ou backup é alterado por esse preparo.

## Verificação offline de identidade do APK de homologação

Antes de repetir qualquer teste físico, conferir o APK **já existente** com `scripts/chat_qa_apk_identity.py`. Não usar o APK oficial ou uma configuração Firebase real. É necessário conhecer previamente os valores públicos e aprovados de pacote, projeto de QA, **Firebase Android App ID do projeto de QA** (obtido de uma referência independente do APK), certificado público de QA e SHA-256 do APK.

O script não instala nem modifica o arquivo, não acessa Firebase/Cloudflare, não assina e não registra API keys, tokens, IDs de contas ou conteúdos privados. Ele exige que pacote, projeto Firebase e assinatura de QA sejam distintos dos oficiais, e confirma a configuração Firebase compilada e o hash real por meio do Android SDK.

```sh
python3 scripts/chat_qa_apk_identity.py \
  --apk /caminho/apk-ja-testado.apk \
  --android-sdk "$ANDROID_HOME" \
  --expected-project PROJETO_DE_QA \
  --expected-firebase-app-id ID_ANDROID_FIREBASE_QA_APROVADO \
  --expected-package PACOTE_DISTINTO_DE_QA \
  --expected-cert SHA256_CERTIFICADO_PUBLICO_QA \
  --expected-sha256 SHA256_DO_APK_DE_QA
```

Usar Python 3, Android Build Tools 35.0.0 e `apkanalyzer`. A ausência de qualquer valor confiável ou recurso compilado **reprova** o preflight. A ferramenta confronta o `google_app_id` do APK com o App ID de QA previamente aprovado e exige que `gcm_defaultSenderId` corresponda ao número do projeto embutido nesse App ID. Não inventar nem derivar o App ID esperado do próprio APK, pois isso inutilizaria a comparação. Os testes offline da ferramenta são `python3 -m unittest scripts.test_chat_qa_apk_identity -v`, usando apenas fixtures sintéticas.

**Limite:** identidade isolada do APK não verifica URLs Cloudflare, roteamento FCM, instalação em celulares nem isolamento de rede em execução. Registrar essas etapas como **NÃO DOCUMENTADAS** até haver evidência específica; não proclamar segurança completa por esta ferramenta.

## Cenários obrigatórios (registrar APROVADO / FALHOU / NÃO DOCUMENTADO)

| Cenário | Execução / resultado esperado | Estado |
|---|---|---|
| 01. Primeira solicitação | A solicita conversa com B; B vê o pedido, mas não há chat aceito automático | NÃO DOCUMENTADO |
| 02. Recusa de contato | B recusa; A não consegue enviar segunda mensagem | NÃO DOCUMENTADO |
| 03. Aceite | B aceita explicitamente; A consegue enviar e B consegue responder | NÃO DOCUMENTADO |
| 04. Envio em tempo real | Mensagem confirmada no servidor aparece nos dois aparelhos, sem duplicação | NÃO DOCUMENTADO |
| 05. Bloqueio | B bloqueia A; A não consegue enviar, inclusive após reiniciar e reconectar | NÃO DOCUMENTADO |
| 06. Desbloqueio | Somente B remove bloqueio; a conversa pode continuar sem perder histórico | NÃO DOCUMENTADO |
| 07. Offline | Desligar a rede, tentar enviar e reconectar; nenhuma mensagem fantasma ou duplicada | NÃO DOCUMENTADO |
| 08. Notificação fora do app | Com app em segundo plano e depois fechado, testar alerta sem expor prévia privada indevida | NÃO DOCUMENTADO |
| 09. Sem permissão de notificar | Negar notificações; mensagens ainda ficam disponíveis ao abrir a conversa | NÃO DOCUMENTADO |
| 10. Conta alternada | Fazer logout e login de outro usuário; nenhuma conversa, badge ou convite da conta anterior aparece | NÃO DOCUMENTADO |
| 11. Grupo fechado | A cria grupo, B aceita convite, envia texto, sai e perde acesso; histórico permanece aos membros autorizados | NÃO DOCUMENTADO |
| 12. Encerrar grupo | Administrador encerra grupo; mensagens anteriores continuam disponíveis apenas aos membros autorizados, novas escritas são negadas | NÃO DOCUMENTADO |
| 13. Denúncia | Denunciar mensagem selecionada; confirmar encaminhamento restrito sem acesso geral da moderação às conversas | NÃO DOCUMENTADO |
| 14. Retenção e exclusão | Confirmar política aprovada e comportamento da exclusão antes de propor ativação pública | NÃO DOCUMENTADO |
| 15. Sem privilégios | Usuário não elegível ou com gate desativado nunca recebe acesso a chats ou grupos | NÃO DOCUMENTADO |

## Dados a registrar por ensaio

- **Data, commit e build:** registrar exatamente o APK homologado; não misturar com a versão Release.
- **Celular A / B:** modelo, versão Android, condições de rede e permissão de notificação.
- **Evidência:** resultado aprovado/reprovado, horário local e referência do log **sanitizado** (sem UID, CPF, e-mail, token ou conteúdo pessoal).
- **Falha:** passos reproduzíveis, comportamento esperado, comportamento observado e vínculo para issue/PR.
- **Repetição:** testar o mesmo cenário com papéis A e B invertidos, sobretudo bloqueio, convite e autenticação.

## Condições de reprovação imediata

- Acesso a chat, grupo, mensagem ou token de outra conta após logout.
- Mensagem enviada após bloqueio ou antes do aceite, pela UI ou por cliente alternativo.
- Abertura de grupos por usuários sem elegibilidade do servidor.
- Push que revela conteúdo privado apesar das preferências de privacidade.
- Mudanças em Firebase oficial, `firestore.rules`, APK Release, chaves, backups ou usuários reais para realizar o teste.
- Falha de sincronização que anuncie envio como confirmado quando o servidor o recusou.

## Portão de publicação

**Não liberar o chat** enquanto qualquer ensaio crítico estiver em NÃO DOCUMENTADO ou FALHOU.
Um CI verde em emulador **não substitui** FCM em aparelho físico, revisão jurídica/LGPD/ECA Digital, autorização administrativa para menores, critérios de denúncia e moderação, e regras de retenção/deleção aprovadas.

**Nenhuma implantação de produção é autorizada por este documento.**
