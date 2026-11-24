# Plano de design V1 — Átrio Católico

> **Proposta documental**, vinculada à [Issue #104](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/issues/104). Nenhuma alteração de Android, banco, Workers, privilégios, backup ou produção é autorizada por este documento. **Status: proposta em revisão.**

## Princípios

1. Evoluir a interface **que já existe**, sem reescrever a navegação nem alterar o pacote `br.com.atriocatolico`.
2. Respeitar identidade atual: vinho (`Wine`), dourado (`Gold`), papel (`Paper`), `WineSoft`, fontes legíveis, Material 3 e Jetpack Compose.
3. Acessibilidade, estados assíncronos, rede lenta e prevenção de ações duplicadas **antes** de acrescentar animações.
4. Selos religiosos e cargos são identidades verificadas, não recompensas por engajamento; títulos de participação não concedem acesso administrativo.
5. Não contratar bibliotecas, hospedagens ou plataformas pagas para executar a etapa. Preferir Compose/Material 3 já presentes no projeto.

## Prioridades e vínculo com o código existente

| Prioridade | Proposta | Tela/código já existente | Entrega verificável | Estado |
| --- | --- | --- | --- | --- |
| **P0** | DS-01 Cartão de discussão e respostas | `DiscussionCard`, `DetailScreen`, `HomeScreen` em `MainActivity.kt` | Estados de toque, carregamento, envio, erro, vazio e contraste | Especificação |
| **P0** | DS-02 Central de avisos | `NotificationCenter.kt` | Filtros, leitura, distinção de pendência administrativa | Especificação |
| **P0** | DS-03 Selos e identidade | `BadgeUi.kt`, artes de selos existentes | Hierarquia visual sem confundir identidade com autorização | Especificação |
| **P0** | DS-04 Moderação segura | `ModerationScreen.kt` | Confirmação e feedback sem sugerir exclusão automática | Especificação |
| **P1** | Microinterações não essenciais | Cartões, reações, aviso e perfil | Protocolo de movimento e alternativa sem animação | Especificação |
| **P1** | Títulos de participação | Perfil e área de selos | Taxonomia, proposta de critérios não executáveis | Proposta |
| **P2** | Ilustrações e ornamentos adicionais | Biblioteca `design/` | Revisão de licenças, contraste e peso de assets | Futuro |

**Por que P0:** essas áreas já têm superfícies reais em Compose e ações que podem confundir usuários quando o estado da rede muda. O design deve primeiro resolver clareza e segurança, não apenas decoração.

## Pacote de documentação desta etapa

- [Contratos de componentes](componentes/ESPECIFICACAO-V1.md).
- [Protocolo de interações e movimento](interacoes-animadas/PROTOCOLO-V1.md).
- [Modelo de selos, cargos e títulos](selos-e-titulos/MODELO-V1.md).

## Portões para implementação posterior

- [ ] Proposta visual revisada e aprovada pelo proprietário.
- [ ] Verificar dimensões com Android pequeno, fontes ampliadas, tema claro/escuro e navegação por leitor de tela.
- [ ] Conferir visualmente os estados normal, carregando, vazio, erro, sucesso e toque repetido.
- [ ] Preparar uma PR técnica **individual por componente**, com testes Compose/Android na branch, sem mexer em assinatura, versão ou infraestrutura externa por conveniência visual.
- [ ] Identificar qual mudança exige Firebase/Worker; não acoplar a uma PR meramente visual.
- [ ] Aprovar CI e testar em dispositivo antes de chamar de “integrado”; só declarar “publicado” após evidência de distribuição.

## Limites de escopo

Nenhuma das propostas altera `app/`, `cloudflare/`, `firestore.rules`, `.github/workflows/` nem a [PR #71](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/71). Não fazer deploy nem distribuir APK. O backup `backup/v0.12.0-2026-10-25` é intocável. A validação do design **não** é validação de exclusão de contas nem de moderação efetiva.
