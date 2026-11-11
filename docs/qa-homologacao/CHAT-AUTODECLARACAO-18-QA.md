# Átrio Conversas — candidato QA com autodeclaração 18+

**Solicitação do fundador em 10/11/2026:** substituir a pré-triagem opcional de data de nascimento por uma confirmação explícita de **18 anos completos ou mais** e, no protótipo de chat, usar essa declaração para elegibilidade de acesso sem fornecedor pago. Sem seleção, não emitir sinal de chat.

**ATENÇÃO: AUTODECLARAÇÃO NÃO VERIFICA A IDADE.** Qualquer menor pode declarar idade falsa. Esta proposta **não** pode ser apresentada como prova de 18+ nem como solução jurídica comprovadamente compatível com o ECA Digital. Se o serviço oferecer conteúdo/produto/serviço impróprio, inadequado ou proibido para menores, o art. 9º da Lei 15.211/2025 proíbe a autodeclaração como verificação suficiente. A avaliação de acesso provável por menores, escopo e riscos do Átrio demanda revisão jurídica/privacidade.

## Escopo desta proposta

- **Apenas** na variante Android `br.com.atriocatolico.chatqa`; nenhuma alteração no fluxo oficial/release.
- O formulário QA apresenta checkbox de declaração, nunca solicita ou guarda CPF, documento, biometria ou data de nascimento.
- A conta pode ser criada sem marcar a declaração, porém não recebe elegibilidade de chat.
- Quando marcado, o aplicativo QA solicita a criação de `users/{uid}/chatAgeEligibility/current` com somente quatro campos: `status='declared_18_plus'`, `minimumAge=18`, `policyVersion='2026-11-selfdecl-qa-v1'` e `reviewExpiresAt` limitado em tempo no laboratório. O servidor não comprovou a idade; os campos são explicitamente de **declaração**, não de verificação.
- As regras candidatas **distintas das regras QA atuais** devem limitar essa escrita ao UID logado, impedir perfis de terceiros, recusar campos extras e negar usuários sem declaração; login, e-mail validado, estados administrativos, bloqueio e participação permanecem restrições separadas.
- A mensagem de aprovação visual ou o simples clique não é autorização de Firebase/Cloudflare. O envio do documento pode falhar; o usuário não recebe acesso por cache local.
- **Não há deploy.** As regras reais QA permanecem deny-all. As regras oficiais `firestore.rules`, `main`, APK Release, Worker/D1 real e backups não são modificados.

## Evidência e implantação ainda pendentes

A implementação isolada deve ter regressões de Firestore Emulator para declaração verdadeira, ausência, dados falsos, outros UIDs, sem e-mail confirmado, gravação indevida e revogação. Antes de qualquer implantação QA, confirmar também compatibilidade com notificações, grupos, moderação, retenção e custos. Nenhuma aprovação é inferida de testes.

**Situação de governança:** a issue #200 permanece aberta; método confiável 18+ continua sem solução porque a autodeclaração não comprova idade. O marco 3 não muda de estado; QA geral 2/7 (29%), NO-GO. Necessária avaliação jurídica do escopo do chat e autorização específica para implantação QA; produção exige autorização distinta.

**Referências oficiais:**
- Lei nº 15.211/2025, art. 9º: https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2025/lei/l15211.htm
- ANPD, orientação de acesso provável por menores (28/10/2026): https://www.gov.br/anpd/pt-br/assuntos/noticias/anpd-publica-guia-que-esclarece-quem-deve-cumprir-e-quais-sao-as-responsabilidades-das-plataformas-na-protecao-de-criancas-e-adolescentes
