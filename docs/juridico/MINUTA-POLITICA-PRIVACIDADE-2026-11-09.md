# MINUTA — Política de Privacidade do Átrio Católico

> **EM ELABORAÇÃO — NÃO É POLÍTICA DEFINITIVA, APROVADA OU PRONTA PARA A GOOGLE PLAY.**
>
> Documento de trabalho criado em 09/11/2026 a partir de arquivos e fluxos visíveis na `main`. Precisam ser confirmados: identidade e contato do controlador, dados efetivamente processados em produção, contratos e localização de provedores, bases legais por finalidade, prazos de retenção, exclusão integral, público-alvo e publicação em URL estável sem login.
>
> **Versão:** 0.1 — minuta. **Início de vigência:** [DEFINIR APÓS APROVAÇÃO]. **Canal do titular:** [PENDENTE].

## 1. Identificação do controlador e contato

O **Átrio Católico** é um aplicativo de comunidade religiosa. O controlador dos dados pessoais é quem toma as decisões sobre seu tratamento.

- **Nome/natureza jurídica do controlador:** [PENDENTE DE CONFIRMAÇÃO PELO RESPONSÁVEL].
- **Canal público e funcional de contato para assuntos de privacidade e direitos do titular:** [PENDENTE DE CRIAÇÃO OU CONFIRMAÇÃO].
- **Encarregado, quando aplicável, ou mecanismo de comunicação com titulares:** [PENDENTE DE AVALIAÇÃO].
- **Website e URL oficial da política:** [PENDENTE — não inventar endereço nem expor telefone, CPF ou endereço residencial desnecessariamente].

A página de um repositório de código **não substitui automaticamente** um canal de atendimento ao titular nem a publicação da política no próprio aplicativo.

## 2. Categorias de dados identificadas no código

| Categoria | Exemplos e origem | Contexto/finalidade a validar |
| --- | --- | --- |
| Cadastro e autenticação | Nome de exibição, e-mail, credenciais processadas pelo Firebase Authentication, UID e estado de verificação do e-mail | Criar/autenticar conta, permitir participação, recuperação e segurança |
| Perfil privado | Dados do perfil acessíveis ao titular segundo regras do aplicativo; biografia não publicada por padrão | Gerenciar conta e identidade |
| Perfil público voluntário | Nome de exibição, biografia publicada, foto de perfil aprovada e conteúdos associados, conforme recursos habilitados | Identificação e interação com outros participantes autenticados |
| Conteúdo da comunidade | Discussões, títulos, texto, categorias, respostas, reações e interações de publicação, data e UID | Operação social e moderação; **o texto publicado pode revelar crença religiosa ou outros dados sensíveis** |
| Preferências religiosas **sensíveis** | Interesses sobre a fé, autodeclaração de participação religiosa, paróquia, cidade e versão/data do consentimento | Personalização **opcional**: o código registra autorização específica e permite apagar as preferências |
| Preferências de uso | Publicações salvas/curtidas/seguidas, bloqueios pessoais, configurações de avisos | Oferecer funções solicitadas pela conta |
| Notificações | Eventos e preferências de notificações; token FCM e identificadores de dispositivo, se ativados | Avisos relacionados à conta/discussões e diagnóstico técnico |
| Denúncias e moderação | UID do denunciante e denunciado, motivo, dados da ocorrência, decisões de administradores e horários | Prevenir abuso, tratar denúncias, segurança e cumprimento de regras |
| Fotos/avatares | Foto local no dispositivo e, **caso implantado**, imagem otimizada enviada a Worker/Cloudinary e metadados de moderação | Perfil e moderação de fotografias |
| Solicitações de exclusão | UID, data e status do pedido; registros administrativos relacionados | Receber e acompanhar requerimentos; **não significa exclusão concluída** |
| Registros técnicos | Logs e metadados potencialmente tratados por infraestrutura e provedores, como IP, data/hora, erros e informações do dispositivo | Segurança, operação e prevenção de abuso; **precisa de confirmação dos logs reais em produção** |

A plataforma **não deve tratar** senhas em texto claro no Firestore. O código usa autenticação Firebase. Essa análise não é uma auditoria completa do aplicativo/servidor nem comprova que nenhum log de terceiros registre identificadores.

## 3. Finalidades e bases legais — exigir validação antes da publicação

A Lei nº 13.709/2018 (LGPD) exige definir uma hipótese legal compatível com cada finalidade. **Não utilizar a mesma base legal para todos os dados por conveniência.**

