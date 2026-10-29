# Átrio Guardião — triagem gratuita da versão 0.19

## O que está implementado

Após criar uma discussão ou resposta, o app envia somente seus identificadores
para `POST /moderation/event`. O Worker autentica o autor, relê o conteúdo no
Firestore e aceita apenas eventos criados nos últimos cinco minutos. Para
respostas, também confere se a discussão principal ainda existe.

Regras locais de texto sinalizam possíveis ameaças explícitas, pedidos de senha
ou código, sequências com formato de CPF, excesso de links e repetição de texto.
A triagem inicial não usa IA; a etapa 2 opcional está descrita abaixo.
Uma correspondência é apenas um indício:
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

## Etapa 2 — análise contextual opcional

A denúncia básica é criada primeiro. Somente conteúdo já sinalizado pelas regras
é enviado à IA, com no máximo 2.000 caracteres do título/corpo analisado, sem
UIDs, perfis, histórico de conta ou credenciais anexados. O texto pode conter
informações pessoais digitadas pelo autor; ativar esta função implica processar
esse trecho no Cloudflare Workers AI. Não são registrados prompts nem respostas
livres do modelo no D1, na denúncia ou nos logs do aplicativo.

Modelo fixo: `@cf/meta/llama-3.1-8b-instruct-fp8`, binding `AI`, sem AI Gateway,
sem ferramentas e sem provedor pago alternativo. `GUARDIAO_AI_ENABLED=false`
é o padrão. A opção precisa ser `true`, junto à triagem habilitada, para inferir.

A resposta deve conter somente `assessment` com um destes valores:

- `concern`: possível risco; revisão humana continua necessária.
- `contextual`: possível citação, relato ou prevenção; não encerra a denúncia.
- `uncertain`: contexto insuficiente.

Saída inválida, falha, orçamento esgotado ou timeout mantêm o alerta original.
A IA não determina culpa, apaga conteúdo, bane, concede permissões nem executa
comandos presentes nas mensagens. A separação entre instrução e conteúdo reduz
riscos de manipulação, mas não garante resistência a toda tentativa de indução;
a barreira efetiva é não conceder à saída autoridade para decidir ações.

O parecer aparece somente aos administradores no detalhe da denúncia. Uma
atualização com máscara restrita a `aiAssessment` e precondição `updateTime`
impede sobrescrever uma decisão humana tomada durante a inferência. Conflito
ou falha de atualização conserva a denúncia sem parecer, sem nova tentativa.

### Limites e custo

- Dez reservas por dia UTC, no total deste Worker/D1; não dez por pessoa.
- Reserva atômica e exclusiva por denúncia; falhas consomem a reserva.
- Máximo de 64 tokens de saída e três segundos de espera pela IA.
- Um timeout não garante cancelamento no provedor: a reserva permanece consumida.
- Reservas com mais de sete dias são limpas em blocos de até 100.
- A tabela `guardiao_ai_budget` guarda somente ID derivado da denúncia e dia.
- Se a tabela/binding não existir ou D1 falhar, não chama a IA.

Workers AI oferece franquia gratuita compartilhada por conta; ela não é exclusiva
do Átrio. Manter Workers Free e monitorar o consumo: o limite interno é uma
proteção adicional, não garantia universal de custo se o plano da conta mudar.
Não há troca automática de modelo, plano ou serviço quando a cota acaba.

### Preparação e homologação da etapa 2

1. Aplicar a adição idempotente de `guardiao_ai_budget` do schema.sql no ambiente
   de testes e adicionar o binding Workers AI chamado `AI`.
2. Preservar secrets e switches existentes. Os TOMLs versionados são padrões
   desligados, não uma fotografia do ambiente ativo: não aplicá-los cegamente
   sobre a produção, pois podem desligar push/comunicados.
3. Confirmar Workers Free e disponibilidade do modelo, depois habilitar a IA
   somente no ambiente de homologação. Esta implementação não fez deployment,
   migração D1 remota nem inferência real.
4. Avaliar exemplos próprios de ameaça direta, citação de ameaça, relato de
   vítima, prevenção de golpe e discordância religiosa. Registrar falsos positivos
   e negativos, latência e consumo, sem expor textos pessoais em logs.
5. Testar quota, duplicidade, falha de IA e decisão humana durante a inferência.
6. Somente após validação contextual real considerar ativação de produção.

O contexto analisado é o próprio título/corpo, não toda a conversa. Permanecem
os limites da primeira etapa: clientes podem não chamar o endpoint, edições não
disparam reanálise e os testes simulados não medem a qualidade do modelo.

Referências consultadas em 26/10/2026:
- https://developers.cloudflare.com/workers-ai/models/llama-3.1-8b-instruct-fp8/
- https://developers.cloudflare.com/workers-ai/features/json-mode/
- https://developers.cloudflare.com/workers-ai/platform/pricing/
