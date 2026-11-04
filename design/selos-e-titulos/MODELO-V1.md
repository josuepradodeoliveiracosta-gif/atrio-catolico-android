# Selos, papéis e títulos de participação — taxonomia V1

> **Proposta visual; não configura concessões, Firestore, claims ou permissões.** Base: `BadgeUi.kt`, `docs/selos-seguranca.md` e artes do projeto. [Plano](../PLANO-PRIORIZADO-V1.md).

## Três categorias que não devem se misturar

| Categoria | Exemplos | Quem define | Consequência |
| --- | --- | --- | --- |
| **Identidade/cargo validado** | Fundador, Padre, Diácono, Moderador | Origem oficial/administrativa confiável, conforme regras existentes | Apenas representação gráfica; privilégios técnicos exigem controles próprios |
| **Identificação facultativa** | Leigo, Leiga | Autodeclaração, dentro das regras existentes | Identificação pessoal, não selo de autoridade |
| **Participação comunitária** | A definir por critérios objetivos e revisáveis | Somente após decisão de produto e auditoria das fontes de dados | Reconhecimento social, **nunca autoridade religiosa, administrativa ou preferência de moderação** |

## Identidade visual: preservar origem e distinguir significado

- **Fundador:** circular, vinho profundo e elemento dourado; texto “Fundador”; não confiar em nome público para confirmar a conta.
- **Padre:** cruz dourada e texto “Padre”; autorização baseada em verificação administrativa, nunca em quantidade de mensagens.
- **Diácono:** azul-petróleo, símbolo legível e texto “Diácono”; validação independente de cor.
- **Leigo/Leiga:** forma simples e neutra, com identificação textual opcional e respeitosa.
- **Moderador:** aspecto claramente operacional, com texto “Moderador”; a imagem não autoriza decisões. O mecanismo de privilégio permanece externo ao desenho.

Essas direções são **referências de arte existentes ou propostas**, não garantia de que cada cor está reproduzida exatamente na versão instalada. Verificar contraste claro/escuro e arte em tamanho real antes de aprovar.

## Títulos de participação — proposta não executável

Evitar nomes que pareçam ministério, ordenação, autoridade doutrinal ou classificação da fé. Nomes ilustrativos para revisão:

- **Participante** — identidade neutra, sem requisito de pontuação.
- **Colaborador da comunidade** — reconhecimento de contribuições positivas, sujeito a regra pública revisável.
- **Apoiador da comunidade** — reconhecimento voluntário, se houver critério aprovado que não dependa de pagamento.

**Não criar pontuação ou contadores reais nesta etapa.** Critérios concretos de atribuição, retirada, prevenção de abuso, contestação, privacidade e custo de leituras/gravações precisam de proposta posterior. Não inferir virtude, santidade ou ortodoxia por quantidade de likes.

## Requisitos de UX e segurança

1. Cada chip contém texto legível, ícone e detalhe explicativo acionado por toque; nenhum status comunicado só por cor.
2. Garantir contraste a verificar e alvo de toque próximo de 48 dp; um selo visual pequeno pode coexistir com área de interação maior.
3. Ordenar papéis de forma coerente sem transformar títulos participativos em cargos.
4. A mesma pessoa pode ter diferentes identificações; a exibição de um título não deve apagar a identificação religiosa verificada.
5. A ausência ou erro de leitura de papel administrativo não deve elevar privilégios nem fabricar selo.
6. Revogação, aprovação e auditoria ficam em serviços autorizados; nunca no cliente por opção de estilo.

## Gates

- [ ] Aprovação visual do proprietário.
- [ ] Definição legal e operacional de eventual título comunitário.
- [ ] Teste de variações de nome, fonte, tamanho, TalkBack e tema.
- [ ] Revisão de segurança para qualquer lógica de concessão, em PR separada com dados sintéticos.
- [ ] Teste de integração e evidência de versão antes de exibir como recurso implantado.

O backup, as políticas de produção, os Worker oficiais, a PR #71 e o código Android permanecem inalterados.