| Finalidade em análise | Hipótese a avaliar | Estado |
| --- | --- | --- |
| Criar e manter a conta e realizar funções solicitadas | Execução de contrato/procedimentos relacionados, conforme art. 7º, V; avaliar adequação | [VALIDAR] |
| Proteger contas, combater fraude e moderar conteúdo | Obrigações legais, exercício regular de direitos ou outras hipóteses cabíveis, mediante análise concreta | [VALIDAR] |
| Guardar preferências sobre fé, papel religioso e paróquia | **Consentimento específico e destacado para dado sensível**, nos limites do art. 11 e dos tratamentos efetivos; outras hipóteses só quando legalmente cabíveis | O código prevê opt-in, versão e exclusão, mas não demonstra cumprimento integral |
| Publicações voluntárias que revelem religião | Finalidade, publicidade e hipótese legal para dados sensíveis; mera publicação não equivale a consentimento genérico para outros usos | [VALIDAR] |
| Enviar push/notificações opcionais | Verificar autorização no sistema e hipótese LGPD aplicável à finalidade | [VALIDAR] |
| Atender pedidos de titulares e reter registros necessários | Hipóteses legais e prazos justificados | [VALIDAR] |

A tela permite **pular** preferências religiosas. Quando preenchidas, o código exige autorização e grava `consentVersion` e `consentAt` em `users/{uid}/private/preferences`. O usuário pode apagá-las no perfil (revogação local da preferência). Isso não elimina automaticamente eventuais menções à religião em mensagens publicadas ou em registros legais.

## 4. Com quem os dados podem ser tratados ou compartilhados

- **Google Firebase Authentication e Cloud Firestore:** o código Android utiliza esses serviços para autenticação, perfis, interações e dados associados. A configuração e a identidade jurídica do fornecedor, os instrumentos contratuais e os ambientes **em produção** devem ser confirmados.
- **Firebase Cloud Messaging (Google):** se o usuário e o sistema habilitarem notificações, tokens de destino e dados mínimos de entrega podem ser processados.
- **Cloudflare Workers/D1:** há módulos de push, Guardião e avatares no repositório, com implantação e permissões específicas. **Não presumir que todos estejam ativos no ambiente oficial**.
- **Cloudinary:** existe arquitetura de upload e moderação de fotos públicas, condicionada a ativação; quando utilizada, URLs de fotos aprovadas podem ser acessíveis a quem possua o link, inclusive fora do Átrio. Confirmar antes de declarar uso real em produção.
- **Outros participantes autenticados:** conteúdos que a pessoa publica voluntariamente, nome e perfil público podem ser acessados conforme os recursos e permissões em operação.
- **Moderadores/administradores autorizados:** podem acessar informações necessárias para tarefas de moderação, denúncias e solicitações, sob controles de acesso sujeitos a teste.
- **Autoridades competentes:** informações podem ser fornecidas quando houver obrigação ou fundamento legal aplicável.

**Transferência internacional:** servidores e serviços terceirizados podem envolver processamento fora do Brasil; países, mecanismos, categorias e fundamentos de transferência ainda **não foram verificados**. Não declarar hospedagem exclusivamente brasileira.

Não foi verificada existência de publicidade personalizada, venda de dados ou mecanismos de análise comportamental de terceiros. Essa ausência de evidência **não constitui prova de inexistência**: a afirmação pública definitiva exige auditoria dos ambientes e SDKs efetivos.

## 5. O que outros usuários podem ver

O código diferencia `profiles` privado, `public_profiles` publicado voluntariamente, conteúdos da comunidade e preferências privadas. O acesso pode variar conforme autenticação e políticas de servidor.

- Nome de exibição, publicações, comentários, reações e biografia deliberadamente publicada podem aparecer a outros membros, conforme telas e regras em operação.
- E-mail, preferências de fé/paróquia e bloqueios pessoais **não devem** ser expostos como campos públicos pelo fluxo analisado.
- A decisão de publicar conteúdo relacionado à fé merece cuidado: a divulgação de crenças pode configurar tratamento de dado pessoal sensível.
- Uma foto disponibilizada em CDN por URL pública poderá circular fora da comunidade, mesmo após remoção, por caches ou cópias feitas por terceiros.

## 6. Armazenamento, segurança e retenção

As regras e o aplicativo contêm mecanismos de autenticação, permissões, configuração e separação de documentos privados/públicos. **Código versionado e testes em emulador não garantem implantação integral em produção.** A segurança deve ser avaliada continuamente.

- **Prazos de retenção por classe de dado:** [AINDA NÃO DEFINIDOS — definir critérios, prazos e fundamentos].
- **Backups, logs, CDN e réplicas:** [DEFINIR prazos, políticas e operadores].
- **Critérios de remoção de denúncias, medidas de segurança e dados sujeitos a obrigação legal:** [DEFINIR].
- **Informações de consentimento e retirada:** [DEFINIR retenção necessária e registro comprobatório sem excesso].
- **Incidentes de segurança e canal de comunicação:** [DEFINIR processo, critérios e responsáveis].

Não prometer exclusão imediata, anonimização total ou prazo fixo de retenção até o processo real existir e ser verificado.

## 7. Direitos das pessoas titulares

A pessoa poderá exercer os direitos previstos nos arts. 18 e seguintes da LGPD, conforme hipóteses e limites legais: confirmação do tratamento, acesso, correção, informação sobre compartilhamento, anonimização/bloqueio/eliminação quando cabíveis, portabilidade conforme regulamentação, revogação de consentimento e informações sobre a recusa do consentimento.

