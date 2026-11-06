# Tipografia acessível do Átrio Católico — versão 1

Auditoria iniciada sobre a `main` em `33e6e76aa034df8eb79f25f785c8197dc826510a`.

## Escala visual reutilizável

O arquivo `AtrioTypography.kt` fornece uma escala em `sp` e os estilos
baseados no Material 3. A escala respeita automaticamente as opções de fonte do
Android; não deve ser multiplicada manualmente pelo `fontScale`.

| Função | Escala |
|---|---:|
| Títulos principais e marca | Preservados |
| Leitura longa (publicações, respostas, biografias) | 16 sp / 24 sp |
| Nomes em cartões / comentários | 15 sp |
| Orientações, avisos e textos auxiliares | 14 sp / 21 sp |
| Selos, categorias e navegação inferior | 13 sp / 19 sp |
| Datas e contadores estritamente secundários | 12 sp / 17 sp |

O tema global altera apenas estilos `body*` e `label*` do Material 3;
títulos continuam com seus pesos/tamanhos originais. Foram alterados textos
excessivamente pequenos das áreas de Início, Discussão V2, Perfil, Selos,
Avisos, Moderação, Notificações e configurações. O texto dourado sobre fundo
claro da última etapa do cadastro passou a vinho, por legibilidade. A área de
cabeçalho deixa de impor altura exata para fontes ampliadas.

## Segurança e regressões

Não alterar banco de dados, regras, Auth, notificações, campos de formulários,
assinatura de release, `applicationId`, backup protegido ou a identidade visual
vinho/dourado. A seleção de tipografia não modifica permissões do Fundador.

Executar testes de compilação, regras, unitários e UI por emulador. Conferir
com fontes 100%, 130%, 160% e 200%, pelo menos uma tela estreita, campos com
teclado aberto, botões de navegação, mensagens longas, nomes/selos e contrastes.
O teste automático de Compose exercita o compositor a 200%, mas NÃO substitui
vistoria visual e homologação no dispositivo real.

## Limites conhecidos

1. Logotipo `CATÓLICO` pequeno e dourado é elemento de marca, não texto
   de instrução. Não foi removido nem transformado.
2. O dourado original ainda é usado em ícones, linhas e detalhes decorativos,
   não em informação pequena sobre fundo claro.
3. O app não ativa novos recursos de acessibilidade do sistema por conta
   própria; o usuário mantém o controle do tamanho da fonte do Android.
