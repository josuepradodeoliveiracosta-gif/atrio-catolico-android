# Vitrais litúrgicos no cadastro — QA Geral

Fonte: Vitrais_Liturgicos_Cadastro_Atrio_Catolico (2).pdf, 7 páginas. Artes originais nas páginas 2–4; modelos nas páginas 5–7. Base 7f712281057eb6d2d477211b5b7903565d62a954.

- Seis WebP 941 × 1672, qualidade 86, 1.305.186 bytes (originais 4.427.577 bytes; redução 70,52%). Exclusivos de app/src/qaGeral/assets/cadastro-vitrais. Blobs Git conferidos.
- Reutiliza LocalLiturgicalDay e fuso/calendário do login; fallback Tempo Comum. Chave própria REGISTRATION_VITRAIS_QA_ENABLED, apenas qaGeral.
- Fundo local, topo ancorado, scrim, superfície escura translúcida para legibilidade, cabeçalho sem miniatura; preserva autenticação, aceites e ações. Nenhuma alteração de política de cadastro, Firebase, versão ou assinatura.
- Testes iniciais de seis datas no cadastro real, recursos e dimensões, preservação de nome, controles e fallback; aguarda CI. Fluxos existentes de bots/cadastro/confirmação precisam passar. Pendentes evidência real de visual/teclado/offline, tamanho e desempenho comparativos, aprovação QA. Não liberar produção.
