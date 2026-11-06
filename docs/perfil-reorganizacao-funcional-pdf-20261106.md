# Perfil — auditoria e salvaguardas antes da implementação (PDF, 06/11/2026)

Base imutável de comparação: `60e6502b5bdf55d4806a1e235a0fe82b9afb4a5f`. Branch isolada: `feature/perfil-reorganizacao-funcional-pdf-20261106`.

## 01. Inventário técnico real
- `OnlineProfileScreen` em `ProfileScreen.kt`: identidade (avatar, nome, selos, bio, edição, foto, publicação pública), Minhas discussões (consulta Firestore por UID limitada a 50), Discussões acompanhadas (local/remoto condicionado), Publicações salvas (aba dedicada), Minhas revisões (Guardião), opções de notificações, painel de apoio voluntário, gerenciamento da conta, atualizações OTA, moderação, análise de selos e broadcast do fundador. Painel adicional do feed contém somente publicações carregadas, não histórico completo.
- `PushSettings.kt`: opt-in por aparelho, POST_NOTIFICATIONS do Android 13+, FCM, verificação em segundo plano separada, diagnósticos e consulta de relay Cloudflare. Central de notificações e preferências por categorias abrem o mesmo destino existente em `OnlineCommunity`.
- `AccountSecurityPanel.kt`: reenvio/verificação de e-mail autenticado; solicitação de exclusão **administrativa**, não exclui a conta nem assegura limpeza completa. Requer confirmação.
- `DeveloperSupportPanel.kt`: acordeão fechado por padrão; Pix/banco somente após publicação; cópia; edição somente fundador com admin ativo, validado novamente pelas Firestore Rules já publicadas.
- `OnlineAtrioApp.kt`: eventos de botões encaminhados a abas e telas já existentes, autenticação e permissões mantidas no servidor; top bar com sino.
- `OtaUpdatesSection.kt`: consulta/versionamento e download voluntário de APK; debug não instala OTA oficial.

## 02. Contrato de integridade visual
NÃO editar tokens Wine/Gold/Paper/Ink/Muted, AtrioTheme, fontes, desenhos da basílica, bordas/cartões, ícones, tamanhos de avatar, selos, decoração, top bar ou barra inferior. Reusar ProfileSectionTitle, ProfileAction e Card existentes. **Somente conteúdo, organização e estados** podem mudar.

## 03–09. Especificação funcional
Ordem: Meu perfil; Minha participação; Preferências; Apoie o desenvolvedor (sem novo título duplicado fora do cartão); Conta e privacidade; Ajuda e suporte.
- Identidade mantém avatar, nomes, apresentação privada, publicação opcional, selos e botões existentes, sem mostrar e-mail na capa.
- Atividades agrupam histórico limitado com aviso honesto, acompanhadas, salvas, revisões, e lista opcional de publicações do feed carregado — conteúdo sob demanda.
- Preferências: uma chave de aviso externo com descrição curta; Personalizar avisos remete ao destino existente; diagnóstico/segundo plano migra para Ajuda.
- Apoio permanece opt-in, com Pix/banco apenas reais, controle remoto de autorização e cópia.
- Conta: e-mail/verificação, solicitação administrativa de exclusão claramente diferenciada de exclusão efetiva, saída.
- Ajuda: versão, OTA, diagnóstico avançado, ferramentas administrativas apenas para perfis autorizados.
- Todos os grupos devem manter acessibilidade, toque mínimo, estados loading/error/success verdadeiros, sem contadores inventados.

## Reversão/escopo
Sem deploy de Firestore/Cloudflare; sem backup ou Release; sem atualização de certificado, applicationId, versionCode ou dependências. Retorno = abandonar PR/branch; `main` e produção inalterados. Testes: regressão do perfil/selos/bots/e-mail, Firestore emulator, OTA e APK Debug. Merge requer autorização específica.

A auditoria antecedeu alterações funcionais no código.
