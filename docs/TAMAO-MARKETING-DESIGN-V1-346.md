# TAMÃO V1.346 — Marketing, design e primeira impressão

Data: 2026-10-16. Escopo: três portais (cliente, parceiro e admin), sem alterar políticas de venda ou banco de dados.

## Evidência examinada

- Site público e páginas de autenticação pelo navegador Opera; comparação com o código mais recente da branch `main`.
- Sistema de marca vigente (`BRAND.md`) e estratégia de aquisição (`MARKETING.md`).
- Código de navegação comum (`js/core.js`), experiência de compra (`js/customer.js`), comerciais (`js/growth.js`), autenticação de parceiros e administradores, estilos globais e testes existentes.
- A implantação pública visualizada durante a inspeção ainda usava `sourceSha=95a3e82618391be8bd5f6cf2fcd4442df97da82e`; isso NÃO é prova de que a `main` recente já estava em todos os domínios. Publicação deve ser conferida separadamente com os três `portal-build.json`.

## Mudanças implementadas

1. **Primeira visita orientada ao produto:** trilho de até cinco produtos reais do catálogo de apresentação, com arte própria quando disponível e ação de selecionar um produto. Não implica estoque, entrega ou compra automática. O CEP fica para a consulta de entrega.
2. **Hierarquia comercial:** reforço da promessa da marca, microtexto mais humano e distinção explícita entre preços divulgados por revendas elegíveis, referência comercial local e consulta.
3. **Fonte de preço confiável:** o destaque de preço regional do produto requer `real===true` e `notAQuote===true` além de origem e cidade correspondentes; referências não viram ofertas.
4. **Experiência do parceiro:** entrada dividida entre proposta de valor e formulário, mensagens sobre autonomia e caminho para conhecer benefícios. Envio de link via formulário nativo, com Enter e validação de e-mail.
5. **Admin e navegação:** formulário administrativo utilizável por teclado, orientação menos técnica sem relaxar permissão; navegação principal semântica e salto direto ao conteúdo.
6. **Visual compartilhado:** linguagem cromática verde/creme consistente no showroom, novos componentes responsivos, estados de foco e respeito à preferência de movimento reduzido.
7. **Páginas comerciais:** textos orientados a clientes, revendas e patrocinadores, sem depoimentos, taxas de conversão, estoques, urgências ou resultados inventados.

## Evidências e limites

- Teste `tests/marketing-experience-v1-346.mjs` verifica sintaxe JS dos módulos alterados e contratos de fluxo/cópia/foco/formulários.
- O GitHub Actions `Audit` executa esse teste em PR; a aprovação **não é presumida** e só deve ser declarada após consultar a execução.
- Não há cadastro, abertura de cidade, configuração de PSP, remuneração, concessão de bônus ou criação de pedidos fictícios nas mudanças.
- Os blocos de preços da vitrine mostram informações preliminares; a cotação final depende de CEP, cesta, estado comercial e validação do servidor.
- O material é uma **primeira etapa transversal**, não equivale a uma auditoria visual autenticada de todos os milhares de estados internos de admin e revenda. Para isso, são necessárias contas autorizadas e testes de fluxo em homologação.

## Próxima revisão recomendada

1. Inspecionar de fato o site publicado após os deploys de cliente, parceiro e admin, em celulares de 320/360/390px e desktop.
2. Medir navegação `visita → escolha de produto → CEP → oferta`, `visita comercial → lead consentido → cadastro verificado`, e abandono por etapa. Respeitar o esquema first-party existente.
3. Aplicar pesquisa com compradores e revendas reais antes de prometer aumento de CTR ou conversão; testar uma hipótese de CTA por vez.
4. Validar desempenho e acessibilidade real com Lighthouse e leitores de tela; não confundir verificação estática com acessibilidade comprovada.
5. Auditar áreas internas autenticadas, inclusive estados vazios, erros, pedidos urgentes, catálogo, finanças e autorizações, por papel e pela prioridade operacional.
