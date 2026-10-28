# Átrio Católico 0.18.2 — diagnóstico seguro do FCM

Atualização pontual derivada da main 0.18.1. Não integra a PR #15 (0.19.0).

- Se o Firebase Messaging não obtiver o token: indica Etapa 1/2.
- Se o Firestore não registrar o token: indica Etapa 2/2.
- Google Play Services, rede, configuração Firebase e permissões têm categorias seguras.
- Nenhum token FCM, UID, conteúdo de exceção ou chave é exibido.
- Mantém o cadastro e a recepção FCM existentes sem ativar novas funcionalidades.
- VersionCode 26 e versionName 0.18.2. Pacote e assinatura release seguem iguais.
- Nenhuma regra Firebase ou Cloudflare será alterada por esta PR.
- Após testes e integração, a compilação release assinada precisa ser disparada manualmente na main.
- O APK debug não substitui a instalação oficial assinada.
- Antes de integrar v0.19.0, atualizar versionCode da PR #15 para um valor maior que 26.

No celular, depois da instalação release por cima da v0.18.1, vá a Perfil > Avisos no celular e ative. Informe somente a etapa da falha; nunca envie o token.
