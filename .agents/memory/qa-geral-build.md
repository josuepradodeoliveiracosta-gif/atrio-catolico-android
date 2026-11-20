---
name: Validação local do QA Geral
description: Como validar o código compartilhado sem tocar na configuração oficial ou nas credenciais de produção.
---
Para validar o QA Geral offline, use uma árvore de build temporária isolada, com os mesmos fontes e scripts do checkout em revisão, sem copiar a configuração cliente de produção.

**Why:** o checkout normal pode conter a configuração oficial; o QA Geral exige que ela esteja ausente. Um erro por SDK ausente não significa que o projeto não possa ser compilado neste ambiente.

**How to apply:** confira os requisitos da variante no projeto atual, aponte para o SDK local e reporte a identidade da variante compilada. Um APK offline para emuladores não comprova instalação ou funcionamento no aparelho.