- **Preferências opcionais:** o código oferece edição e remoção de `users/{uid}/private/preferences` no perfil.
- **Exclusão da conta:** o aplicativo registra um documento de pedido em `account_deletion_requests/{uid}`; a conclusão administrativa e a remoção coordenada de Firebase Auth, Firestore, fotos, tokens, conteúdos e outros registros ainda **não estão implementadas integralmente na produção verificada**.
- **Canal externo para exclusão após desinstalação:** [PENDENTE DE URL HTTPS ACESSÍVEL SEM LOGIN E PROCESSO OPERACIONAL].
- **Contato de privacidade:** [PENDENTE — preencher e testar antes da publicação].

A execução do atendimento pode exigir confirmação razoável da identidade e análise de retenções legalmente obrigatórias; não se deve impor obstáculos desnecessários.

## 8. Crianças, adolescentes e dados sensíveis

O código examinado não comprova uma política etária definitiva nem controles completos de identificação de menores. **Antes de receber ou direcionar serviços a menores, definir regras e proteção adequadas** à LGPD, ao ECA e às políticas do canal de distribuição, observando o melhor interesse de crianças e adolescentes.

O contexto religioso demanda cautela com interesses de fé, filiação religiosa, paróquia, autodeclarações de condição clerical e possíveis inferências a partir do conteúdo.

## 9. Armazenamento local e permissões do dispositivo

- Foto de perfil pode ser mantida localmente, separada por UID, sem upload obrigatório.
- O aplicativo mantém algumas preferências/estados locais (por exemplo, avisos, preferências de uso e apresentação da abertura).
- Notificações dependem de permissão Android quando exigida e das preferências escolhidas.
- O aplicativo pode pedir autorização relacionada à instalação de APK externo no fluxo OTA; esse acesso **não se confunde** com coleta de dados pessoais e deve ser explicado quando solicitado.
- Não há base para afirmar que se utilizem cookies publicitários de navegador; portais web futuros exigem avaliação própria.

## 10. Atualizações desta política

Somente após aprovação, o documento deverá indicar controlador, contatos, versão vigente, data de publicação e processo de comunicação de alterações materiais. Os registros de consentimento e aceite devem apontar para documentos identificáveis por versão quando exigido. Publicar este Markdown no GitHub **não ativa** uma nova base legal ou aceite no aplicativo.

## 11. Pendências obrigatórias para tornar esta minuta publicável

1. Identificar o controlador e disponibilizar canal público **real e testado** para direitos de titulares, sem expor informações pessoais desnecessárias.
2. Validar o inventário de dados de **produção**, processadores e subprocessadores, logs, distribuição e transferência internacional.
3. Aprovar finalidades e bases legais, com tratamento reforçado para dados **religiosos sensíveis**, de preferência sob revisão jurídica.
4. Definir retenção, rotinas reais de exclusão e procedimento para solicitações, inclusive endpoint/canal externo HTTPS.
5. Definir público-alvo, tratamento de menores e moderação efetiva de conteúdo gerado por usuários.
6. Disponibilizar versão final clara no aplicativo, em URL HTTPS pública e estável sem login, e garantir consistência com as declarações `Data safety` da Play Console.
7. Conferir o aceite registrado: `community_consents` guarda **Regras da Comunidade**, mas os checkboxes da prévia legal vistos no cadastro não comprovam armazenamento de versão de Termos e Política como documentos finais.
8. Homologar fluxos e só então marcar a política como vigente; não fazer alterações retroativas fictícias em consentimentos.

## Evidências técnicas e orientação oficial

- [Cadastro, prévias legais e conteúdo da comunidade](../../app/src/main/java/br/com/atriocatolico/OnlineAtrioApp.kt).
- [Preferências opcionais e consentimento](../../app/src/main/java/br/com/atriocatolico/RegistrationV2.kt).
- [Pedidos de exclusão](../../app/src/main/java/br/com/atriocatolico/AccountSecurityPanel.kt).
- [Regras de acesso do Firestore](../../firestore.rules).
- [Checklist de privacidade para Play Store](../publicacao-play-store/CADASTRO-SEGURANCA-E-PRIVACIDADE.md).
- [PR #98 de exclusão em QA, **não integrada**](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/98).
- [ANPD — direitos dos titulares](https://www.gov.br/anpd/pt-br/assuntos/titular-de-dados/direito-dos-titulares).
- [ANPD — dados pessoais sensíveis](https://www.gov.br/anpd/pt-br/canais_atendimento/cidadao-titular-de-dados/denuncia-peticao-de-titular-referente-lgpd).
- [Google Play — política de dados do usuário](https://support.google.com/googleplay/android-developer/answer/10144311).
- [Minuta dos Termos de Uso](MINUTA-TERMOS-USO-2026-11-09.md).

**Esta minuta não foi implantada como política ativa, não comprova conformidade jurídica e não autoriza processamento novo de dados.**
