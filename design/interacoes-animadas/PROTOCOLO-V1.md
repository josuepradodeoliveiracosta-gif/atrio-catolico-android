# Protocolo de movimento e feedback V1

**Documento de design, sem código ou dependências novas.** Vinculado à [Issue #104](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/issues/104) e [DS-01 a DS-04](../componentes/ESPECIFICACAO-V1.md).

## Princípio

Animação confirma orientação e mudança visual; **não** substitui feedback textual, estado de rede ou confirmação do servidor. Preferir APIs de animação do Compose/Material 3 já adotadas, sem adicionar bibliotecas pagas ou recursos de produção.

| Caso | Entrada / saída | Alvo inicial a validar em protótipo | Interrupção e alternativa |
| --- | --- | --- | --- |
| Abrir discussão | Toque no cartão → detalhe | Transição discreta de conteúdo **150–220 ms**, sem atraso na navegação | Voltar/interromper deve manter estado correto; com reduzir movimento, troca imediata |
| Enviar resposta | Botão disponível → enviando → sucesso/erro | Feedback local **120–180 ms** após a resposta; indicador de espera dura até resposta real | Falha mantém rascunho; sem animação, mensagem textual + estado do botão |
| Novo aviso | Contagem/badge muda após atualização de dados | Realce sutil **120–180 ms**, **sem pulsar continuamente** | Respeitar preferência de reduzir movimento; nunca alterar leitura automaticamente |
| Abrir selo | Toque em chip → diálogo de detalhes | Entrada padrão Material 3; sem giro/expansão ornamental obrigatória | Fechamento, voltar e leitor de tela funcionam sem movimento |
| Confirmar moderação | Decisão confirmada → feedback | Sem animação celebratória ou “escudo concluído” antes de retorno confirmado | Erro permanece visível, permite correção e não executa ação duplicada |

**Durações acima são hipóteses de prototipação, não valores presentes no APK.** Easing sugerido: desaceleração suave para entrada e saída discreta, respeitando componentes oficiais e cancelamento.

## Política de reduzir movimento

- Observar as configurações de animação/redução de movimento disponíveis na versão Android testada; não assumir uma API universal sem comprovação técnica.
- Oferecer caminho sem deslocamento/escala; atualizar **imediatamente** texto e semântica nos mesmos eventos.
- Evitar parallax, flashes, animação infinita, tremores e reforço visual exagerado em selos religiosos ou operações destrutivas.
- Respeitar estado de composição: a transição cancelada jamais dispara chamada à rede, exclusão ou gravação.

## Desempenho e segurança de interação

- Priorizar mudanças simples de opacidade/transformação já suportadas pelo Compose, sem criar observadores Firebase adicionais para animar.
- Medir jank/frame time no dispositivo de teste; alvo exploratório de fluidez na tela, **não** declarar 60 fps garantidos.
- O estado assíncrono vem do fluxo real da ação; nunca usar relógio de animação como prova de sucesso.
- Toques repetidos durante operação devem ser tratados no fluxo de domínio quando necessário; desabilitar botão visual **não substitui** proteção contra duplicidade.
- Não adicionar efeitos em PR de documentação; implementação futura isolada com testes instrumentados de estado e acessibilidade.

## Checklist de validação

- [ ] Movimento desligado e reduzido, com resultado legível.
- [ ] Interrupção durante navegar/voltar, rotação e reentrada.
- [ ] Rede lenta, falha e sucesso reais em ambiente de QA.
- [ ] Toque duplo não resulta em duas ações.
- [ ] Leitor de tela e tamanho grande de fonte.
- [ ] Efeito não bloqueia botão, não consome foco e não aumenta leituras pagas.
