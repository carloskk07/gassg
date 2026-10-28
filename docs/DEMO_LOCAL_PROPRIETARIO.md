# TAMÃO — demonstração operacional privada no próprio computador

**Resultado disponível:** três janelas reais do TAMÃO — Cliente, Parceiro e Admin — com **o mesmo Supabase/Auth/Postgres local**, dados fictícios e solicitações compartilhadas. O navegador abre os sites da aplicação existente, **sem pagar nova hospedagem** e sem falar com o banco comercial. O servidor é local, não pode ser aberto fora deste computador. Esta é uma demonstração operacional **enquanto estiver executando**; ao encerrá-la, os dados locais são descartados.

## O que é necessário (Windows 10/11)

O computador precisa de **WSL2 com Ubuntu**, **Docker Desktop com integração ao WSL**, conexão para baixar imagens Docker na primeira execução, e das ferramentas **Git, Node.js 20+, Python 3, psql e Supabase CLI v2.122.0** dentro do Ubuntu. Se faltar algo, o inicializador encerra sem alterar a produção. Não precisa CNPJ, nova revenda, senha de banco comercial, conta Mercado Pago ou chave Pix. Se sua máquina não tiver esses requisitos, ainda não é um duplo clique funcional: instale as ferramentas oficialmente antes.

Use a cópia do repositório `carloskk07/gassg` na versão aprovada, sem mudanças locais em `supabase/migrations`. O script **recusa** iniciar se as migrations locais tiverem alterações, se a stack Supabase já estiver em execução, se Docker estiver inacessível ou se detectar credenciais remotas de Supabase no ambiente.

1. No Windows, com Docker Desktop já aberto, clique em **`INICIAR_DEMO_LOCAL.cmd`** na raiz do projeto. No Linux/WSL, use `bash scripts/run-owner-local-demo.sh` a partir do repositório.
2. O programa prepara uma **cópia de segurança temporária** dos nomes de migrations do checkout, carrega o banco local, realiza os testes comerciais sintéticos e mostra três endereços separados. Os códigos comerciais originais são restaurados ao sair.
3. Abra os endereços que aparecem no terminal, mantendo o programa aberto. A autenticação de cada papel é carregada somente em seu próprio endereço de loopback. Os três papéis usam contas de teste distintas e **o mesmo banco temporário**.
4. Para encerrar, use **Ctrl+C** no terminal. Isso fecha os servidores locais, encerra a stack descartável sem guardar backup e restaura a pasta de migrations. Não feche o computador durante a etapa de preparação/restauração.

| Papel | Endereço local |
| --- | --- |
| Cliente | `http://127.0.0.1:4179/#home` |
| Revenda fictícia | `http://127.0.0.1:4180/?merchant=1#merchant` |
| Admin fictício | `http://127.0.0.1:4181/?admin=1#admin` |

**Cenário presente:** a rotina cria Revenda Simulada CI, catálogo sintético de P13 e água, contas temporárias separadas e pedidos de teste. O novo comprador recebe uma sessão própria sem pedido anterior. Pode montar a cesta, selecionar água, fornecer CEP fictício `97300000`, número `10`, telefone fictício `11999999999`, escolher dinheiro na entrega e enviar pedido. A revenda acompanha/aceita/atualiza e o Admin consulta o registro. A interface consulta as funções de negócio de verdade, mas **somente no Postgres temporário**.

## Limites e controles de segurança

- A API é exclusivamente `http://127.0.0.1:54321`; o servidor de páginas substitui em memória o endereço público e a chave **publicável**, sem gravar tokens em arquivos ou alterar os frontends oficiais. O serviço aceita apenas requisições locais e só disponibiliza arquivos públicos (`js/`, `css/`, imagens e manifest); nunca expõe `.git`, `.env`, `tests/`, migrations ou documentos privados.
- As contas de Auth e sessões fictícias ficam **em memória enquanto o processo está rodando** e em seus perfis locais no navegador. Não compartilhe os endereços; não habilite tunelamento, encaminhamento de porta ou acesso à rede. Os três portais só são acessíveis no próprio PC.
- O bootstrap contém dados fictícios, como CNPJ `00000000000000` e referência ANP **somente de CI**. Isso não equivale a uma revenda real regularizada. Nenhuma solicitação na demonstração constitui venda comercial, Pix real, cobrança, repasse ou benefício bancariamente liquidado.
- A operação de produção não é modificada. Não altere `PRELAUNCH` nem habilite comércio em Supabase comercial. O banco local é **persistente entre abas e recarregamentos enquanto o programa estiver aberto**, mas é descartado ao encerrar e não é uma demo hospedada permanentemente.
- **Se qualquer teste ou verificação local falhar**, a demonstração não é liberada; preserve os logs de erro sem incluir tokens e corrija a falha antes de confiar nela.

## Situação em relação à issue #493

Isto oferece o **primeiro caminho pessoal para operar os três portais reais juntos sem revenda**, sem novo custo de nuvem. Não é uma URL pública persistente nem a hospedagem privada independente de três domínios; esse requisito continua aberto. Ainda falta demonstrar em ambiente próprio as integrações de Pix, conciliação, cupons, cashback, comissões e estornos em sandbox, sem confundir testes de lógica com liquidação externa.

