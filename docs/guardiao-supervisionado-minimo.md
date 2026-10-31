# Átrio Guardião — modalidade supervisionada mínima

**Proposta em branch isolada. Não é publicação, deploy ou autorização para merge.**

Esta proposta transfere somente a prevenção local, o endurecimento da sessão administrativa e as regras de edição da PR #44. Não inclui Cloudflare Guardian Worker, cron, D1, ponte QA, scanner de conteúdo, IA, quarentena autônoma, contas de serviço ou chaves.

## Fluxo inicial
1. Antes de publicar, responder ou editar, o aplicativo avalia **localmente** sinais de risco e pode mostrar aviso educativo. A pessoa pode revisar ou continuar: não há punição automática.
2. Denúncias e decisões permanecem **humanas**, pelo painel atual com Firebase Auth. A tela exige identidade correta e confirmação recente de permissão administrativa; não confia apenas em dados locais em cache.
3. Uma edição própria exige `updatedAt` gerado pelo servidor, sem exceção para APKs antigos. O responsável confirmou que o app ainda não foi publicado e que as versões antigas não são mais usadas.
4. A correção da interface conserva o rascunho durante o aviso, evitando perdê-lo antes do envio.
5. Nenhuma função autônoma do V2 é carregada nesta proposta. Recursos de contestação e telas V2 fora deste escopo serão avaliados separadamente.

## Bloqueios até a liberação
- Aprovação da compilação, dos testes Firestore, testes unitários e testes Android do recorte. Confirmar administrador ativo e revogado em testes específicos antes de aprovar merge.
- **Custo atual confirmado pelo responsável: R$ 0 (30/10/2026).** Esta informação é uma confirmação do titular, não uma leitura independente do faturamento ou das cotas. Para o escopo atual, não repetir a comprovação financeira como pendência de homologação. Permanecem proibidos upgrades, novos vínculos de faturamento, assinaturas, cartões, serviços cobrados e alterações que criem risco de cobrança. Se surgir novo recurso ou mudar o plano, reavaliar seu custo antes de ativá-lo.
- Revisão humana da PR, autorização explícita para merge, regras oficiais, assinatura de APK e qualquer mudança em produção.
- A PR #44 permanece o laboratório experimental e não é substituída por esta proposta; nenhuma operação 24/7 autônoma está autorizada.
