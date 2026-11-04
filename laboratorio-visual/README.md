# Laboratório Visual — Átrio Católico

Espaço **exclusivo para criação, documentação e experimentação** de efeitos visuais e interações do aplicativo Android Átrio Católico.

## Objetivo

Desenvolver e avaliar ideias visuais **sem modificar o funcionamento do app, a produção, o Firebase ou os fluxos de publicação**. Tudo aqui permanece como proposta até passar por análise e aprovação específica.

## Áreas de trabalho

- **Animações:** abertura, transições entre telas, ícones, selos e títulos animados.
- **Efeitos visuais:** brilho, partículas, shimmer, sobreposições e microanimações.
- **Interações:** respostas a toques, feedback de botões, menus, gestos e estados da interface.
- **Protótipos:** demonstrações isoladas de UI, propostas e comparação de alternativas.
- **Referências:** especificações, assets autorizados e diretrizes de identidade visual.

As subpastas serão abertas conforme os primeiros protótipos forem adicionados, evitando arquivos vazios e trabalhos desnecessários.

## Compatibilidade técnica

- Aplicativo atual: Kotlin + Jetpack Compose.
- Ferramentas candidatas: animações nativas de Compose, Lottie, Rive e Konfetti, sempre após verificar licença e compatibilidade.
- Priorizar desempenho em celulares Android, acessibilidade, economia de bateria e adaptação a diversos tamanhos de tela.
- A inclusão de uma biblioteca neste documento **não a instala** no aplicativo.

## Regras de isolamento

1. Não alterar arquivos do módulo `app/`, configurações Gradle, workflows, segredos ou infraestrutura.
2. Não integrar protótipos à branch `main` sem aprovação explícita e testes.
3. Não adicionar imagens, vídeos, fontes ou outros ativos de terceiros sem autorização de uso.
4. Manter experimentos reversíveis, documentados e separados da interface atual.
5. Não executar builds ou workflows automaticamente só para criar material visual.

## Estado inicial

✅ Área de trabalho criada e documentada.  
⏳ Nenhum efeito ou interação novo foi implementado ou integrado ao aplicativo.

**Branch de experimentação:** `design/laboratorio-visual-20261104`.
