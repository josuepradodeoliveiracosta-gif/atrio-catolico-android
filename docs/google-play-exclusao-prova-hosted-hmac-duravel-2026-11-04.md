# Recibos HMAC duráveis de homologação privada — 04/11/2026

## Limitação identificada
A presença de um nonce na tabela de anti-replay indica somente a aceitação da assinatura no serviço interno; a requisição poderia falhar após esse ponto. **Não usar nonces como homologação positiva.**

## Protocolo fortalecido
Adicionada migração `0006_qa_role_hmac_probes.sql` (apenas no D1 fictício) com no máximo três recibos, um por papel, com UUID fixo e UID fixo. Cada recibo surge após um readback de estado bem-sucedido e um `INSERT ... SELECT` atômico que exige:

- Avatar: Alice fictícia congelada, Bob fictício ativo, zero tickets.
- Guardião: Bob fictício ativo, Alice fictícia congelada, zero tickets.
- Push: Alice fictícia congelada, Bob fictício ativo, zero tickets.

O novo `proofRecorded:true` só é devolvido depois do registro durável, e é exigido pelo cliente. A operação não toca em Firebase, Firestore, Auth, Cloudinary, FCM ou contas reais. A gravação de **recibo QA** é diferente de exclusão, envio de notificação, operação de mídia ou autorização de produção. A tabela rejeita papel, UID, nonce, estado e in-flight alterados e não pode registrar duplicatas.

A CI valida separadamente: sucesso dos três papéis; timeout/falha após nonce; isolamento entre contas; ticket vizinho in-flight; replay; impossibilidade de forjar recibos.

## Limites e operação remota
Ainda é necessário aplicar a migração no banco privado segregado, implantar a versão QA de código e obter as três linhas `qa_stage_hmac_role_proofs` na D1 após chamadas por Service Binding. O cron é temporário, fixado ao dia 04/11/2026 UTC e não deve permanecer agendado sem acompanhamento e desativação. **Testes Node locais e CI não certificam tráfego do Worker hospedado.** O motor de exclusão para contas reais permanece desabilitado.
