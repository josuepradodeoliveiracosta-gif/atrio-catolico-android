# Átrio Católico — motor de exclusão de mídia em três contas fictícias (QA)

**Revisão de QA · Sem implantação nem contas reais · PR #71**

## Motivação

Foi solicitado usar três fotografias pessoais diferentes em três contas fictícias para testar exclusão. As imagens foram disponibilizadas nesta conversa e já estão em um pacote **local e privado**. **Nenhuma fotografia, captura, miniatura, nome de pessoa, metadado pessoal ou hash real dos arquivos é inserido no repositório público.**

O repositório contém **somente dados sintéticos** com a mesma estrutura de proprietário, identificador do ativo e digest SHA-256. Esse código não faz o upload das fotos e não afirma que foram cadastradas no Firebase ou Cloudinary remotos.

## Contas de teste

| UID fictício | Associação local, fora do GitHub |
|---|---|
| qa-delete-candidate | Primeira fotografia |
| qa-delete-neighbor | Segunda imagem |
| qa-delete-observer | Terceira imagem |

A tabela só especifica a associação pretendida na fixture privada. **Os identificadores e digests incluídos nos testes automatizados são inventados**, nunca derivados das fotografias. O pacote privado de testes é a fonte dos dados fotográficos originais.

## Motor de mídia

Novo arquivo: \`cloudflare/account-deletion-processor/src/qa-three-account-media-engine.js\`.

- Aceita exclusivamente \`demo-atrio-v11\` e as três UIDs artificiais acima.
- Recebe manifesto explícito com **uma imagem esperada por conta**: \`assetId\`, \`publicId\`, \`sha256\`, \`type\`. O ID público precisa pertencer ao prefixo \`atrio-privacy-qa-20261103/{uid}/\`, terminando em UUID v4.
- Exige que todos os três registros estejam presentes e que nenhum ID de ativo seja compartilhado entre contas.
- Não tem HTTP, SDK Cloudinary, Firebase, credenciais, upload, exclusão de arquivos locais, D1 remoto ou conexão de rede.
- O armazenamento é **injetado pelo teste** e oferece \`list({uid})\` e \`deleteConditional({uid,assetId,publicId,sha256,caseId,epoch})\`. O segundo método **precisa implementar a comparação atômica de proprietário+revisão no backend real**; o invólucro JS não garante por si só esse controle.
- Antes de alterar a foto selecionada, exige confirmação atual de autorização, congelamento de escritas e lease válido, mais um inventário completo que reconheça **exatamente o ativo da conta escolhida** e confirme que as outras duas permanecem com a foto original.
- O método \`purge\` faz uma única exclusão condicional, verifica o resultado estritamente e efetua duas leituras de confirmação da ausência da foto selecionada e preservação das duas outras. O método \`empty\` retorna \`true\` quando ausente, \`false\` quando presente e falha quando há resposta desconhecida, inventário incompleto, troca de proprietário ou mudança inconsistente durante as leituras.
- Se a resposta se perder após o armazenamento já ter excluído a foto, o motor não interpreta o timeout como sucesso: a execução para e depende do journal durável e da reconciliação do executor. Um segundo processamento de mídia só é permitido depois da revisão de recuperação aplicável.
- **Sem garantia de rollback** caso um provedor defeituoso toque uma conta de controle; o módulo detecta a violação e falha fechado, mas o provedor real deverá ter restrição de IAM e ownership CAS independente.

## Provas automatizadas

\`qa-three-account-media-engine.test.mjs\` cobre:

1. Exclusão isolada da conta candidata, vizinha e observadora, uma de cada vez, com duas contas preservadas.
2. Recusa de inventário incompleto, ativo pertencente a outra conta, manifesto inconsistente, UID real, projeto real e credenciais ausentes.
3. Recusa de revogação de autorização, freeze não verificado, lease inválido ou foto de controle ausente.
4. Timeout injetado **após** a remoção condicional, readback confirmando o resultado e nenhuma segunda mutação.
5. Detecção de perda de um ativo de controle após mutação, sem declarar sucesso.
6. Integração da mídia fictícia com o **executor real de sete fases** e o journal SQLite privado para cada uma das três UIDs: Auth vem por último e nenhuma foto de controle é alterada.
7. Recuperação do executor após timeout de mídia: o journal bloqueia nova tentativa sem revisão, mantém Auth, recebe aprovação fictícia, reabre SQLite e conclui sem segunda exclusão do ativo.

Os scripts ainda usam um armazenamento sintético em memória. **Esses testes não comprovam armazenamento remoto de fotografias**, retenção e eliminação de cópias de segurança, derivados de mídia, CDN, autorização jurídica, Cloudinary IAM, Firebase hospedado ou comportamento dos 15 caminhos de escrita em produção.

## Bloqueios preservados

Não alterar produção, chave de API, backup, dados reais, contas vinculadas, Workers Avatar/Guardião/Push ou \`releaseAuthorized:false\`. PR #71 permanece rascunho. A execução real só poderá ocorrer após demonstrar isolamento e permissões de um ambiente hospedado de QA com imagens explicitamente descartáveis.

**Referência:** os arquivos privados anteriormente preparados são \`atrio_tres_contas_qa_fotos_privadas.zip\`, disponíveis como anexo na conversa, **não no GitHub público**.
