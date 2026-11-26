# Pré-voo QA Geral: Push e Conversas gerenciadas (#461)

## Separar as duas entregas
- Push piloto existente: relay já implantado, leitura Firestore e FCM. Não ampliar seu IAM para testar entrega. Verificar admissão bilateral, elegibilidade 18+, pendência autorizada, registro do aparelho, permissão Android e janela específica autorizada. FCM aceito não comprova entrega física.
- Conversas gerenciadas: candidato em PR, API fechada. Requer regras coordenadas, escritores privilegiados inventariados, IAM separado/revisado, fronteira, reconstrução por checkpoint e certificado schema 3. Não criar ready:true manualmente. Não abrir a API nem publicar a composição de laboratório.

## Comparação read-only
No Debian, consultar a release cloud.firestore e o ruleset do projeto atrio-catolico-qa-general com OAuth local e x-goog-user-project apontando para o próprio QA. Capturar JSON com projectId, release (nome completo), rulesetName, source (texto original, sem normalização), sha256 (UTF-8). Não guardar token. Guardar o snapshot localmente, não no Git.

`node scripts/qa-conversas-rules-preflight.mjs <snapshot.json>` compara a captura com a composição de laboratório fixada no checkout. Não usa rede, não grava regras nem autoriza deploy. Mesmo hashes idênticos não autorizam ativação. Revisar diff integral e matches sobrepostos, preservar controles de admissão e funcionalidades do QA, testar a composição exata em emulador e conferir a release remota novamente antes de uma eventual alteração autorizada.

## Bloqueios observados na auditoria
- Paginação e fronteira remotas ausentes; os marcadores da nova arquitetura não foram encontrados no texto consultado.
- Conta existente do Push com datastore.viewer e firebasecloudmessaging.admin nas concessões diretas observadas. Não conceder editor/owner nem escrita ampla para homologar o Push.
- D1 existente sem tabela de identidade do candidato; não executar migração nem substituir Worker enquanto não houver autorização e verificação de compatibilidade.
- Testes de moderação Item 13 e interação dos bots ainda exigem investigação.
