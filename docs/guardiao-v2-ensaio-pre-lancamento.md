# Átrio Guardião V2 — ensaio de pré-lançamento (somente emulador)

**Situação do Átrio:** aplicativo ainda NÃO publicado e sem usuários reais. Os cenários deste documento usam somente contas fictícias. Não há deploy no Firebase oficial, Worker Push, APK Release ou outros serviços pagos.

## Ensaio automatizado

Arquivo: `tests/security/guardian-v2-e2e-emulator.mjs`. Integrado ao script `test:guardian-live` junto aos testes de integração já existentes. O GitHub Actions executa tudo no **Firestore Emulator local**, com autenticação fictícia da suíte `@firebase/rules-unit-testing`; o adaptador REST de moderação aponta **somente** para `127.0.0.1:8089`.

Cenários testados:

1. `qa-autor` e `qa-revisor` criam os próprios perfis; a autora publica uma discussão religiosa legítima e uma resposta, visíveis ao segundo perfil.
2. O revisor denuncia o conteúdo legítimo; o Guardião mantém `clear`, sem quarentena, e o denunciante não pode consultar denúncias privadas.
3. A autora publica uma resposta fictícia com phishing; o revisor registra uma denúncia válida com ID determinístico. Denúncias repetidas são rejeitadas.
4. O Guardião, ativado **somente como função de teste no emulador**, retém uma resposta suspeita, preserva cópia integral reversível, registra caso, auditoria e aviso privado.
5. A autora recebe o aviso e exerce contestação uma vez; outro perfil não pode acessar seu aviso nem a evidência. Nem o autor nem os clientes Android podem falsificar decisões.
6. O moderador fictício `qa-moderador` revisa a contestação e restaura o conteúdo original. Ficam registrados a decisão, o aviso de restauração e a auditoria.
7. Uma segunda resposta fictícia pode ser confirmada como infração por moderador distinto do autor, sem restaurar o conteúdo.
8. Uma segunda decisão no mesmo caso, autorrevisão, adulteração de histórico e escrita não autorizada são bloqueadas.
9. A parada de emergência `enabled=false` impede a varredura, preservando conteúdo legítimo.

**Atenção:** o ensaio permite remoção/restauração em **dados fictícios do Firestore Emulator**; isso não significa que a quarentena está habilitada na Cloudflare QA ou em um Firebase real.

## Como verificar

```bash
cd tests/security
npm ci
npm run test:guardian-live
```

A saída esperada contém `GUARDIAN_E2E_EMULATOR ... PASS`. Essa execução requer Node, Java e Firebase Emulator. No GitHub, verificar o job **Guardião V2 — integração real REST no Firestore Emulator**. O resultado só é considerado aprovado quando o job correspondente à revisão mais recente termina com sucesso.

## Limites antes do primeiro lançamento

- A autenticação contínua **sem chaves** entre Cloudflare e Firebase ainda não foi implementada para moderação 24/7. O WIF do GitHub fornece leitura temporária de QA, não execução permanente.
- A Cloudflare QA mantém flags de moderação desligadas, sem tokens Firebase.
- Antes de ativação inicial, exigir ensaio com APK Debug compatível e teste explícito do controle de parada em cenário de QA, sem dados reais.
- Sem contratar ou habilitar Cloud Run, Cloud Scheduler ou faturamento; sem editar `main`, backups, Firebase oficial, Worker de notificações ou Releases assinadas.

