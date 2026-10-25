# Histórico de versões

## 0.2.0 — Integração experimental com Firebase

- Mantido o modo offline da versão 0.1.
- Integrado cadastro/login de e-mail e recuperação de senha pelo Firebase Authentication.
- Criadas publicações e respostas sincronizadas com Firestore em tempo real.
- Curtidas e salvos por usuário (sem contagem pública fictícia).
- Perfil editável e saída da conta.
- Formulário de denúncia gravado em coleção privada; moderação não está implementada.
- Regras básicas do Firestore inclusas e revisadas por inspeção.
- Workflow GitHub Actions capaz de gerar APK offline ou conectado após configuração.

**Limites conhecidos:** não foi possível executar Android Gradle nem compilar APK neste ambiente, pois não há Android SDK/Gradle instalados. Revisão estática de arquivos realizada. Antes de distribuir, compile e teste com Android Studio ou GitHub Actions; revise regras e moderação.

## 0.3.0 — Configuração Firebase do proprietário integrada

- Incluído o `app/google-services.json` fornecido nesta conversa.
- Confirmado `project_id` do Firebase e `applicationId` Android.
- Adicionado `scripts/validar_firebase.py` para teste local da configuração.
- Integrada validação no fluxo de build conectado do GitHub Actions.
- Atualizada documentação para ativação dos serviços no Firebase Console.
- Não houve acesso administrativo ao Firebase nem publicação das regras.
