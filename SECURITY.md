# Segurança do Átrio

Não publique senhas, tokens, chaves de assinatura, dados de usuários ou provas de
exploração em issues e pull requests públicas. Não teste contra usuários reais.
Use dados fictícios e os emuladores locais.

Após a abertura do repositório, use a opção **Security → Report a vulnerability**
para relatos privados, quando habilitada. Se essa opção não estiver disponível,
solicite ao mantenedor um canal privado sem incluir detalhes da vulnerabilidade.
Não existe, neste momento, prazo de resposta ou programa de recompensas definido.

A configuração Firebase do cliente não concede acesso administrativo. Chaves de
conta de serviço, assinatura Android e credenciais de bots nunca pertencem ao Git.

Contribuições externas executam apenas testes isolados. Compilações assinadas e
QA de produção exigem a principal revisada e ambientes protegidos. Não execute
código de PRs externas com credenciais locais ou de produção.

Consulte `docs/preparacao-repositorio-publico.md` antes de alterar a visibilidade.
