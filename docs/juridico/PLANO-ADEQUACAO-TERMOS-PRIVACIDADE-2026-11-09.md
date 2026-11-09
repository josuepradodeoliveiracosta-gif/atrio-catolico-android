# Plano de adequação e publicação de documentos legais — Átrio Católico

**Fotografia:** 09/11/2026 — revisão documental gratuita.  
**Estado:** minutas escritas; **documentos ainda não aprovados, nem publicados como política vigente**.  
**Custo externo realizado:** R$ 0,00. Sem serviços, implantação, contratação ou taxas.

## Documentos preparados

- [MINUTA — Termos de Uso](MINUTA-TERMOS-USO-2026-11-09.md).
- [MINUTA — Política de Privacidade](MINUTA-POLITICA-PRIVACIDADE-2026-11-09.md).
- [Inventário de licenças de terceiros](INVENTARIO-LICENCAS-TERCEIROS-2026-11-09.md).
- [Auditoria de mídias](AUDITORIA-PROVENIENCIA-MIDIAS-2026-11-09.md).

## Matriz de validação

| Prioridade | Pendência | Evidência / cuidado | Estado |
| --- | --- | --- | --- |
| **P0** | Confirmar controlador/titular responsável e contato público funcional | Sem inventar e-mail, CPF, CNPJ, endereço ou identidade jurídica; separar identificação pública de informações privadas | **Bloqueado** |
| **P0** | Revisar bases legais por finalidade e dados de convicção religiosa | Preferências de fé, vínculo paroquial e conteúdo público podem revelar dados sensíveis; consentimento específico do cadastro não vale para todos os tratamentos | **Pendente** |
| **P0** | Validar coleta, operadores, subprocessadores e fluxos reais | Firebase Auth/Firestore, FCM, Cloudflare e Cloudinary; distinguir código, QA e infraestrutura ativa | **Pendente** |
| **P0** | Definir retenção e eliminação real por categoria | Dados de conta, posts, respostas, fotos, push, denúncias, backups, logs e retenções legais | **Bloqueado** |
| **P0** | Construir e homologar exclusão de conta e dados e canal externo | O app só registra pedido; [PR #98](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/98) segue **draft e não integrada**; não lançar sem procedimento seguro | **Bloqueado** |
| **P0** | Garantir mecanismo de atendimento a titulares LGPD | Canal público, processo para acesso/correção/revogação/eliminação e verificação razoável de identidade | **Pendente** |
| **P0** | Definir idade, regras de menores e segurança de UGC | Termos, canal de denúncias, resposta operacional, moderação real, proteção infantil quando aplicável | **Pendente** |
| **P1** | Revisar direitos autorais e licenças de conteúdos de usuários/mídias | Fontes, fotos, vídeo, trilha, nomes e biografias | **Pendente** |
| **P1** | Publicar versão definitiva em URL HTTPS acessível sem login | Acesso mundial, sem PDF e consistente com o que o app exibe; não presumir que esta minuta GitHub seja a política oficial | **Pendente** |
| **P1** | Registrar aceite versionado e acessível | `community_consents` registra versão das regras; os checkboxes atuais de termos/privacidade são prévias, não prova de aceite de texto final | **Pendente** |
| **P1** | Conferir política com Data Safety na Google Play | Política deve refletir coleta, compartilhamento, segurança, retenção e exclusão reais | **Pendente** |
| **P2** | Revisar comunicação de alterações e manutenção | Versões datadas, histórico de revisão e canal para esclarecimentos | **Pendente** |

## Constatações técnicas desta etapa

1. [OnlineAtrioApp.kt](../../app/src/main/java/br/com/atriocatolico/OnlineAtrioApp.kt) apresenta prévias de Termos e Privacidade e checkboxes; os próprios textos apontam que a revisão jurídica e a retenção ainda estão pendentes.
2. [CommunityRulesGate.kt](../../app/src/main/java/br/com/atriocatolico/CommunityRulesGate.kt) define regras de conduta e versão `2026-11-v1`, com aceite das **regras**, não equivalência automática ao aceite de termos/política final.
3. [RegistrationV2.kt](../../app/src/main/java/br/com/atriocatolico/RegistrationV2.kt) prevê preferências religiosas opcionais, consentimento específico, privacidade por padrão e remoção dessas preferências.
4. [AccountSecurityPanel.kt](../../app/src/main/java/br/com/atriocatolico/AccountSecurityPanel.kt) registra uma solicitação de exclusão, **sem excluir** imediatamente os dados da conta.
5. [Documentação de cadastro/Play](../publicacao-play-store/CADASTRO-SEGURANCA-E-PRIVACIDADE.md) já identifica lacunas de eliminação, contato, moderação e política jurídica.
6. [PR #71](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/71) é referente à preparação do **AAB/Google Play**, não é a PR consolidada de privacidade; esta última é a [PR #98](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/98).

## Referências oficiais

- [ANPD — dados sensíveis e direitos](https://www.gov.br/anpd/pt-br/canais_atendimento/cidadao-titular-de-dados/denuncia-peticao-de-titular-referente-lgpd).
- [ANPD — direitos dos titulares](https://www.gov.br/anpd/pt-br/assuntos/titular-de-dados/direito-dos-titulares).
- [Google Play — User Data](https://support.google.com/googleplay/android-developer/answer/10144311).
- [Google Play — exclusão de conta](https://support.google.com/googleplay/android-developer/answer/13327111).
- [Google Play — preparação da revisão de apps](https://support.google.com/googleplay/android-developer/answer/9859455).

## Limites de aprovação

- A integração desta documentação **não** aprova ou publica os Termos/Política como juridicamente vigentes.
- Nenhuma declaração de conformidade integral LGPD ou Google Play foi feita.
- A revisão jurídica profissional é recomendável para lançamentos e tratamento de dados sensíveis, embora o preparo documental atual não envolva cobrança.
- **Não alterar** produção Firebase/Cloudflare, assinatura, APK, exclusão, documentação pessoal, credenciais, branches protegidos de backup ou PRs #71/#98 nesta etapa.
