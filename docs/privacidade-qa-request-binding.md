# Átrio Católico — vinculação imutável da solicitação à exclusão QA

**Estado:** somente Firestore Emulator `demo-atrio-v11` + SQLite
descartável; nenhuma exclusão de usuário real ou alteração Firebase.

## Falha evitada

O executor já verificava `status=requested` antes de continuar, mas
uma pessoa ou serviço poderia substituir uma solicitação durante uma
execução interrompida. Verificar apenas o UID e o status permitiria
retomar etapas com a autorização ligada à solicitação antiga.

## Implementação

O módulo `tests/security/qa-deletion-request-binding.mjs` mantém na
mesma base SQLite de checkpoints o UID fictício, a origem
(`android` ou `web`) e a marca temporal ISO normalizada da
**primeira solicitação**. Na retomada, exige correspondência exata.
Também exige o documento válido antes e depois dos efeitos das
etapas do emulador e impede retomar um journal antigo que contenha
etapas gravadas sem registro da solicitação.

Os testes confirmam que mudar horário ou origem após duas fases
interrompe o processo, mantém as etapas seguintes intactas e preserva
a identidade Auth fictícia e os dados de outra conta. Rejeitam
solicitações sem timestamp, com origem inválida e checkpoint sem
vínculo de solicitação.

## Limites obrigatórios

- O par origem + instante **não** é um identificador global
  imutável. Um serviço real requer um `requestId` atribuído pelo
  servidor, identificação administrativa autenticada, comparação
  atômica de geração/fencing e retenção vinculada a esse identificador.
- Uma revalidação local **não torna atômicas** gravações em Firestore,
  D1, Cloudinary e Firebase Auth, nem impede um efeito remoto que já
  tenha sido enviado. Produção deve impor bloqueios em cada provedor.
- Não há executor real, API administrativa ativa, IAM de exclusão nem
  portal de pedidos ativado. O gate da Google Play permanece bloqueado.

A PR #98 permanece draft. Não executar `firebase deploy`, importar
módulos QA para Workers ou alterar o backup protegido.
