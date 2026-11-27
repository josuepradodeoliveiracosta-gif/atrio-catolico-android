# Candidato APK 50 — participação litúrgica

Base instalada informada: APK 49, fonte 82df9d8f581dd753885cc2bb071799e71cae737d.
Fonte homologada no emulador: PR #478, c59b86f46b21944cf7b83cff22471691a9d3aeb5, 13 workflows aprovados e dois ignorados.
Branch isolada: qa/apk50-participacao-candidato. Não é uma autorização para assinatura nem publicação.

O candidato preserva a árvore do APK 49 e incorpora somente os 21 caminhos da PR #478 e a flag de versão 50. Os sete caminhos modificados existentes na PR foram comparados com o ancestral da PR e eram idênticos na fonte 49 antes da transferência. Não substituir as alterações de chat, notificações, Firebase, Worker ou regras do APK 49. Manter package QA, configuração remota HTTPS e diagnósticos das rodadas anteriores. A flag 50 é exclusiva do fluxo funcional QA, mutuamente exclusiva com as anteriores; a versão de produção permanece intacta.

Bloqueios: compilar e validar candidato combinado com configuração fictícia, hashes das 24 artes (login, cadastro, boas-vindas e participação), metadados, HTTPS e certificado descartável. A rota vigente de assinatura permanente 49 não autoriza 50 e exige main protegida. Não alterar essa barreira. Uma rota 50 separada e revisada no ambiente protegido deve existir antes de qualquer uso de segredos, com SHA e árvore fixados, aprovação expressa do proprietário e entrega cifrada. Nenhum APK assinado foi gerado. Homologação física (TalkBack falado, atualização preservando dados, desempenho relativo ao 49 e retorno) pendente.
