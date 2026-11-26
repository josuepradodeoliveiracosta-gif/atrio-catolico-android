# Candidato mínimo de recepção Push — QA Geral Celular (#461)

Derivado da captura publicada `2618b59e66914d78c3fc61e5b8812642429696f0064a85afac1c6ff44fef9f2f` (ruleset `8eaa0b3f-5839-46cb-a380-d8a372bf2023`). O reconstrutor reproduz byte a byte a base publicada a partir da base dedicada versionada e quatro diferenças revisadas. Não armazena o arquivo enviado, credenciais ou dados de usuários.

Este candidato é propositalmente **somente leitura individual**: chat aceito Alice/Bob, mensagem canônica por ID, ambos 18+ vigentes, bloqueios bilaterais e rodada correta. Não libera listagem de chats/mensagens, novos escritores, grupos, denúncias novas ou API gerenciada. Mantém as concessões existentes de perfis, comunidade, dispositivos e evidências antigas, inclusive a leitura de denúncias por moderador do ruleset publicado; não amplia essa concessão. O contrato futuro de moderação por caso exige reconciliação explícita antes de habilitar novas denúncias.

O candidato testa a leitura do receptor de Push, não o fluxo integral de envio ou navegação do Android. Antes de uma homologação remota, validar o fluxo de toque e a necessidade de consultas adicionais, revisão da moderação, Auth/IAM, origem do evento canônico de teste e o Worker/D1. Não gerar dados artificiais e apresentá-los como prova de envio pelo aplicativo. Não publicar esta composição como substituição completa das Rules.

Validação: no emulador, executar `node --test qa-push-receiver-rules.test.mjs` com a configuração de teste existente. No Debian, `node firebase/qa-geral-celular/pilot/push-receiver-rules.mjs /sdcard/Download/atrio-qa-rules-snapshot.json` compara o hash e gera apenas diagnóstico. Não há deploy nem autorização de deploy embutida.
