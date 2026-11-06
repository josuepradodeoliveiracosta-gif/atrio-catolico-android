# Átrio Católico — implementação do guia visual v2.0

Documento de origem: **Átrio novo design gráfico.pdf**, oito páginas, guia
consolidado de 05/11/2026. A **especificação escrita prevalece** sobre as
ilustrações e textos fictícios. Este registro descreve somente a branch
`design/atrio-v2-compose-20261106`, não um APK já publicado.

Protótipo editável complementar no Figma: [Átrio Católico — Design v2](https://www.figma.com/design/NFAFLpop668Ms2od7l0Wzg). Inclui Início, Fóruns, Perfil e storyboard das quatro interações. As telas e transições são conceituais; aprovação técnica depende do APK Android.

## Proteção da versão oficial

- Base: `main` em `41d6a219a458bdd5ba43d0d5be7f304368a4a7bd`,
  Release v0.20.4, `versionCode=39`.
- Não alterar `applicationId`, versão oficial, certificado permanente,
  backup, Firebase/Cloudflare de produção, regras ou modo de moderação.
- Sem merge, workflow de publicação ou mudança de OTA antes de homologar
  e obter aprovação do proprietário.

## Fundamentos

- Cores: vinho `#641F32`, dourado `#B49352`, marfim `#F7F3EA`,
  carvão `#29262A`; apoio escurecido para legibilidade.
- Tipografia: serifa apenas onde reforça a identidade; textos e ações com
  leitura clara; alvos de toque nativos de 48 dp.
- Cinco destinos oficiais: Início, Fóruns, Publicar, Salvos e Perfil.
- Categoria canônica: **Vida espiritual**, não criar “Vida Cristã”.
- Não alterar artes oficiais, papéis ou permissões dos selos.

## Telas e componentes nesta branch

1. **Início:** banner existente, cartões com feedback de salvamento,
   distinção entre carregando, feed vazio, busca vazia e erro, botão de
   recuperação; posição da lista e filtro mantidos na navegação conectada.
2. **Fóruns:** grade adaptável e ícones vetoriais dourados acompanhados de
   rótulos, pressionar com escala 1→0,98, sem retardar abertura do feed.
3. **Perfil:** cabeçalho mais compacto, CTA de edição discreto e
   preferências agrupadas; preservar apresentação pública, selos,
   notificações, conta/privacidade e atualização OTA no scroll.
4. **Publicar:** título, texto e categoria com `rememberSaveable`, botão
   com estado `Publicando…` e tentativa identificada por ID estável.
   Antes de repetir, consulta remota por ID; nenhuma confirmação de
   sucesso antes da resposta real.
5. **Salvos:** fila serial por publicação; operações repetidas respeitam a
   última intenção, erro restaura o estado confirmado, ícone distingue
   pendente de “Salvo”, com animação de 180 ms após confirmação.
6. **Navegação:** preservar filtro, busca e rolagem da tela Início quando
   se volta de outra aba; ao publicar, limpar filtro/busca explicitamente
   para tornar a nova publicação visível.

## Interações / tempos-alvo

| Evento | Alvo visual | Regra fundamental |
|---|---:|---|
| Troca de aba | 220 ms | Último destino válido; sem espera fictícia |
| Salvar | 180 ms | Confirmação somente após gravação; reversão em falha |
| Abrir fórum | 240 ms | Reduz escala, não oculta carregamento real |
| Publicar | 180–220 ms | Estado depende da resposta do Firestore |

Movimento reduzido: verificar `Settings.Global.ANIMATOR_DURATION_SCALE`;
se desativado, pular transições. A preferência poderá exigir validação
com dispositivo/versões Android específicas. Não usar GIF/vídeo em
controles ou animações contínuas sobre imagens devocionais.

## Matriz de aceite (não marcar PASS sem evidência)

- [ ] P0 — Gradle `:app:assembleDebug` passa e testes unitários passam.
- [ ] P0 — Salvar/remover com respostas tardias, erro e toques rápidos.
- [ ] P0 — Publicar com timeout ou retorno perdido sem criar duplicata.
- [ ] P0 — Nenhum campo descartado após erro; pesquisa/vazio/offline distintos.
- [ ] P0 — Fonte 1,5x–2x, largura estreita, TalkBack e movimento reduzido.
- [ ] P1 — Alternar fórum A/B e voltar preservando busca/filtro/rolagem.
- [ ] P1 — Regressão de login, selos, Guardião, notificações e Perfil/OTA.
- [ ] P2 — Medição visual de fluidez em Android físico.
- [ ] Release — Publicar novo APK com código crescente SOMENTE após
  aprovação e homologação completa.

## Limites e riscos

- O incremento visual de estado salvo pode refletir uma escrita local
  pendente do Firestore. A legenda **Salvando…** distingue isso do
  sucesso confirmado. Testar reversões e reconexões reais.
- Para envio idempotente, o ID da tentativa é mantido pelo estado salvo
  do Android. Uma instalação limpa pode perder esse ID; eventual
  proteção global contra duplicidade exigirá desenho transacional
  em servidor e revisão das regras, fora desta branch.
- O protótipo Figma é auxiliar, não comprovante de desempenho nem de
  persistência. O trabalho aqui prioriza componentes Compose.
- Este plano não altera Firestore Rules, backend, Play Console nem
  habilita Guardião V2 autônomo.
