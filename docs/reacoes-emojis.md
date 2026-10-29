# Reações com emojis — proposta em branch de desenvolvimento

Base auditada: `77af845a2cf1766c30178977de81bff557c87853` (main, Debug 0.19.3).
APK desta proposta: **Debug 0.19.4**, versionCode 31. Release permanece 0.19.0/code 27 e não é compilado ou publicado por esta tarefa.

## Implementação

- Botão Reagir e toque longo no corpo de uma resposta abrem menu flutuante Material 3, arredondado e animado.
- Atalhos: 👍 ❤️ 😂 😮 😢 🙏 e botão + fixo. Em telas muito estreitas, os atalhos rolam horizontalmente sem esconder o +.
- Painel com nove categorias, pesquisa em português/inglês, pesquisa pelo próprio emoji e recentes privados por conta neste aparelho.
- Catálogo local de **3.944 sequências plenamente qualificadas do Unicode 17.0**, incluindo tons, famílias, profissões, bandeiras e sequências ZWJ. As variações ficam no toque longo e também na pesquisa.
- Os glifos são os do Android. `Paint.hasGlyph` filtra o seletor segundo o suporte real do aparelho; não há imagens substitutas nem download de fontes. Sistemas antigos mostram menos opções. Um emoji recebido de um Android mais novo pode não ser desenhado corretamente pelo sistema antigo, mas sua sequência e contagem são preservadas.
- Grade preguiçosa: somente células visíveis são compostas. Catálogo e teste de glifos carregam uma vez, fora da thread principal.
- Reagir novamente com o mesmo emoji remove; outro emoji substitui. Uma transação lê a seleção atual do servidor antes de decidir, inclusive quando a mesma conta usa dois aparelhos.
- Chips abaixo da resposta agrupam emojis iguais, contam pessoas e destacam a escolha do usuário.
- Um listener por resposta visível fornece contagens em tempo real. Listeners saem ao rolar para fora da tela ou navegar. Não há consulta separada por emoji nem corte arbitrário que produza contagem falsa. O volume inicial de leituras ainda é proporcional ao número de reações daquela resposta; agregação confiável no servidor seria uma evolução independente.
- Contagens do cache são identificadas como aguardando sincronização. Transações exigem conexão; falhas não são apresentadas como sucesso.

## Compatibilidade e segurança

Mantido o caminho `posts/{postId}/replies/{replyId}/reactions/{uid}`, com os campos `kind` e `createdAt`.

| Emoji | Valor salvo |
| --- | --- |
| ❤️ | `heart`, compatível com a versão anterior |
| 🙏 | `prayer`, compatível com a versão anterior |
| ✨ | `light`, compatível com a versão anterior |
| Demais | Sequência Unicode completa em `kind` |

A leitura agrupa também valores Unicode equivalentes aos três tipos legados. Nenhuma migração, coleção paralela ou contador editável pelo cliente foi criado. Aplicativos antigos continuam gravando os três tipos originais; não sabem exibir os novos emojis.

As regras propostas aceitam somente um emoji do catálogo ou um tipo legado, preservam a autoria pelo UID do documento e a data de criação e rejeitam texto comum, vários emojis concatenados, sequências incompletas, campos extras e gravações em nome de outra conta. Atualizações também exigem uma resposta ainda existente. Remover a própria reação continua permitido para limpar um documento órfão.

O catálogo exato é convertido em expressões RE2 em blocos, abaixo dos limites de tamanho e agrupamentos do Firestore. `tools/emoji/generate.py` gera o catálogo e o bloco marcado nas regras a partir dos mesmos dados. `tools/emoji/provenance.json` registra URLs, versões e hashes; a licença Unicode está nos assets.

**Dependência de aprovação:** nenhuma regra foi publicada. Os novos emojis só poderão ser gravados no Firebase de produção depois da aprovação e publicação das regras desta branch. O sinalizador existente `app_config/engagement` continua sendo respeitado; não foi modificado. Com as regras antigas, os três tipos originais continuam compatíveis; outros emojis resultam em mensagem de erro, sem perda da reação anterior.

Sem alterações de push, selos, Guardião, autenticação, perfis, assinatura permanente ou backup. Os únicos pontos modificados nas telas compartilhadas são a ligação e o posicionamento das reações.

## Validação e capturas

- Testes JVM: catálogo completo, busca com/sem acentos, sequências compostas, agrupamento legado/Unicode, substituição/remoção e recentes sem duplicação.
- Firestore Emulator: seis cenários de autorização e sincronização; conferência exaustiva dos 3.944 itens contra a allowlist gerada, com exemplos reais gravados de cada categoria, tons e sequências compostas. Regras existentes também são executadas.
- Android: toque longo na resposta, menu rápido, +, catálogo, pesquisa por família, tom de pele, recentes e remoção; dois clientes Auth/Firestore isolados verificam contagem coletiva, troca, remoção, compatibilidade legada e reabertura da tela; recentes persistentes e separados por conta.
- Capturas reais do Android virtual: barra rápida, catálogo, pesquisa, tons, recentes e contagem entre contas. Estão no artefato de QA, diretório `reaction-preview`.
- Todos os dados de teste são sintéticos em `demo-atrio-v11`. Nenhuma notificação ou reação é enviada a usuários reais.

Resultados efetivos da execução constam nos Checks e na descrição da PR. A existência dos testes não deve ser confundida com sua aprovação.

## Revisão no celular

Instale somente o Debug correspondente à PR, abra uma discussão com respostas e mantenha pressionado o texto de uma resposta. Compare com o botão Reagir. Abra +, pesquise "família", escolha um emoji composto, depois escolha um tom de pele mantendo 👍 pressionado. Repita a escolha para remover. Em duas contas, reaja ao mesmo comentário e confira a soma; feche/reabra a tela para verificar persistência.

As gravações de novos emojis em produção dependem da aprovação das regras. As capturas e testes de laboratório demonstram esse fluxo completo sem alterar a produção.

## Fontes

- Unicode 17: https://www.unicode.org/Public/17.0.0/emoji/emoji-test.txt
- CLDR português, release-48: https://github.com/unicode-org/cldr/tree/release-48/common/annotations
- Compatibilidade nativa de glifos: https://developer.android.com/reference/android/graphics/Paint#hasGlyph(java.lang.String)
