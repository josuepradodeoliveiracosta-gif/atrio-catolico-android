# Contratos de componentes V1 — proposta para Jetpack Compose

**Status:** especificação, não implementação. [Plano](../PLANO-PRIORIZADO-V1.md). Referências verificadas em `MainActivity.kt`, `NotificationCenter.kt`, `BadgeUi.kt` e `ModerationScreen.kt` na `main` de 04/11/2026.

## Regras comuns e acessibilidade

- Tamanho **recomendado** para área interativa: no mínimo **48 × 48 dp**; aumentar área tocável sem inflar ícones de decoração. Os componentes atuais não estão declarados conformes por esta especificação.
- Texto sempre acompanhando cor/ícone para indicar estado. Referência de contraste a verificar: **4,5:1** texto normal e **3:1** para texto grande e controles/ícones essenciais. Não presumir contraste adequado dos tokens atuais sem medir.
- Navegação por foco e TalkBack: descrever ação + estado; evitar anunciar duas vezes a mesma célula; opções destrutivas explicitamente identificadas. Testar fonte ampliada e largura reduzida.
- Preservar controles Material 3, suporte a teclado e gesto de voltar. Gestos extras nunca são o único caminho.
- Estados previstos (quando aplicáveis): normal, pressionado, desabilitado, carregando, vazio, sem rede/permissão, erro recuperável e sucesso confirmado. Não comunicar sucesso antes da confirmação da ação.
- Não mover responsabilidades: conteúdo/segurança permanecem nos serviços e regras; Compose apenas renderiza e oferece ações permitidas.

## DS-01 — Discussões e respostas · P0

**Base existente:** `DiscussionCard`, `HomeScreen`, `DetailScreen` e `atrio-detail-replies` em `MainActivity.kt`.

| Estado | Comportamento proposto | Critério de aceite |
| --- | --- | --- |
| Normal | Autor, nome, selo, categoria, título, prévia e ações com hierarquia clara | Título não truncado de forma enganosa; autor e discussão com destinos distinguíveis |
| Carregando feed ou respostas | Indicador não bloqueante e mensagem contextual | Sem “vazio” enquanto a carga está pendente |
| Envio de resposta | Botão desabilitado durante requisição; opção de manter rascunho | Toque duplo não cria duas respostas; status anunciado |
| Erro de envio | Mensagem breve + “Tentar novamente”; preservar texto digitado | Sem “enviado” se a gravação falhar |
| Sucesso | Feedback textual após confirmação real | Não prometer push instantâneo apenas por publicar |
| Vazio | Convite “Seja a primeira pessoa a responder!” | Navegação acessível ao campo de resposta |
| Ações destrutivas | Confirmação com verbo e objeto específicos, reversão quando suportada | “Excluir” não ocorre por gesto acidental |

**Não escopo:** mudar listeners, reações, dados, permissões ou o mecanismo de exclusão.

## DS-02 — Central de avisos · P0

**Base existente:** `NotificationCenter` com filtros “Todas”, “Não lidas” e “Administração”; `NoticeGroup`, botão “Marcar como lido” e “Dispensar”.

- Diferenciar **ler aviso**, **dispensar aviso** e **concluir análise administrativa** por rótulos e resultado visível.
- Ao acionar “Marcar como lido”, preservar seleção do filtro e comunicar atualização; para ação lenta, impedir duplicação.
- Estado vazio deve dizer se se trata do filtro aplicado ou de todos os registros; carregamento de páginas adicionais não equivale a resultado exaustivo.
- Erro de conexão não deve virar estado “nenhum aviso”. Se houver conteúdo parcial, identificar que é parcial.
- Sem animação que transforme uma pendência em “concluída” antes da decisão do administrador.

**Aceite:** teste manual de filtro, aviso lido/não lido, erro, conteúdo parcial, TalkBack e fonte ampliada.

## DS-03 — Identidade, perfil e selos · P0

**Base existente:** `MemberBadgeRow` apresenta `AssistChip` com imagem e abre `AlertDialog` explicativo; `ProfileScreen.kt` apresenta perfil.

- Exibir **nome do selo** em texto, além da arte. O detalhe explica origem e significado.
- Selo não modifica a ordem de moderação, papel real, permissão Firestore ou legitimidade de fala.
- O perfil pode mostrar vários selos; linhas com rolagem horizontal devem indicar que há mais itens e serem navegáveis por acessibilidade.
- Falha de leitura de dados **não** deve produzir um selo verificado — preservar o comportamento de falha segura existente.
- Títulos de participação, se aprovados, ficam visualmente separados de funções religiosas/administrativas.

**Aceite:** simular usuário sem selo, fundador, padre, diácono, leigo/leiga e moderador com dados de teste; testar contraste e informação falada.

## DS-04 — Moderação · P0

**Base existente:** `ModerationScreen.kt`, com “Pendentes” / “Analisadas”, revisão humana e confirmação de remoção.

- Preservar explicação de que o Guardião **sinaliza**; não afirmar exclusão automática em ausência de evidência.
- Diálogo de confirmação deve identificar objeto, impacto e ação; botão de cancelamento acessível.
- Estados de envio/erro devem bloquear duplicidade apenas durante operação pendente e permitir recuperação explícita.
- Não ocultar histórico/status de denúncia ao mover a interface para “Analisadas”.
- Uma animação de “escudo” nunca representa eficácia do mecanismo de moderação ou conclusão de exclusão.

**Aceite:** revisão com registros sintéticos e sem escrita em produção; verificar foco, teclado, erro, confirmação e retorno.

## Revisão antes de implementar

Cada componente requer evidências de capturas nos tamanhos de fonte padrão e ampliado, tema aplicável, emulador/dispositivo Android, comportamento sem rede e sem movimento. Anotar Issue, branch, testes, riscos, SHA do merge e status real. Nenhuma alteração Android é feita por este arquivo.
