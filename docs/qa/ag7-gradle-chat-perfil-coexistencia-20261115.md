# Agente 7 — Ensaio de coexistência Gradle Chat QA / Perfil QA

Referência: Issue #105; base exata PR #300 `134e86d904261d2aafd0d1cedf9ea2c6944ba180`.
Agente 7; branch `integration/ag7-chat-perfilqa-gradle-compat-20261115`; candidato **offline, não integrado à main**.

## Entrega limitada
- Em `app/build.gradle.kts`, adiciona o buildType `chatQa` da PR #193 ao buildType `perfilQa` já presente na cadeia #291→#294→#296→#297→#298→#299→#300.
- Preserva a ativação opt-in, os dois sufixos `.chatqa` e `.perfilqa`, cada configuração Firebase exclusiva, teste de hash, seleção de tarefa e restrição a credenciais/assinaturas. A mistura de flags Chat/Perfil é rejeitada.
- Copia os verificadores offline de Chat QA e o Manifest variante a partir da PR #193; explicita backup desabilitado na variante.
- Acrescenta contrato estático e executa as suites sintéticas Chat/Perfil na CI existente. Não habilita uso de Cloudflare ou Firebase remoto.

## LIMITAÇÃO IMPORTANTE
Este é **apenas o ensaio de coexistência das variantes Gradle**, NÃO a integração funcional integral da PR #193. `OnlineAtrioApp.kt`, `RegistrationV2.kt`, Workers, Security Rules de Conversas e demais arquivos de #193 permanecem exclusivamente na branch da #193. Uma eventual compilação de `chatQa` aqui **não comprova** que o fluxo de chats de #193 foi incorporado. A conciliação funcional exige revisar as mudanças Android e testes da #193 em outra etapa, sem sobrescrever alterações alheias.

Nenhuma configuração Firebase real foi incluída. Os builds de variante efetivos `assembleChatQa` e `assemblePerfilQa`, identidade dos APKs e QA físico requerem configurações autorizadas e nova verificação pelo Agente 5. CI padrão compila `assembleDebug`, não os dois APKs isolados.

## Revisão necessária
1. Agente 5: confirmar tests Python, checks obrigatórios e build Debug **no SHA desta branch**, sem afirmar APK QA real.
2. Agente 4: revisar gates de isolamento de QA e ausência de regressões de assinatura/OTA.
3. Agente 3: corrigir em sua própria branch o botão Salvar sem alterações em `PerfilQaPilot.kt`, sem relaxar Rules.
4. Agente 7: conciliar código de `OnlineAtrioApp.kt`/navegação/CI da PR #193 após obter evidências, antes de propor integração.
5. Fundador: toda autorização de merge, Firebase/Cloudflare remoto, provisionamento ou instalação continua pendente.

**Proibido merge, deploy, produção, backups, chaves, contas, dados reais ou release.**
