# TAMÃO V1.242 — Minutas de negociação e custeio do Clube

## Escopo real
**Apenas negociação e planejamento financeiro; zero contrato, depósito, reserva, cupons, resgates ou cobrança.**

1. Admin Finance/Superadmin prepara uma minuta por revenda e pacote já revisados no V1.241. Não pode alterar participação ou teto pretendido pela revenda: dados são vinculados à intenção vigente no V1.240.
2. Define participação planejada de marcas, orçamento hipotético das marcas e verba hipotética do TAMÃO. O restante dos descontos é atribuído ao TAMÃO como custo — **não se presume patrocínio externo**.
3. O sistema arredonda o custo por cupom da revenda para cima, o custo da marca para baixo e aplica o saldo ao TAMÃO. Pacotes hipoteticamente financiáveis = menor capacidade dos três participantes / cupons por pacote. Participante com custo zero não limita a conta.
4. Pode registrar progresso documental: não solicitado, solicitado ou informado como recebido, ainda não verificado. **Nenhum desses estados constitui prova**, muito menos aprovação jurídica/financeira.
5. Somente minuta que comporte ao menos um pacote completo segundo os **orçamentos pretendidos** pode ser compartilhada para discussão. Compartilhar NÃO concede benefício.
6. Proprietário da revenda pode registrar apenas "Li e quero conversar" ou "Não tenho interesse". Gestor pode consultar, mas não responder. Não há aceite de contrato.
7. Mudança de participação/teto pela revenda, retirada do interesse, revisão encerrada ou alteração da minuta invalidam a resposta anterior e/ou impedem nova manifestação. O RPC revalida contexto e versões no momento da mutação, com proteção contra reenvios.
8. Cada atualização gera trilha de auditoria com identidade de quem agiu e UUID da operação. Admin com perfil somente leitura não grava.

## Segurança técnica
- Tabelas com RLS habilitado, sem escrita para Data API, inclusive `service_role`; a gravação fica apenas em rotinas privadas com verificação explícita do ator.
- `funding_verified`, `contract_signed`, `coupon_sales_enabled` são falsos por CHECK no banco.
- Visibilidade de minutas: rascunho interno, minuta retirada ou obsoleta **não aparece na revenda**. Leitura individual exige membro owner/manager ativo.
- O orçamento da revenda **não é dinheiro recebido/segregado**. Mesmo uma planilha com 100% de cobertura projetada pode ser deficitária após PSP, impostos, estornos e custos variáveis (simulador financeiro V1.239).
- Nenhum dado de pedido, rateio de mercadoria, PSP, comissão ou cashback é tocado.
- Exigências para lançamento real: instrumento jurídico com consentimento, conferência de patrocinador, garantia de integralidade dos benefícios, contabilidade de passivos, reserva serializada por patrocinador/SKU/cidade, conciliação e análise legal de venda/arrependimento.

## Exemplo puramente aritmético
Gás: 3 cupons de R$ 5, orçamento sugerido da revenda R$ 30 para 100% dos descontos => capacidade teórica 6 usos, equivalentes a 2 pacotes completos. Ainda é necessário provar adesão, caixa reservado e margem positiva antes de liberar venda.

Estado inicial de produção: nenhuma intenção real e nenhuma minuta criada; não inserir empresas sintéticas na base comercial.
