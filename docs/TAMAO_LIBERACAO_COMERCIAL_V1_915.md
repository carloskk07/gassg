# TAMÃO V1.915 — Estados comerciais autoritativos e liberação por evidência

Continuação da issue #493 e da V1.914. Consulta à produção: 09/11/2026. **A presença de código e testes isolados não equivale a venda real homologada.**

## Situação comercial confirmada

| Frente | Fonte autoritativa | Estado confirmado | Por que não marcar a comercialização como totalmente concluída |
|---|---|---|---|
| Plataforma global | `platform_launch_control` | `operation_mode=LIVE`, `commerce_enabled=false` | A plataforma está LIVE para cadastros e serviços digitais; pedidos físicos exigem oferta elegível |
| Revendas | `merchants` e `merchant_business_details` | 1 revenda `pending`, `online=false`, `price_confirmed_at=null`, nenhum registro em `merchant_business_details` | Ativação direta inventaria elegibilidade de revenda; não há autorização para pular comprovação de preço, estoque, entrega e identidade |
| Pedidos | `orders` | 0 pedidos reais registrados | A demonstração sintética não comprova aceitação e entrega por parceiro real |
| Clube pago | `clube_coupon_commercial_release_v1_819` e `clube_coupon_paid_packages` | Pacote universal `all_products_3x5_sponsor` liberado; outros pacotes não autorizados | Pagamento, uso, cancelamento e prova de repasse continuam sujeitos aos seus próprios gates |
| Ads independentes | `ads_independent_sales_controls_v1_886`, `ads_independent_controls_v1_884` | `sales_enabled=false`, `delivery_enabled=false`, 0 campanhas, sem homologação designada | Ativar vendas antes de validar a conta recebedora, webhook, campanha, checkout real, pagamento e política de devolução cria risco de cobrança sem entrega |
| Mobilidade | `mobility_requests` | 0 solicitações reais | Precisa de motorista apto e confirmação real de preço, atendimento e taxas para comprovar ponta a ponta |
| Profissionais e caronas | `discovery_vertical_cities` e `discovery_listings` | Modalidades habilitadas em São Gabriel/RS; sem anúncios publicados | Cadastro, busca e moderação são operáveis, mas não se deve prometer prestadores/viagens inexistentes; caronas ocasionais permanecem sem comissão |
| Hospedagens | `discovery_vertical_cities` | `stays.enabled=false` em São Gabriel/RS | Pausado por decisão expressa do proprietário, preservar essa decisão |

## Correção entregue na Central de Ativações

Antes: os blocos legados **Clube e patrocínios** e **Publicidade TAMÃO** marcavam “Vendas bloqueadas” e “Exibição bloqueada” em fluxos antigos de propostas, confundindo-os com o contrato de venda de **cupons universais pagos** e a **publicidade independente**.

Agora:
- **Cupons pagos** leem `clube-coupon-commercial-status` com fonte esperada `clube_commercial_release_status_v1_819`, registro do fornecedor e bloqueio de emergência. Sem prova, mostra “Não confirmado”.
- **Publicidade independente** lê `ads-independent-read`, valida fonte e contrato read-only, distingue o switch de venda por prazo fixo do switch de entrega. Sem prova, mostra “Não confirmado”.
- **Pedidos físicos** são identificados apenas pelo `commerceEnabled` informado no `launchReadiness`; não se inferem vendas por estar em LIVE.
- **Moto, carro, profissionais e caronas** têm acesso rápido às seções oficiais; nenhum botão executa lançamento, pagamento ou abertura comercial por clique de navegação.
- Os quadros antigos ficam em **Propostas legadas e governança**, sem falso diagnóstico de venda de cupons pagos.
- Somente o superadmin consulta os dois endpoints atuais de faturamento. O perfil de operações não recebe dados de vendedor e continua com os acessos previstos pelo RBAC.

## Limites desta revisão

Esta entrega **não** ativa no banco revenda pendente, pedido físico, comércio de Ads ou hospedagens. Tampouco cria campanhas, cobrança Mercado Pago, invoices, comissões, receitas, faturas, anúncios fictícios ou testes financeiros de produção. Preserve o contrato de autorização explícita, as garantias de estorno/conciliação e a exigência de homologação real do provedor antes de expandir faturamento.

A liberação de novas vendas Ads deverá usar a ação oficial autenticada do superadmin, após conferência de credenciais próprias, seller, webhook e prova financeira. Sem campanha anunciada, não existe pagamento real a conciliar.
