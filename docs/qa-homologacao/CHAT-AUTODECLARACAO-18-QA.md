# Átrio Conversas — candidato QA com autodeclaração 18+

**Solicitação inicial do fundador em 10/11/2026:** confirmação explícita de **18 anos completos ou mais** para solicitar elegibilidade sem fornecedor pago. **Alteração posterior na mesma data:** voltar a incluir o campo de **data de nascimento**, calcular localmente a idade informada e permitir marcar a declaração somente se a data corresponder a pelo menos 18 anos. Sem data válida ou sem declaração, não emitir sinal de chat. O cadastro para outras áreas continua possível.

**ATENÇÃO: AUTODECLARAÇÃO NÃO VERIFICA A IDADE.** Qualquer menor pode declarar idade falsa. Esta proposta **não** pode ser apresentada como prova de 18+ nem como solução jurídica comprovadamente compatível com o ECA Digital. Se o serviço oferecer conteúdo/produto/serviço impróprio, inadequado ou proibido para menores, o art. 9º da Lei 15.211/2025 proíbe a autodeclaração como verificação suficiente. A avaliação de acesso provável por menores, escopo e riscos do Átrio demanda revisão jurídica/privacidade.

## Decisão ratificada pelo fundador: método provisório suficiente para o projeto (11/11/2026)

**DECIDIDO — NÃO REABRIR COMO PENDÊNCIA DE ESCOLHA DE PRODUTO:** por determinação expressa do fundador, para a fase atual do **Átrio Conversas (mensagens privadas e grupos)**, a combinação de data de nascimento informada voluntariamente (calculada localmente, sem transmissão/armazenamento da data) e **autodeclaração expressa 18+** é o **critério operacional provisório escolhido e considerado suficiente pelo responsável para o projeto**, até haver recursos financeiros para um mecanismo mais robusto. Não exigir automaticamente serviço pago nem reiniciar a discussão sobre fornecedor a cada avanço. A idade mínima de 18 anos continua definida; o cadastro para demais áreas não é bloqueado apenas pela ausência da declaração.

**Separação obrigatória de sentidos:** "suficiente" aqui representa a **decisão funcional e orçamentária do responsável**, não uma aferição independente de idade, validação de identidade ou conclusão de conformidade legal. Essa escolha não afasta a análise jurídica da aplicação do ECA Digital e da LGPD, inclusive eventuais hipóteses em que só autodeclarar não atende à obrigação legal. Não declarar essa análise aprovada por dedução.

**Execução técnica:** manter o status 'declared_18_plus' e a indicação explícita de autodeclaração, nunca renomear o status para 'verified' ou 'eligible' como se houvesse prova externa. Preservar gates de e-mail, aceite de regras e segurança, revogação, bloqueios, moderação e privacidade; grupos e notificações exigem controles próprios. Um teste verde ou declaração do usuário não autoriza merge, publicação de Rules, Firebase QA real ou produção.

**Pendência futura financeira:** verificação mais forte fica no planejamento de evolução **quando o fundador tiver recursos**, sem fornecedor, preço ou prazo presumido. As demais decisões da issue #200 (proteção contra abuso, denúncia, retenção, privacidade, avaliação legal e autorização de rollout) continuam abertas independentemente da escolha funcional do método.

## Escopo desta proposta

- **Apenas** na variante Android `br.com.atriocatolico.chatqa`; nenhuma alteração no fluxo oficial/release.
- O formulário QA contém **data de nascimento DD/MM/AAAA** e checkbox de declaração. O cálculo da idade é apenas local; não armazena ou envia ao Firebase a data de nascimento, CPF, documento ou biometria.
- Para data inválida, futura, ausente ou idade informada inferior a 18 anos, a caixa fica desabilitada. Qualquer edição da data desmarca o aceite anterior. Uma checagem independente no callback de cadastro bloqueia estado visual obsoleto.
- Para idade informada maior ou igual a 18 e declaração marcada, o aplicativo QA solicita o sinal autodeclarado já previsto, sem afirmar que verificou a idade.
- A conta pode ser criada sem marcar a declaração, porém não recebe elegibilidade de chat.
- Quando marcado, o aplicativo QA solicita a criação de `users/{uid}/chatAgeEligibility/current` com somente quatro campos: `status='declared_18_plus'`, `minimumAge=18`, `policyVersion='2026-11-selfdecl-qa-v1'` e `reviewExpiresAt` limitado em tempo no laboratório. O servidor não comprovou a idade; os campos são explicitamente de **declaração**, não de verificação.
- As regras candidatas **distintas das regras QA atuais** devem limitar essa escrita ao UID logado, impedir perfis de terceiros, recusar campos extras e negar usuários sem declaração; login, e-mail validado, estados administrativos, bloqueio e participação permanecem restrições separadas.
- A mensagem de aprovação visual ou o simples clique não é autorização de Firebase/Cloudflare. O envio do documento pode falhar; o usuário não recebe acesso por cache local.
- **Não há deploy.** As regras reais QA permanecem deny-all. As regras oficiais `firestore.rules`, `main`, APK Release, Worker/D1 real e backups não são modificados.

## Evidência e implantação ainda pendentes

A implementação isolada deve ter regressões de Firestore Emulator para declaração verdadeira, ausência, dados falsos, outros UIDs, sem e-mail confirmado, gravação indevida e revogação. Antes de qualquer implantação QA, confirmar também compatibilidade com notificações, grupos, moderação, retenção e custos. Nenhuma aprovação é inferida de testes.

**Situação de governança:** a **escolha funcional do método provisório está decidida** pelo fundador (autodeclaração 18+ até haver recursos para evolução); não tratá-la como pendência financeira a ser resolvida antes de continuar o trabalho técnico. A **verificação independente de idade não está implementada** e a autodeclaração não comprova idade. A issue #200 permanece aberta pelas salvaguardas de abuso, moderação, privacidade, retenção, avaliação jurídica do escopo e autorizações específicas de implantação. O marco 3 não muda de estado; QA geral 2/7 (29%), NO-GO. Produção exige autorização distinta.

**Referências oficiais:**
- Lei nº 15.211/2025, art. 9º: https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2025/lei/l15211.htm
- ANPD, orientação de acesso provável por menores (28/10/2026): https://www.gov.br/anpd/pt-br/assuntos/noticias/anpd-publica-guia-que-esclarece-quem-deve-cumprir-e-quais-sao-as-responsabilidades-das-plataformas-na-protecao-de-criancas-e-adolescentes

## Revisão da proposta com data de nascimento (10/11/2026)

O usuário pediu **data de nascimento + autodeclaração 18+** em sequência aos protótipos. O cálculo usa `LocalDate.now()` e o calendário gregoriano com validação estrita, incluindo limites exatos de aniversário e nascimento em 29/02. O campo existe apenas em memória da tela, não vai para `rememberSaveable`, `SharedPreferences`, Firestore, Worker ou logs. Nada muda em registros de usuários antigos.

O aceite é mantido separado das condições de uso/privacidade e não é obrigatório para criar a conta. A decisão de solicitar elegibilidade é calculada novamente e congelada antes do `createUserWithEmailAndPassword`, evitando que a caixa marcada em data anterior libere o chat após alteração para uma data inválida/menor. Testes JVM cobrem limites, falsificação de estado visual e formatação; integração sintética QA e regras alternativas permanecem como antes.

**Limitação central:** a data informada é do próprio usuário e não verifica a identidade/idade real. Pode ser falsa. Continua obrigatória a avaliação jurídica da issue #200 e autorização separada para ativação de Rules/Worker QA ou produção.
