# TAMÃO V1.1042 — controle de bonificações da Rede no Admin

A V1.1041 trouxe benefícios de indicações verificáveis nos sete módulos e criou bonificação específica de publicidade de até **5% da receita líquida da primeira campanha**, não acumulativa com o fundo dos 10% dos pacotes de taxas.

Nesta etapa, Admin → Crescimento → Benefícios:
- A consulta financeira existente passa a apresentar a configuração de publicidade, percentual, prazo mínimo e quantidades de bonificações verificadas/revertidas.
- Somente Superadmin pode **ativar ou suspender** a apuração de futuras campanhas. Financeiro possui consulta sem autorização de escrita.
- Ativação exige referência válida aos **termos efetivamente aprovados e publicados** e confirmação explícita do responsável, antes de chamar a função protegida no Supabase.
- Não há cronograma de transferências automáticas; toda liquidação/saque permanece **indisponível** para esses bônus.
- A atualização do Admin lê do backend com `admin-ops` autenticado e conferência da conta; sem novas tabelas, dinheiro de simulação ou credenciais no navegador.
- O módulo de publicidade continua desligado até ação posterior do titular. Não ativar com referência fictícia ou sem aceitação jurídica.
- Cancelamentos/estornos continuam sujeitos ao motor original da V1.1041 e à maturação de sete dias.

Teste `tests/network-module-ads-admin-v1-1042.mjs` garante papel exclusivo, ausência de ativação sem termos, reversibilidade da configuração, leitura somente a Financeiro e ausência de saques.
