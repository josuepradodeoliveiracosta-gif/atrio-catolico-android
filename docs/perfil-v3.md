# Perfil V3

## Experiência

- O perfil próprio mostra devoção, faixa etária, estado civil e interesses escolhidos, com a situação de visibilidade de cada campo.
- O editor de dados pessoais pede autorização específica antes de salvar. Os novos campos começam ocultos.
- A data de nascimento não é solicitada nem armazenada. A faixa etária é escolhida manualmente; as opções atuais começam em 18 anos e não verificam a idade da conta.
- O estado civil fica oculto por padrão. A devoção pode ter uma frase curta. Até três interesses privados podem ser escolhidos para exibição.
- A prévia mostra a projeção que será publicada. Nome e apresentação continuam sujeitos ao opt-in já existente.
- O perfil visitado lê somente `public_profiles/{uid}` para exibir esses campos; nunca consulta o perfil privado de outra pessoa.
- Afinidades são calculadas pela interseção dos campos públicos de ambos. O atalho para o mural aparece apenas quando há uma publicação na categoria associada ao tema principal.
- Categorias do atalho: devoção → Santos; Oração → Pedidos de oração; Formação → Sagradas Escrituras; Comunidade → Juventude; Notícias católicas → História da Igreja.

## Armazenamento e privacidade

- Os novos dados ficam em `users/{uid}/private/profile_v3`, legíveis e graváveis apenas pela própria conta.
- A projeção pública contém somente os atributos visíveis selecionados e os interesses escolhidos; cidade, paróquia, e-mail, data de nascimento e interesses restantes não são copiados.
- Alterações de campos publicados atualizam o documento privado e a projeção pública na mesma transação. Desmarcar um campo o remove da projeção.
- A retirada integral da apresentação pública continua removendo `public_profiles/{uid}`.
- Se um interesse estiver público, ele precisa ser ocultado antes de ser removido das preferências privadas.

## Implantação

Os testes de regras deste recurso usam somente o Firebase Emulator. `firestore.rules` ainda precisa de revisão e publicação autorizada antes de os novos campos funcionarem no Firebase remoto. Nenhuma regra ou dado de produção foi publicado ou migrado.

Antes de lançamento, revisar a política de idade: a minuta de termos ainda marca como pendentes a classificação etária e os cuidados com menores. As faixas atuais não são prova nem requisito de idade mínima.
