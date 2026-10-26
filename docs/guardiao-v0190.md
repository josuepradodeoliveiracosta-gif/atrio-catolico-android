# Átrio Guardião — triagem gratuita da versão 0.19

## O que está implementado

Após criar uma discussão ou resposta, o app envia somente seus identificadores
para `POST /moderation/event`. O Worker autentica o autor, relê o conteúdo no
Firestore e aceita apenas eventos criados nos últimos cinco minutos. Para
respostas, também confere se a discussão principal ainda existe.

Regras locais de texto sinalizam possíveis ameaças explícitas, pedidos de senha
ou código, sequências com formato de CPF, excesso de links e repetição de texto.
Não usa serviço pago nem modelo de IA. Uma correspondência é apenas um indício:
citações, relatos e números podem causar falsos positivos. Não verifica doutrina
nem determina culpa. Ausência de alerta também não significa conteúdo seguro.

Suspeitas criam um documento privado em `reports`, com `source=guardiao`,
`ruleCode`, motivo genérico e status `pending`. O conteúdo suspeito não é copiado
para a denúncia nem para o push. Um ID determinístico por alvo impede duplicar
a denúncia e sobrescrever decisões já registradas.

No painel de Moderação, os itens aparecem como **Átrio Guardião**. Ao abrir,
o administrador recebe o lembrete de conferir o contexto, pode encerrar sem
remover ou confirmar a remoção pelo fluxo humano existente. O bot não exclui
publicações ou respostas, não bane contas e não precisa de uma conta de usuário
com senha ou privilégios de administrador no aplicativo.

## Chaves de operação independentes

- `GUARDIAO_ENABLED=true`: permite a triagem; qualquer outro valor a desliga.
- `PUSH_ENABLED=true`: permite avisar administradores após criar a denúncia.
  Desligar o push preserva a triagem e a fila, mas não consulta os aparelhos nem
  envia FCM nessa etapa.
- Falha de push não desfaz denúncia criada. Uma denúncia já existente não gera
  outro aviso. Falha ao gravar a fila devolve erro, sem anunciar encaminhamento.

O custo depende das cotas gratuitas existentes de Workers, Firestore e D1.
Não há nova assinatura paga. Não há varredura histórica nem garantia de cobertura:
clientes antigos ou modificados podem não chamar o endpoint; a chamada depende
de conexão, não possui fila durável de repetição e não ocorre após edições.
Uma nova edição do mesmo alvo também não reabre automaticamente denúncia analisada.
As denúncias manuais continuam necessárias.

## Homologação antes de ativar

Esta revisão altera código na PR #15; não publica nem ativa o Guardião no Worker.
Preservar os bindings e o funcionamento de push e comunicados já existentes.

1. Conferir os testes do Worker, Android, Firestore e versão no commit da PR.
2. Em ambiente de testes, manter `GUARDIAO_ENABLED=false` e confirmar recusa sem
   gravações. Depois habilitar apenas para homologação controlada.
3. Usar contas e conteúdo de teste: uma discussão com quatro links de exemplo
   deve produzir um único item na fila; repetir o evento não duplica o item.
4. Conferir a identificação do Guardião no painel e encerrar sem remover.
   Em teste separado, revisar a remoção de uma resposta preservando a discussão.
5. Conferir conteúdo comum sem alerta, conta sem autorização, conta desativada,
   resposta órfã, erro de gravação e push desligado.
6. Registrar resultados e revisar permissões da conta de serviço antes de
   ativar no ambiente real. A conta de serviço é privilegiada e ignora as
   regras do cliente; credenciais permanecem apenas nos Secrets do Worker.

Os testes automatizados simulam provedores e não comprovam operação no celular.
A configuração de produção não foi alterada nesta retomada.
