# Átrio Católico — contrato HTTP de mídia no executor integrado (QA)

**Data:** 03/11/2026. **Escopo:** somente contas descartáveis em Firebase Emulator; sem Cloudinary real ou deploy em produção.

## Resultado desta etapa

O executor de sete fases já foi comprovado usando Firebase Admin SDK sobre Auth/Firestore Emulator e um registro de checkpoints SQLite persistente. Seu adaptador de mídia era apenas um `Set` em memória; esta revisão substitui a parte de mídia por **uma chamada HTTP real, restrita a `127.0.0.1`**, com servidor fictício de Cloudinary e verificação independente. O adaptador pode ser testado sem abrir conta adicional nem instalar SDK Cloudinary.

Arquivos:
- `tests/security/admin-fixture/qa-controlled-cloudinary-loopback.mjs`: novo cliente de QA com origem HTTP em loopback, projeto `demo-atrio-v11`, conta `qa-delete-candidate`, conta testemunha `qa-delete-neighbor` e identificadores sintéticos exatos.
- `tests/security/admin-fixture/qa-controlled-executor-e2e.test.mjs`: integra o cliente HTTP ao **executor completo**. O servidor local permite somente consultas de inventário e um `destroy` de avatar fictício; requests inesperadas devolvem 403/404.

## Proteções

- Rejeita HTTPS, endereços remotos, redirecionamentos, URL com credenciais, porta de emulador Firebase, credenciais Google/Cloudinary em variáveis de ambiente, UID não permitido, outro public_id, parâmetros extras e payload de resposta ambíguo.
- Lista separadamente os três tipos de entrega `upload`, `authenticated`, `private` em lotes com paginação **limitada**, valida caminhos, UIDs e UUIDs, evita duplicatas e loops de cursor, e bloqueia inventários incompletos.
- Antes da remoção confirma a presença da mídia esperada e preserva a mídia da conta testemunha; após a remoção realiza **duas leituras completas** dos tipos para verificar zero ativos no titular e o asset testemunha ainda presente. A etapa posterior de D1 só remove o ponteiro quando as leituras HTTP comprovam ausência.
- O teste mantém a simulação de timeout **após** Auth Emulator apagar o usuário: o journal persistente exige revisão independente e reinício em novo epoch, sem repetir o Auth delete nem o destroy HTTP.
- FCM permanece um stub sintético. **Este código NÃO executa o Admin API da Cloudinary, não verifica CDN, derivados ou backups e NÃO revoga tokens FCM remotos.** A homologação externa depende de outro projeto/conta de QA com IAM restrito e credenciais de teste.

## Comprovação

A rotina roda no **workflow Firestore/Emulators existente**, dentro do mesmo cenário de `qa-controlled-executor-e2e.test.mjs`, sem ampliar a lista de workflows nem solicitar compilação Android adicional. A aprovação é de *contrato de transporte e execução local*, não de recursos Cloudinary remotos.

**Status Play:** PR #71 em rascunho, `releaseAuthorized:false`, 0/9 privacidade, 0/6 UGC. Não atualizar esses flags sem prova operacional distinta.

**Próximo requisito real:** credenciais de Firebase QA hospedado independente e Cloudinary QA independente, revisão de IAM, retenção LGPD e bloqueio distribuído de todos os Workers produtivos. Nenhum dado de usuário real será utilizado.
